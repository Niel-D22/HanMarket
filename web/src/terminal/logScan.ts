import type { Address, PublicClient } from 'viem';

// The public RPCs refuse eth_getLogs over a wide block range (publicnode: 50,000 blocks, dRPC's free plan:
// 10,000), and a refused call used to be swallowed as "no events", which left History and Options Flow empty
// for anything older than a few hours. scanLogs walks the range in windows the provider accepts, splits a
// window that is refused, and remembers how far it got, in memory and in localStorage, so a refresh (or the
// next visit) only reads the blocks since the last one. The first read of a long history is still slow on a
// free RPC, which is what stands in for an indexer here; on a chain with months of history one is the next step.

const WINDOW = 49_000n; // publicnode's cap is 50,000
const MIN_WINDOW = 5_000n;
const PARALLEL = 3; // the free RPCs answer 429 to more than a few at once, and a retry costs more than the wait
type Scan = { logs: unknown[]; next: bigint };
const scans = new Map<string, Scan>();
const scanning = new Map<string, Promise<unknown[]>>();

// Logs carry bigints, which JSON cannot hold, so they travel as { $big: "123" }.
const stash = (_: string, v: unknown) => (typeof v === 'bigint' ? { $big: v.toString() } : v);
const unstash = (_: string, v: unknown) => {
  const o = v as { $big?: unknown } | null;
  return o && typeof o === 'object' && typeof o.$big === 'string' ? BigInt(o.$big) : v;
};
function loadScan(key: string): Scan | undefined {
  try {
    const raw = localStorage.getItem(`hm-logs:${key}`);
    const saved = raw ? (JSON.parse(raw, unstash) as Scan) : undefined;
    return saved && typeof saved.next === 'bigint' && Array.isArray(saved.logs) ? saved : undefined;
  } catch {
    return undefined; // blocked, empty or unreadable: scan from the start
  }
}
function saveScan(key: string, scan: Scan) {
  try {
    const raw = JSON.stringify(scan, stash);
    if (raw.length < 1_000_000) localStorage.setItem(`hm-logs:${key}`, raw); // a long history stays in memory only
  } catch {
    // not persisted, which only means the next visit rescans
  }
}

interface LogQuery { address: Address; events: readonly unknown[]; args?: unknown }

async function readWindow(client: PublicClient, q: LogQuery, from: bigint, to: bigint): Promise<unknown[]> {
  try {
    return (await client.getLogs({ ...q, fromBlock: from, toBlock: to } as never)) as unknown[];
  } catch (e) {
    const span = to - from + 1n;
    // only a refused range is worth splitting; anything else (network down, bad params) should surface
    if (span <= MIN_WINDOW || !/range|limit|exceed|too many|too large/i.test(String((e as Error).message))) throw e;
    const mid = from + span / 2n;
    return [...(await readWindow(client, q, from, mid - 1n)), ...(await readWindow(client, q, mid, to))];
  }
}

async function readRange(client: PublicClient, q: LogQuery, from: bigint, to: bigint): Promise<unknown[]> {
  const windows: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += WINDOW) windows.push([s, s + WINDOW - 1n < to ? s + WINDOW - 1n : to]);
  const parts: unknown[][] = new Array(windows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, windows.length) }, async () => {
    while (next < windows.length) {
      const i = next++;
      parts[i] = await readWindow(client, q, windows[i][0], windows[i][1]);
    }
  }));
  return parts.flat();
}

/** Every log matching `q` from `startBlock` to the chain head, oldest first. `key` names the query for the cache. */
export function scanLogs(key: string, client: PublicClient, q: LogQuery, startBlock: bigint): Promise<unknown[]> {
  const running = scanning.get(key);
  if (running) return running;
  const job = (async () => {
    const head = await client.getBlockNumber();
    let seen = scans.get(key) ?? loadScan(key);
    if (seen && seen.next > head + 1n) seen = undefined; // saved from ahead of this chain: it was reset, so start over
    const from = seen?.next ?? startBlock;
    const logs = seen ? [...seen.logs] : [];
    if (from <= head) logs.push(...(await readRange(client, q, from, head)));
    const scan = { logs, next: head + 1n };
    scans.set(key, scan);
    saveScan(key, scan);
    return logs;
  })().finally(() => scanning.delete(key));
  scanning.set(key, job);
  return job;
}
