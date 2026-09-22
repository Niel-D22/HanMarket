import { getAddress, isAddress, type Address } from 'viem';

// Protocol addresses per network, from one JSON env var each (printed by contracts/script/Deploy.s.sol):
//   VITE_TESTNET_DEPLOYMENT={"collateralToken":"0x..","marketRegistry":"0x..",...,"startBlock":123}
// Read by the web app (import.meta.env) and by the serverless functions (process.env).

export type NetworkKey = 'testnet' | 'mainnet';

export interface Deployment {
  collateralToken: Address;
  marketRegistry: Address;
  oracleRouter: Address;
  feeManager: Address;
  riskManager: Address;
  vault: Address;
  optionsEngine: Address;
  perpsEngine: Address;
  /** block the contracts were deployed at; event scans start here */
  startBlock: number;
}

const KEYS = [
  'collateralToken', 'marketRegistry', 'oracleRouter', 'feeManager', 'riskManager', 'vault', 'optionsEngine', 'perpsEngine',
] as const;

export function parseDeployment(raw: string | undefined): Deployment | null {
  if (!raw?.trim()) return null;
  try {
    const json = JSON.parse(raw);
    const out: Record<string, unknown> = { startBlock: Number(json.startBlock ?? 0) };
    for (const k of KEYS) {
      if (typeof json[k] !== 'string' || !isAddress(json[k])) return null;
      out[k] = getAddress(json[k]);
    }
    return out as unknown as Deployment;
  } catch {
    return null;
  }
}
