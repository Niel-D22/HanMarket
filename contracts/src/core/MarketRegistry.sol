// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

/**
 * @title Market registry
 * @notice The single list of underlyings and perpetual markets. The engines, the keeper, the SDK and the
 *         web app all read it, so a new market is added here once instead of in every service.
 */
contract MarketRegistry is IMarketRegistry, Ownable2Step {
    Asset[] internal _assets;
    PerpMarket[] internal _perps;
    /// keccak256(symbol) of every asset and perp market, so symbols stay unique
    mapping(bytes32 => bool) public symbolTaken;

    event AssetAdded(
        uint32 indexed assetId, string symbol, bytes32 oracleId, address token, bool optionsEnabled, bool perpsEnabled
    );
    event AssetUpdated(uint32 indexed assetId, bool optionsEnabled, bool perpsEnabled, bool active);
    event MarketAdded(uint32 indexed marketId, string symbol, uint32 indexed assetId);
    event MarketUpdated(uint32 indexed marketId, bool active);

    error InvalidParams();
    error UnknownAsset();
    error UnknownMarket();
    error SymbolTaken();
    error PerpsDisabled();

    constructor(address owner_) Ownable(owner_) {}

    function addAsset(string calldata symbol, bytes32 oracleId, address token, bool optionsEnabled, bool perpsEnabled)
        external
        onlyOwner
        returns (uint32 assetId)
    {
        if (oracleId == bytes32(0)) revert InvalidParams();
        _claimSymbol(symbol);
        assetId = uint32(_assets.length);
        _assets.push(Asset(symbol, oracleId, token, optionsEnabled, perpsEnabled, true));
        emit AssetAdded(assetId, symbol, oracleId, token, optionsEnabled, perpsEnabled);
    }

    function updateAsset(uint32 assetId, bool optionsEnabled, bool perpsEnabled, bool active) external onlyOwner {
        Asset storage a = _asset(assetId);
        a.optionsEnabled = optionsEnabled;
        a.perpsEnabled = perpsEnabled;
        a.active = active;
        emit AssetUpdated(assetId, optionsEnabled, perpsEnabled, active);
    }

    function addPerpMarket(string calldata symbol, uint32 assetId) external onlyOwner returns (uint32 marketId) {
        Asset storage a = _asset(assetId);
        if (!a.perpsEnabled || !a.active) revert PerpsDisabled();
        _claimSymbol(symbol);
        marketId = uint32(_perps.length);
        _perps.push(PerpMarket(symbol, assetId, true));
        emit MarketAdded(marketId, symbol, assetId);
    }

    /// @notice Inactive perp markets stop every action, including liquidations. Use it for emergencies only.
    function setPerpMarketActive(uint32 marketId, bool active) external onlyOwner {
        if (marketId >= _perps.length) revert UnknownMarket();
        _perps[marketId].active = active;
        emit MarketUpdated(marketId, active);
    }

    // ---------------------------------------------------------------- views

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function getAsset(uint32 assetId) external view returns (Asset memory) {
        return _asset(assetId);
    }

    function perpMarketCount() external view returns (uint256) {
        return _perps.length;
    }

    function getPerpMarket(uint32 marketId) external view returns (PerpMarket memory) {
        if (marketId >= _perps.length) revert UnknownMarket();
        return _perps[marketId];
    }

    // ---------------------------------------------------------------- internal

    function _asset(uint32 assetId) internal view returns (Asset storage) {
        if (assetId >= _assets.length) revert UnknownAsset();
        return _assets[assetId];
    }

    function _claimSymbol(string calldata symbol) internal {
        uint256 len = bytes(symbol).length;
        if (len == 0 || len > 16) revert InvalidParams();
        bytes32 key = keccak256(bytes(symbol));
        if (symbolTaken[key]) revert SymbolTaken();
        symbolTaken[key] = true;
    }
}
