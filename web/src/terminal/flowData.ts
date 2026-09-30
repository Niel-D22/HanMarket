import { useQuery } from '@tanstack/react-query';
import type { Address, Hash } from 'viem';
import { optionsEventsAbi, perpsAbi } from '../../api/_lib/protocol/abis';
import { scanLogs, useAllSeries, useProtocol, usd, type ProtocolState } from './protocol';

// Options Flow: every option trade on the protocol, newest first, so a viewer can see where money is
// going (calls or puts, bought or sold) without opening each market. Read straight from the
// OptionsEngine's own events; nothing here is an off-chain feed.

export interface FlowTrade {
  key: string;
  hash: Hash;
  block: bigint;
  time?: number; // unix seconds; missing when the RPC would not return the block
  symbol: string;
  isCall: boolean;
  strike: number;
  expiry: number;
  side: 'buy' | 'sell';
  contracts: number;
  premium: number; // per contract
  notional: number; // premium x contracts
  trader: Address;
}

export const SHOWN = 80;
/** Block timestamps never change, so each block is asked for once per page load. */
const blockTimes = new Map<bigint, number>();

export function useOptionsFlow(state: ProtocolState | undefined) {
  const { network, d, client, logClient } = useProtocol();
  const { data: series } = useAllSeries();
  return useQuery({
    queryKey: ['hm', network, 'flow', series?.length],
    enabled: !!d && !!client && !!state && !!series,
    refetchInterval: 20_000,
    queryFn: async (): Promise<FlowTrade[]> => {
      const logs = await scanLogs(`flow:${network}:${d!.optionsEngine}`, logClient, { address: d!.optionsEngine, events: optionsEventsAbi }, BigInt(d!.startBlock));
      const trades = (logs as unknown as { eventName: string; args: Record<string, bigint | Address>; blockNumber: bigint; transactionHash: Hash; logIndex: number }[])
        .filter((l) => l.eventName === 'OptionPositionOpened' || l.eventName === 'OptionPositionClosed')
        .slice(-SHOWN)
        .reverse();

      const fresh = [...new Set(trades.map((t) => t.blockNumber))].filter((b) => !blockTimes.has(b));
      await Promise.all(fresh.map(async (b) => {
        try {
          blockTimes.set(b, Number((await client!.getBlock({ blockNumber: b })).timestamp));
        } catch {
          // a missing time only blanks that cell
        }
      }));

      const out: FlowTrade[] = [];
      for (const l of trades) {
        const s = series![Number(l.args.seriesId as bigint)];
        const symbol = s ? state!.assets[s.assetId]?.symbol : undefined;
        if (!s || !symbol) continue;
        const premium = usd(l.args.premium as bigint);
        const contracts = usd(l.args.qty as bigint);
        out.push({
          key: `${l.transactionHash}-${l.logIndex}`,
          hash: l.transactionHash,
          block: l.blockNumber,
          time: blockTimes.get(l.blockNumber),
          symbol,
          isCall: s.isCall,
          strike: s.strike,
          expiry: s.expiry,
          side: l.eventName === 'OptionPositionOpened' ? 'buy' : 'sell',
          contracts,
          premium,
          notional: premium * contracts,
          trader: l.args.account as Address,
        });
      }
      return out;
    },
  });
}

// ---------------------------------------------------------------- volume per market

export interface MarketVolume { options: number; perps: number; trades: number }

/**
 * Traded volume per underlying since the testnet launch, summed from the engines' own events (the contracts keep no
 * running volume): option premium x contracts on buys and sells, and the notional of every perp position opened. It
 * reuses the Options Flow scan, so it costs one extra log read for the perp events.
 */
export function useVolumes(state: ProtocolState | undefined) {
  const { network, d, logClient } = useProtocol();
  const { data: series } = useAllSeries();
  return useQuery({
    queryKey: ['hm', network, 'volumes', series?.length, state?.perps.length],
    enabled: !!d && !!state && !!series,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Record<string, MarketVolume>> => {
      const [optLogs, perpLogs] = await Promise.all([
        scanLogs(`flow:${network}:${d!.optionsEngine}`, logClient, { address: d!.optionsEngine, events: optionsEventsAbi }, BigInt(d!.startBlock)),
        scanLogs(`perpvol:${network}:${d!.perpsEngine}`, logClient, { address: d!.perpsEngine, events: perpsAbi.filter((x) => x.type === 'event') }, BigInt(d!.startBlock)),
      ]);
      const out: Record<string, MarketVolume> = {};
      const add = (symbol: string | undefined, k: 'options' | 'perps', v: number) => {
        if (!symbol) return;
        const row = (out[symbol] ??= { options: 0, perps: 0, trades: 0 });
        row[k] += v;
        row.trades += 1;
      };
      for (const l of optLogs as { eventName: string; args: Record<string, bigint> }[]) {
        if (l.eventName !== 'OptionPositionOpened' && l.eventName !== 'OptionPositionClosed') continue;
        const s = series![Number(l.args.seriesId)];
        add(s ? state!.assets[s.assetId]?.symbol : undefined, 'options', usd(l.args.premium) * usd(l.args.qty));
      }
      for (const l of perpLogs as { eventName: string; args: Record<string, bigint | number> }[]) {
        if (l.eventName !== 'PerpPositionOpened') continue;
        add(state!.perps.find((m) => m.id === Number(l.args.marketId))?.assetSymbol, 'perps', usd(l.args.sizeUsd as bigint));
      }
      return out;
    },
  });
}
