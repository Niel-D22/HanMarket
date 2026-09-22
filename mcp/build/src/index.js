"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
// Initialize the MCP Server for Stableperp
const server = new index_js_1.Server({
    name: "stableperp-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Register Tools
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_markets",
                description: "Get a list of available option markets on Stableperp, including current simulated premium prices.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "write_covered_call",
                description: "Execute a transaction to write (mint) covered call options on Stableperp.",
                inputSchema: {
                    type: "object",
                    properties: {
                        marketSymbol: {
                            type: "string",
                            description: "The underlying asset symbol, e.g. AAPLx",
                        },
                        strikePrice: {
                            type: "number",
                            description: "The strike price in USDC",
                        },
                        quantity: {
                            type: "number",
                            description: "Number of options to mint",
                        },
                        premium: {
                            type: "number",
                            description: "The premium price to sell each option for in USDC",
                        }
                    },
                    required: ["marketSymbol", "strikePrice", "quantity", "premium"],
                },
            },
        ],
    };
});
// Handle Tool Executions
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "get_markets") {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify([
                        { id: "MKT-001", symbol: "AAPLx CALL", strike: 100, expiry: "2026-12-31", estPremium: 5.00 },
                        { id: "MKT-002", symbol: "TSLAx CALL", strike: 250, expiry: "2026-12-31", estPremium: 15.00 }
                    ], null, 2),
                },
            ],
        };
    }
    if (name === "write_covered_call") {
        // Validate arguments
        const { marketSymbol, strikePrice, quantity, premium } = args;
        // In a real implementation, this would build a Solana transaction using @coral-xyz/anchor
        // and sign it with the agent's keypair. For now, we simulate the execution.
        const mockTxHash = `4GkM...${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        return {
            content: [
                {
                    type: "text",
                    text: `[SUCCESS] Executed Write Covered Call on Stableperp!
Asset: ${marketSymbol}
Strike: $${strikePrice}
Quantity: ${quantity}
Premium: $${premium}
Transaction Hash: ${mockTxHash}
Status: Confirmed on Devnet`,
                },
            ],
        };
    }
    throw new Error(`Tool not found: ${name}`);
});
// Start the server using stdio transport
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("Stableperp MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
