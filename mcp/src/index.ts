#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

// Determine path to IDL
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const idlPath = path.join(__dirname, "stableperp.json");

let idl: any;
try {
  idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
} catch (error) {
  console.error("Warning: Could not load stableperp.json IDL. Ensure it is copied to the dist/ directory.");
}

if (!process.env.RPC_URL) {
  console.error("FATAL ERROR: RPC_URL environment variable is missing.");
  process.exit(1);
}
const RPC_URL = process.env.RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

if (!process.env.PROGRAM_ID) {
  console.error("FATAL ERROR: PROGRAM_ID environment variable is missing.");
  process.exit(1);
}
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);

// We define the minimal UI base URL to generate trade links.
if (!process.env.WEB_UI_BASE_URL) {
  console.error("FATAL ERROR: WEB_UI_BASE_URL environment variable is missing.");
  process.exit(1);
}
const WEB_UI_BASE_URL = process.env.WEB_UI_BASE_URL;

const server = new Server(
  {
    name: "stableperp-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- TOOLS DEFINITION ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_markets_liquidity",
        description: "Fetches all Stableperp options markets directly from the Solana blockchain and filters them by available liquidity.",
        inputSchema: {
          type: "object",
          properties: {
            assetSymbol: {
              type: "string",
              description: "Optional asset symbol to filter (e.g., 0700.HK, 1810.HK, BABA)",
            },
          },
        },
      },
      {
        name: "get_wallet_portfolio",
        description: "Fetches open Stableperp options positions (spl-tokens) for a specific Solana wallet directly from the blockchain.",
        inputSchema: {
          type: "object",
          properties: {
            walletAddress: {
              type: "string",
              description: "The Solana wallet public key (base58 string)",
            },
          },
          required: ["walletAddress"],
        },
      },
      {
        name: "generate_trade_link",
        description: "Generates a URL that redirects the user to the web UI to securely execute an option trade.",
        inputSchema: {
          type: "object",
          properties: {
            marketId: {
              type: "string",
              description: "The pubkey of the Market PDA",
            },
            action: {
              type: "string",
              description: "The action to perform: 'buy_call', 'sell_call', 'buy_put', 'sell_put'",
            },
          },
          required: ["marketId", "action"],
        },
      },
    ],
  };
});

// --- TOOL EXECUTION ROUTING ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_markets_liquidity":
        return await handleGetMarketsLiquidity(args);
      case "get_wallet_portfolio":
        return await handleGetWalletPortfolio(args);
      case "generate_trade_link":
        return await handleGenerateTradeLink(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// --- TOOL IMPLEMENTATIONS ---

async function handleGetMarketsLiquidity(args: any) {
  if (!idl) {
    throw new Error("IDL is missing. Cannot fetch on-chain markets.");
  }

  const symbolFilter = args?.assetSymbol?.toUpperCase();
  const provider = new anchor.AnchorProvider(connection, {} as any, { commitment: "confirmed" });
  // Cast IDL and Program to any to avoid complex IDL type resolution errors without generating types
  const program = new anchor.Program(idl as any, provider) as any;

  // Fetch symbol and strike mappings from backend API
  const apiMap: Record<string, { symbol: string; strike: number }> = {};
  try {
    const res = await fetch("https://stableperp-api-production.up.railway.app/api/markets?network=mainnet-beta");
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      json.data.forEach((m: any) => {
        if (m.address && m.symbol) {
          apiMap[m.address] = { symbol: m.symbol, strike: m.strike };
        }
      });
    }
  } catch (e) {
    console.warn("Failed to fetch market mappings from API", e);
  }

  // Fetch all Market accounts from the blockchain
  const allMarkets = await program.account.market.all();

  // Also fetch WriterPositions to determine liquidity
  const allWriters = await program.account.writerPosition.all();

  let results: any[] = [];

  for (const mkt of allMarkets) {
    const marketId = mkt.publicKey.toBase58();
    const mapped = apiMap[marketId];
    
    // Resolve symbol using API mapping, fallback to Unknown
    let symbol = mapped ? mapped.symbol : "Unknown/USDC";
    
    if (symbolFilter && !symbol.includes(symbolFilter)) {
      continue;
    }

    const strike = mapped ? mapped.strike : mkt.account.strike.toNumber() / (10 ** 6);

    // Find writers for this market
    const marketWriters = allWriters.filter((w: any) => w.account.market.toBase58() === marketId);
    let totalLiquidity = 0;
    let minPremium = Infinity;

    for (const w of marketWriters) {
      const minted = w.account.mintedAmount.toNumber() / (10 ** 6);
      const filled = w.account.filledAmount.toNumber() / (10 ** 6);
      const available = minted - filled;
      
      if (available > 0) {
        totalLiquidity += available;
        const premium = w.account.premiumAsk.toNumber() / (10 ** 6);
        if (premium < minPremium) {
          minPremium = premium;
        }
      }
    }

    results.push({
      marketId,
      symbol,
      strike,
      totalLiquidity,
      minPremium: minPremium === Infinity ? null : minPremium
    });
  }

  if (results.length === 0) {
    return {
      content: [{ type: "text", text: "No markets found on the blockchain." }],
    };
  }

  const outputText = 
    `Found ${results.length} markets on-chain.\n\n` +
    results.map(m => 
      `- ${m.symbol} Strike: $${m.strike}\n` +
      `  Market ID: ${m.marketId}\n` +
      `  Liquidity: ${m.totalLiquidity > 0 ? m.totalLiquidity + " Options Available" : "NO LIQUIDITY (Requires Writer)"}\n` +
      `  Lowest Premium: ${m.minPremium !== null ? "$" + m.minPremium : "N/A"}`
    ).join("\n\n");

  return {
    content: [{ type: "text", text: outputText }],
  };
}

async function handleGetWalletPortfolio(args: any) {
  const walletAddress = args.walletAddress;
  
  if (!walletAddress) {
    throw new Error("walletAddress is required");
  }

  let walletKey: PublicKey;
  try {
    walletKey = new PublicKey(walletAddress);
  } catch {
    throw new Error("Invalid Solana wallet address");
  }

  if (!idl) {
    throw new Error("IDL is missing. Cannot parse positions.");
  }

  // 1. Fetch ALL token accounts for this wallet
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletKey, {
    programId: TOKEN_PROGRAM_ID,
  });

  // 2. Fetch WriterPositions to detect shorts
  const provider = new anchor.AnchorProvider(connection, {} as any, { commitment: "confirmed" });
  const program = new anchor.Program(idl as any, provider) as any;

  // Fetch symbol and strike mappings from backend API
  const apiMap: Record<string, { symbol: string; strike: number }> = {};
  try {
    const res = await fetch("https://stableperp-api-production.up.railway.app/api/markets?network=mainnet-beta");
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      json.data.forEach((m: any) => {
        if (m.address && m.symbol) {
          apiMap[m.address] = { symbol: m.symbol, strike: m.strike };
        }
      });
    }
  } catch (e) {
    console.warn("Failed to fetch market mappings from API", e);
  }

  const allWriters = await program.account.writerPosition.all();
  
  const userWriters = allWriters.filter((w: any) => w.account.writer.toBase58() === walletKey.toBase58());

  // 3. Format response
  let portfolioText = `Real-time Portfolio for ${walletAddress}:\n\n`;
  let hasPositions = false;

  // Process Longs (Spl Token holdings)
  // Note: Matching these to markets requires full market traversal, we simplify for now
  portfolioText += `**Long Positions (Options Held):**\n`;
  let longsFound = 0;
  for (const ta of tokenAccounts.value) {
    const accountData = ta.account.data.parsed.info;
    const rawAmount = parseInt(accountData.tokenAmount.amount);
    const amount = rawAmount / (10 ** 6); // 1 Option = 10^6

    if (amount > 0 && accountData.mint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") { 
      // Filter out standard USDC, we only want option mints
      portfolioText += `- Option Mint: ${accountData.mint} | Size: ${amount}\n`;
      longsFound++;
      hasPositions = true;
    }
  }
  if (longsFound === 0) portfolioText += `- No Long Positions.\n`;

  portfolioText += `\n**Short Positions (Written Options):**\n`;
  if (userWriters.length > 0) {
    hasPositions = true;
    userWriters.forEach((w: any) => {
      const minted = w.account.mintedAmount.toNumber() / (10 ** 6);
      const locked = w.account.lockedAmount.toNumber() / (10 ** 6);
      const marketId = w.account.market.toBase58();
      const mapped = apiMap[marketId];
      const symbol = mapped ? mapped.symbol : "Unknown/USDC";
      portfolioText += `- ${symbol} (Market: ${marketId}) | Minted (Sold): ${minted} | Locked Collateral: ${locked}\n`;
    });
  } else {
    portfolioText += `- No Short Positions.\n`;
  }

  if (!hasPositions) {
    portfolioText = `No open Stableperp positions found for ${walletAddress}.`;
  }

  return {
    content: [{
      type: "text",
      text: portfolioText
    }],
  };
}

async function handleGenerateTradeLink(args: any) {
  const { marketId, action } = args;

  if (!marketId || !action) {
    throw new Error("marketId and action are required");
  }

  const tradeUrl = `${WEB_UI_BASE_URL}/terminal?market=${encodeURIComponent(marketId)}&action=${encodeURIComponent(action)}`;
  
  return {
    content: [{
        type: "text",
        text: `To safely execute this trade, please visit the following secure Stableperp link:\n${tradeUrl}\n\nYour browser wallet will prompt you to review and sign the transaction.`
      }
    ]
  };
}

// --- START SERVER ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Stableperp MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
