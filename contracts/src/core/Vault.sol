// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IVault} from "../interfaces/IVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {IPerpsEngine} from "../interfaces/IPerpsEngine.sol";

/**
 * @title Vault
 * @notice Holds every USDC in the protocol and is the counterparty to all trades.
 *
 *  Traders deposit USDC into a free balance, which the engines lock as margin or spend on premiums.
 *  Liquidity providers deposit into the pool and receive hmLP shares. The pool takes the other side of every
 *  option and perp position and earns fees, premiums and trader losses.
 *
 *  Solvency: before a position opens, the engine reserves the most it can ever win (an option's cap, or a perp's
 *  profit cap). Reservations stay within `maxUtilizationBps` of the pool, LPs can only withdraw what is not
 *  reserved, and a payout never exceeds its reservation, so the pool can always pay every winner in full.
 *
 *  All balances are tracked, so `accountedAssets()` equals the USDC this contract holds.
 */
contract Vault is IVault, ERC20, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 internal constant BPS = 10_000;
    uint32 public constant MAX_LP_LOCK = 30 days;
    /// hmLP has 18 decimals against 6 for USDC; the offset also blunts share-inflation attacks on an empty pool
    uint256 internal constant VIRTUAL_SHARES = 1e12;

    IERC20 public immutable collateralToken;
    IFeeManager public feeManager;
    IRiskManager public riskManager;
    IPerpsEngine public perpsEngine;
    mapping(address engine => bool) public isEngine;

    mapping(address user => uint256) public balances;
    mapping(address user => uint256) public lockedMargin;
    uint256 public totalBalances;
    uint256 public totalLocked;

    uint256 public poolAmount;
    uint256 public reservedAmount;
    uint256 public optionsDeferred;
    uint256 public optionsPayable;

    uint32 public lpLockPeriod;
    mapping(address provider => uint64) public lpUnlockAt;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event LiquidityAdded(address indexed provider, uint256 amount, uint256 shares);
    event LiquidityRemoved(address indexed provider, uint256 shares, uint256 amount);
    event MarginLocked(address indexed user, uint256 amount);
    event MarginSettled(address indexed user, uint256 lockedAmount, uint256 toUser, uint256 fee, uint256 reward, address rewardTo);
    event ProtocolFeeCollected(uint256 amount, uint256 toPool, uint256 toBuyback, uint256 toTreasury);
    event ModulesSet(address feeManager, address riskManager, address perpsEngine);
    event EngineSet(address indexed engine, bool allowed);
    event LpLockPeriodSet(uint32 period);

    error InvalidParams();
    error ZeroAmount();
    error NotEngine();
    error InsufficientCollateral();
    error InsufficientPool();
    error UtilizationExceeded();
    error LiquidityLocked();
    error SlippageExceeded();

    modifier onlyEngine() {
        if (!isEngine[msg.sender]) revert NotEngine();
        _;
    }

    constructor(IERC20 collateralToken_, address owner_) ERC20("HanMarket Vault LP", "hmLP") Ownable(owner_) {
        if (IERC20Metadata(address(collateralToken_)).decimals() != 6) revert InvalidParams();
        collateralToken = collateralToken_;
    }

    // ---------------------------------------------------------------- admin

    function setModules(IFeeManager feeManager_, IRiskManager riskManager_, IPerpsEngine perpsEngine_) external onlyOwner {
        if (address(feeManager_) == address(0) || address(riskManager_) == address(0)) revert InvalidParams();
        feeManager = feeManager_;
        riskManager = riskManager_;
        perpsEngine = perpsEngine_;
        emit ModulesSet(address(feeManager_), address(riskManager_), address(perpsEngine_));
    }

    function setEngine(address engine, bool allowed) external onlyOwner {
        isEngine[engine] = allowed;
        emit EngineSet(engine, allowed);
    }

    function setLpLockPeriod(uint32 period) external onlyOwner {
        if (period > MAX_LP_LOCK) revert InvalidParams();
        lpLockPeriod = period;
        emit LpLockPeriodSet(period);
    }

    /// @notice Stops deposits and new liquidity. Withdrawals of free balances always stay open.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- traders

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        _credit(msg.sender, amount);
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _debit(msg.sender, amount);
        collateralToken.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- liquidity providers

    /// @notice Pool value that belongs to LPs: cash, minus premiums held for unexpired options, minus traders' open perp PnL.
    function nav() public view returns (uint256) {
        int256 value = int256(poolAmount) - int256(optionsDeferred);
        if (address(perpsEngine) != address(0)) value -= perpsEngine.totalTraderPnl();
        return value > 0 ? uint256(value) : 0;
    }

    function freeLiquidity() public view returns (uint256) {
        return poolAmount > reservedAmount ? poolAmount - reservedAmount : 0;
    }

    function previewAddLiquidity(uint256 amount) public view returns (uint256) {
        return (amount * (totalSupply() + VIRTUAL_SHARES)) / (nav() + 1);
    }

    function previewRemoveLiquidity(uint256 shares) public view returns (uint256) {
        return (shares * (nav() + 1)) / (totalSupply() + VIRTUAL_SHARES);
    }

    function addLiquidity(uint256 amount, uint256 minShares) external nonReentrant whenNotPaused returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        shares = previewAddLiquidity(amount);
        if (shares == 0 || shares < minShares) revert SlippageExceeded();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        poolAmount += amount;
        lpUnlockAt[msg.sender] = uint64(block.timestamp + lpLockPeriod);
        _mint(msg.sender, shares);
        emit LiquidityAdded(msg.sender, amount, shares);
    }

    function removeLiquidity(uint256 shares, uint256 minAmount) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (block.timestamp < lpUnlockAt[msg.sender]) revert LiquidityLocked();
        amount = previewRemoveLiquidity(shares);
        if (amount < minAmount) revert SlippageExceeded();
        if (amount > freeLiquidity()) revert InsufficientPool();
        _burn(msg.sender, shares);
        poolAmount -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit LiquidityRemoved(msg.sender, shares, amount);
    }

    // ---------------------------------------------------------------- engine hooks

    function lockMargin(address user, uint256 amount) external onlyEngine {
        _debit(user, amount);
        lockedMargin[user] += amount;
        totalLocked += amount;
        emit MarginLocked(user, amount);
    }

    function settleLocked(address user, uint256 lockedAmount, uint256 toUser, uint256 fee, uint256 reward, address rewardTo)
        external
        onlyEngine
    {
        if (lockedMargin[user] < lockedAmount) revert InsufficientCollateral();
        lockedMargin[user] -= lockedAmount;
        totalLocked -= lockedAmount;

        uint256 outflow = toUser + fee + reward;
        if (outflow > lockedAmount) {
            uint256 fromPool = outflow - lockedAmount;
            if (poolAmount < fromPool) revert InsufficientPool();
            poolAmount -= fromPool;
        } else {
            poolAmount += lockedAmount - outflow;
        }
        _credit(user, toUser);
        if (reward > 0) _credit(rewardTo, reward);
        _distributeFee(fee);
        emit MarginSettled(user, lockedAmount, toUser, fee, reward, rewardTo);
    }

    function collectPremium(address user, uint256 premium, uint256 fee) external onlyEngine {
        _debit(user, premium + fee);
        poolAmount += premium;
        _distributeFee(fee);
    }

    function payFromPool(address user, uint256 amount, uint256 fee) external onlyEngine {
        if (fee > amount) revert InvalidParams();
        if (poolAmount < amount) revert InsufficientPool();
        poolAmount -= amount;
        _credit(user, amount - fee);
        _distributeFee(fee);
    }

    function poolToPayable(uint256 amount) external onlyEngine {
        if (poolAmount < amount) revert InsufficientPool();
        poolAmount -= amount;
        optionsPayable += amount;
    }

    function payFromPayable(address user, uint256 amount, uint256 fee) external onlyEngine {
        if (fee > amount || optionsPayable < amount) revert InvalidParams();
        optionsPayable -= amount;
        _credit(user, amount - fee);
        _distributeFee(fee);
    }

    function reserve(uint256 amount) external onlyEngine {
        uint256 next = reservedAmount + amount;
        if (next * BPS > poolAmount * riskManager.maxUtilizationBps()) revert UtilizationExceeded();
        reservedAmount = next;
    }

    function release(uint256 amount) external onlyEngine {
        reservedAmount = amount > reservedAmount ? 0 : reservedAmount - amount;
    }

    function adjustDeferred(int256 delta) external onlyEngine {
        if (delta >= 0) {
            optionsDeferred += uint256(delta);
        } else {
            uint256 d = uint256(-delta);
            optionsDeferred = d > optionsDeferred ? 0 : optionsDeferred - d;
        }
    }

    // ---------------------------------------------------------------- views

    /// @notice Everything the vault owes; always equal to its USDC balance.
    function accountedAssets() external view returns (uint256) {
        return totalBalances + totalLocked + poolAmount + optionsPayable;
    }

    function utilizationBps() external view returns (uint256) {
        return poolAmount == 0 ? 0 : (reservedAmount * BPS) / poolAmount;
    }

    // ---------------------------------------------------------------- internal

    function _credit(address user, uint256 amount) internal {
        if (amount == 0) return;
        if (user == address(0)) revert InvalidParams();
        balances[user] += amount;
        totalBalances += amount;
    }

    function _debit(address user, uint256 amount) internal {
        if (balances[user] < amount) revert InsufficientCollateral();
        balances[user] -= amount;
        totalBalances -= amount;
    }

    function _distributeFee(uint256 fee) internal {
        if (fee == 0) return;
        (uint256 toPool, uint256 toBuyback, uint256 toTreasury) = feeManager.split(fee);
        poolAmount += toPool;
        if (toBuyback > 0) _credit(feeManager.buybackReceiver(), toBuyback);
        if (toTreasury > 0) _credit(feeManager.treasury(), toTreasury);
        emit ProtocolFeeCollected(fee, toPool, toBuyback, toTreasury);
    }

    /// Locked shares cannot move, so a transfer cannot skip the lock (and nobody can extend someone else's).
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && block.timestamp < lpUnlockAt[from]) revert LiquidityLocked();
        super._update(from, to, value);
    }
}
