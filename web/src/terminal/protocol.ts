import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { usePublicClient, useSwitchChain, useWalletClient, useAccount } from 'wagmi';
import type { Account, Address, Chain, Hash, PublicClient, Transport, WalletClient } from 'viem';
import { useNetwork, type NetworkKey } from '../contexts/NetworkContext';
import { CHAINS } from '../web3/chains';
import {
  erc20Abi, feeAbi, optionsAbi, optionsEventsAbi, oracleAbi, perpsAbi, registryAbi, riskAbi, vaultAbi,
} from '../../api/_lib/protocol/abis';
import { parseDeployment, type Deployment } from '../../api/_lib/protocol/deployments';

// Everything the terminal reads from the HanMarket contracts, plus one transaction runner.
// Addresses come from VITE_TESTNET_DEPLOYMENT / VITE_MAINNET_DEPLOYMENT (printed by the deploy script).

const DEPLOYMENTS = {
  testnet: parseDeployment(import.meta.env.VITE_TESTNET_DEPLOYMENT as string | undefined),
  mainnet: parseDeployment(import.meta.env.VITE_MAINNET_DEPLOYMENT as string | undefined),
};

export const usd = (v: bigint) => Number(v) / 1e6;
export const toUsd6 = (n: number) => BigInt(Math.round(n * 1e6));
const REFRESH = 10_000;

export interface ProtocolContext {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  chain: Chain;
  d: Deployment | null;
  client: PublicClient | undefined;
}

/** The selected network, its chain, its deployment (null until deployed) and a read client. */
export function useProtocol(): ProtocolContext {
  const { network, setNetwork } = useNetwork();
  const chain = CHAINS[network];
  const client = usePublicClient({ chainId: chain.id }) as PublicClient | undefined;
  return { network, setNetwork, chain, d: DEPLOYMENTS[network], client };
}

function useReads<T>(key: unknown[], enabled: boolean, fn: (client: PublicClient, d: Deployment) => Promise<T>, refetchInterval = REFRESH) {
  const { network, d, client } = useProtocol();
  return useQuery({
    queryKey: ['hm', network, ...key],
    enabled: enabled && !!d && !!client,
    refetchInterval,
    queryFn: () => fn(client!, d!),
  });
}

// ---------------------------------------------------------------- markets

export interface PerpRisk {
  maxLeverage: number;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  maxProfitBps: number;
  fundingInterval: number;
  maxPriceAge: number;
  fundingRatePerInterval: bigint;
  maxPositionNotional: bigint;
  openInterestCap: bigint;
}

export interface PerpMarket {
  id: number;
  symbol: string; // "BABA-PERP"
  assetSymbol: string; // "BABA"
  active: boolean;
  tradingOpen: boolean;
  risk: PerpRisk;
  indexPrice: number;
  priceTime: number;
  longOi: number;
  shortOi: number;
  fundingRate: number; // per interval, + = longs pay
  nextFunding: number;
}

export interface Fees {
  takerFee: number; // bps
  optionOpenFee: number;
  optionCloseFee: number;
  settlementFee: number;
  liquidationFee: number;
}

export interface ProtocolState {
  perps: PerpMarket[];
  fees: Fees;
  assets: { id: number; symbol: string; optionsEnabled: boolean; perpsEnabled: boolean; active: boolean }[];
}

export function useProtocolState() {
  return useReads<ProtocolState>(['state'], true, async (client, d) => {
    const [assetCount, perpCount, fees] = await Promise.all([
      client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'assetCount' }),
      client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }),
      client.readContract({ address: d.feeManager, abi: feeAbi, functionName: 'getFees' }),
    ]);
    const assets = (await Promise.all(Array.from({ length: Number(assetCount) }, (_, i) =>
      client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [i] }),
    ))).map((a, i) => ({ id: i, symbol: a.symbol, oracleId: a.oracleId, optionsEnabled: a.optionsEnabled, perpsEnabled: a.perpsEnabled, active: a.active }));

    const perps = await Promise.all(Array.from({ length: Number(perpCount) }, async (_, id): Promise<PerpMarket> => {
      const m = await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [id] });
      const asset = assets[m.assetId];
      const [risk, open, state, rate, next, price] = await Promise.all([
        client.readContract({ address: d.riskManager, abi: riskAbi, functionName: 'getPerpRisk', args: [id] }),
        client.readContract({ address: d.riskManager, abi: riskAbi, functionName: 'tradingOpen', args: [id] }),
        client.readContract({ address: d.perpsEngine, abi: perpsAbi, functionName: 'getMarketState', args: [id] }),
        client.readContract({ address: d.perpsEngine, abi: perpsAbi, functionName: 'currentFundingRate', args: [id] }),
        client.readContract({ address: d.perpsEngine, abi: perpsAbi, functionName: 'nextFundingTime', args: [id] }),
        client.readContract({ address: d.oracleRouter, abi: oracleAbi, functionName: 'getPrice', args: [asset.oracleId] })
          .catch(() => [0n, 0n] as const),
      ]);
      return {
        id,
        symbol: m.symbol,
        assetSymbol: asset.symbol,
        active: m.active,
        tradingOpen: open,
        risk: { ...risk, maxLeverage: Number(risk.maxLeverage) },
        indexPrice: usd(price[0]),
        priceTime: Number(price[1]),
        longOi: usd(state.longEntryNotional),
        shortOi: usd(state.shortEntryNotional),
        fundingRate: Number(rate) / 1e18,
        nextFunding: Number(next),
      };
    }));

    return {
      perps,
      assets: assets.map(({ oracleId: _o, ...a }) => a),
      fees: {
        takerFee: fees.takerFee, optionOpenFee: fees.optionOpenFee, optionCloseFee: fees.optionCloseFee,
        settlementFee: fees.settlementFee, liquidationFee: fees.liquidationFee,
      },
    };
  });
}

// ---------------------------------------------------------------- account

export interface AccountState {
  free: number;
  locked: number;
  wallet: number; // USDC in the wallet, outside the vault
  allowance: bigint;
  lpShares: bigint;
  lpValue: number;
  lpUnlockAt: number;
}

export function useAccountState(address?: Address) {
  return useReads<AccountState>(['account', address], !!address, async (client, d) => {
    const a = address!;
    const [free, locked, wallet, allowance, lpShares, lpUnlockAt] = await Promise.all([
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'balances', args: [a] }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'lockedMargin', args: [a] }),
      client.readContract({ address: d.collateralToken, abi: erc20Abi, functionName: 'balanceOf', args: [a] }),
      client.readContract({ address: d.collateralToken, abi: erc20Abi, functionName: 'allowance', args: [a, d.vault] }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'balanceOf', args: [a] }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'lpUnlockAt', args: [a] }),
    ]);
    const lpValue = lpShares > 0n
      ? await client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'previewRemoveLiquidity', args: [lpShares] }).catch(() => 0n)
      : 0n;
    return { free: usd(free), locked: usd(locked), wallet: usd(wallet), allowance, lpShares, lpValue: usd(lpValue), lpUnlockAt: Number(lpUnlockAt) };
  });
}

export interface VaultStats {
  nav: number;
  pool: number;
  reserved: number;
  free: number;
  utilization: number; // 0..1
  lpSupply: bigint;
}

export function useVaultStats() {
  return useReads<VaultStats>(['vault'], true, async (client, d) => {
    const [nav, pool, reserved, free, util, supply] = await Promise.all([
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'nav' }).catch(() => 0n),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'poolAmount' }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'reservedAmount' }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'freeLiquidity' }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'utilizationBps' }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: 'totalSupply' }),
    ]);
    return { nav: usd(nav), pool: usd(pool), reserved: usd(reserved), free: usd(free), utilization: Number(util) / 10_000, lpSupply: supply };
  }, 20_000);
}

// ---------------------------------------------------------------- positions

export interface PerpPosition {
  marketId: number;
  symbol: string;
  isLong: boolean;
  size: number; // shares
  collateral: number;
  entryPrice: number;
  markPrice: number;
  notional: number;
  pnl: number;
  fundingOwed: number;
  equity: number;
  leverage: number;
  liquidationPrice: number;
  marginRatio: number; // maintenance / equity
  liquidatable: boolean;
}

export function usePerpPositions(address: Address | undefined, markets: PerpMarket[] | undefined) {
  return useReads<PerpPosition[]>(['perpPositions', address, markets?.length], !!address && !!markets, async (client, d) => {
    const rows = await Promise.all(markets!.flatMap((m) => [true, false].map(async (isLong) => {
      const p = await client.readContract({ address: d.perpsEngine, abi: perpsAbi, functionName: 'positionInfo', args: [address!, m.id, isLong] })
        .catch(() => null);
      if (!p || p.size === 0n) return null;
      const equity = Number(p.equity) / 1e6;
      return {
        marketId: m.id,
        symbol: m.symbol,
        isLong,
        size: Number(p.size) / 1e18,
        collateral: usd(p.collateral),
        entryPrice: usd(p.entryPrice),
        markPrice: usd(p.markPrice),
        notional: usd(p.notional),
        pnl: Number(p.pnl) / 1e6,
        fundingOwed: usd(p.fundingOwed),
        equity,
        leverage: equity > 0 ? usd(p.notional) / equity : Infinity,
        liquidationPrice: p.liquidationPrice > 10n ** 30n ? Infinity : usd(p.liquidationPrice),
        marginRatio: equity > 0 ? usd(p.maintenanceMargin) / equity : Infinity,
        liquidatable: p.liquidatable,
      } satisfies PerpPosition;
    })));
    return rows.filter((r): r is PerpPosition => r !== null);
  });
}

export interface OptionSeries {
  id: number;
  assetId: number;
  isCall: boolean;
  settled: boolean;
  expiry: number;
  strike: number;
  cap: number;
  open: number;
  settlementPrice: number;
  payoutPerContract: number;
}

/** Every option series (a few hundred at most), for positions and history. */
export function useAllSeries() {
  return useReads<OptionSeries[]>(['series'], true, async (client, d) => {
    const count = Number(await client.readContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'seriesCount' }));
    const raw = await Promise.all(Array.from({ length: count }, (_, i) =>
      client.readContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'getSeries', args: [BigInt(i)] }),
    ));
    return raw.map((s, i) => ({
      id: i, assetId: s.assetId, isCall: s.isCall, settled: s.settled, expiry: Number(s.expiry),
      strike: usd(s.strike), cap: usd(s.cap), open: usd(s.open),
      settlementPrice: usd(s.settlementPrice), payoutPerContract: usd(s.payoutPerContract),
    }));
  }, 30_000);
}

export interface OptionHolding extends OptionSeries {
  contracts: number;
}

export function useOptionHoldings(address: Address | undefined, series: OptionSeries[] | undefined) {
  return useReads<OptionHolding[]>(['optionHoldings', address, series?.length], !!address && !!series?.length, async (client, d) => {
    const ids = series!.map((s) => BigInt(s.id));
    const balances = await client.readContract({
      address: d.optionsEngine, abi: optionsAbi, functionName: 'balanceOfBatch', args: [ids.map(() => address!), ids],
    });
    return series!.map((s, i) => ({ ...s, contracts: usd(balances[i]) })).filter((h) => h.contracts > 0);
  });
}

// ---------------------------------------------------------------- history

export interface HistoryRow {
  block: bigint;
  hash: Hash;
  kind: 'Perp open' | 'Perp update' | 'Perp close' | 'Liquidated' | 'Option buy' | 'Option sell' | 'Option redeem';
  market: string;
  detail: string;
  amount: number; // USDC paid (-) or received (+)
}

export function useHistory(address: Address | undefined, markets: PerpMarket[] | undefined, series: OptionSeries[] | undefined, assetSymbols: string[]) {
  return useReads<HistoryRow[]>(['history', address], !!address && !!markets && !!series, async (client, d) => {
    const from = BigInt(d.startBlock);
    const perpEvents = perpsAbi.filter((x) => x.type === 'event');
    const optEvents = optionsEventsAbi;
    const [perpLogs, optLogs] = await Promise.all([
      client.getLogs({ address: d.perpsEngine, events: perpEvents, args: { account: address } as never, fromBlock: from }).catch(() => []),
      client.getLogs({ address: d.optionsEngine, events: optEvents, args: { account: address } as never, fromBlock: from }).catch(() => []),
    ]);
    const perpName = (id: number) => markets!.find((m) => m.id === id)?.symbol ?? `PERP ${id}`;
    const seriesName = (id: bigint) => {
      const s = series![Number(id)];
      if (!s) return `Series ${id}`;
      return optionLabel(assetSymbols[s.assetId] ?? '?', s.expiry, s.strike, s.isCall);
    };
    const rows: HistoryRow[] = [];
    for (const l of perpLogs as unknown as { eventName: string; args: Record<string, never>; blockNumber: bigint; transactionHash: Hash }[]) {
      const a = l.args as Record<string, bigint | boolean | number | string>;
      const side = a.isLong ? 'Long' : 'Short';
      if (l.eventName === 'PerpPositionOpened') {
        rows.push({ block: l.blockNumber, hash: l.transactionHash, kind: 'Perp open', market: perpName(Number(a.marketId)), detail: `${side} ${fmtUsd(usd(a.sizeUsd as bigint))} @ ${fmtPrice(usd(a.price as bigint))}`, amount: -usd(a.fee as bigint) });
      } else if (l.eventName === 'PerpPositionUpdated') {
        rows.push({ block: l.blockNumber, hash: l.transactionHash, kind: 'Perp update', market: perpName(Number(a.marketId)), detail: `${side} @ ${fmtPrice(usd(a.price as bigint))}`, amount: Number(a.realizedPnl) / 1e6 - usd(a.fee as bigint) });
      } else if (l.eventName === 'PerpPositionClosed') {
        rows.push({ block: l.blockNumber, hash: l.transactionHash, kind: 'Perp close', market: perpName(Number(a.marketId)), detail: `${side} closed @ ${fmtPrice(usd(a.price as bigint))}`, amount: Number(a.realizedPnl) / 1e6 - usd(a.fee as bigint) });
      } else if (l.eventName === 'PositionLiquidated') {
        rows.push({ block: l.blockNumber, hash: l.transactionHash, kind: 'Liquidated', market: perpName(Number(a.marketId)), detail: `${side} @ ${fmtPrice(usd(a.price as bigint))}`, amount: usd(a.returned as bigint) });
      }
    }
    for (const l of optLogs as unknown as { eventName: string; args: Record<string, bigint>; blockNumber: bigint; transactionHash: Hash }[]) {
      const a = l.args;
      if (l.eventName === 'OptionPositionOpened') {
        rows.push({ block: l.blockNumber, hash: l.transactionHash, kind: 'Option buy', market: seriesName(a.seriesId), detail: `${usd(a.qty)} @ ${fmtUsd(usd(a.premium))}`, amount: -(usd(a.cost) + usd(a.fee)) });
      } else if (l.eventName === 'OptionPositionClosed') {
        rows.push({ block: l.blockNumber, hash: l.transactionHash, kind: 'Option sell', market: seriesName(a.seriesId), detail: `${usd(a.qty)} @ ${fmtUsd(usd(a.premium))}`, amount: usd(a.proceeds) - usd(a.fee) });
      } else if (l.eventName === 'OptionExercised') {
        rows.push({ block: l.blockNumber, hash: l.transactionHash, kind: 'Option redeem', market: seriesName(a.seriesId), detail: `${usd(a.qty)} contracts`, amount: usd(a.payout) - usd(a.fee) });
      }
    }
    return rows.sort((x, y) => Number(y.block - x.block));
  }, 30_000);
}

// ---------------------------------------------------------------- formatting

/** colour class for a signed amount: red gain, green loss (China convention), plain when zero */
export const tone = (n: number) => (n > 1e-9 ? 'up' : n < -1e-9 ? 'down' : '');

export const fmtUsd = (n: number, digits = 2) =>
  Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : '—';
export const fmtPrice = (n: number) => (Number.isFinite(n) && n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 }) : '—');
export const fmtCompact = (n: number) =>
  !Number.isFinite(n) ? '—' : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(2)}K` : n.toFixed(2);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const fmtExpiry = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
};
/** "BABA-25SEP26-115-C", the option identifier from the brief */
export const optionLabel = (symbol: string, expiry: number, strike: number, isCall: boolean) =>
  `${symbol}-${fmtExpiry(expiry)}-${+strike.toFixed(4)}-${isCall ? 'C' : 'P'}`;

// ---------------------------------------------------------------- transactions

export type Wallet = WalletClient<Transport, Chain, Account>;
/** One transaction of a flow: gets the connected wallet, returns the transaction hash. */
export type Step = (w: Wallet) => Promise<Hash>;

export type TxStage = 'idle' | 'preparing' | 'wallet' | 'confirming' | 'confirmed' | 'failed';

/**
 * Where a confirmed transaction left its result, so the toast can say what changed and take the trader
 * there. Without it a first-time trader sees a green tick and no idea that the option is now sitting in
 * another tab.
 */
export interface TxOutcome {
  /** what changed, in one sentence: "1 contract is now in your Options tab." */
  text: string;
  /** optional button that opens the panel holding the result */
  action?: { label: string; run: () => void };
}

export interface TxState {
  stage: TxStage;
  label: string;
  hash?: Hash;
  error?: string;
  outcome?: TxOutcome;
}

/**
 * Runs one or more contract calls: switches the wallet to the selected network, sends each call, waits for its
 * receipt and refreshes every protocol query. `steps` receive the wallet client and return a transaction hash.
 */
export function useTx() {
  const { chain, client } = useProtocol();
  const { data: wallet } = useWalletClient({ chainId: chain.id });
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ stage: 'idle', label: '' });

  const run = useCallback(async (label: string, steps: Step[], outcome?: TxOutcome) => {
    try {
      setState({ stage: 'preparing', label, outcome });
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      if (!wallet || !client) throw new Error('Connect a wallet first');
      let hash: Hash | undefined;
      for (const step of steps) {
        setState({ stage: 'wallet', label, hash, outcome });
        hash = await step(wallet as unknown as Wallet);
        setState({ stage: 'confirming', label, hash, outcome });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error('Transaction reverted');
      }
      setState({ stage: 'confirmed', label, hash, outcome });
      await queryClient.invalidateQueries({ queryKey: ['hm'] });
      return true;
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      const message = (err.shortMessage ?? err.message ?? 'Transaction failed').split('\n')[0];
      setState((s) => ({ ...s, stage: 'failed', error: /reject|denied/i.test(message) ? 'You rejected the request in your wallet' : message }));
      return false;
    }
  }, [chain.id, chainId, client, queryClient, switchChainAsync, wallet]);

  const reset = useCallback(() => setState({ stage: 'idle', label: '' }), []);
  return { state, run, reset, explorer: chain.blockExplorers?.default.url };
}
