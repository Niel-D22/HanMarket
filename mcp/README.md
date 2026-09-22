# Stableperp MCP Server

An official Model Context Protocol (MCP) server for Stableperp - allowing AI agents (like Claude, Cursor, Windsurf) to securely interact with Stableperp options markets on the Solana blockchain.

## Features

This MCP server provides the following tools to AI Assistants:

- **`get_markets_liquidity`**: Fetches all available options markets from Stableperp and filters them by available liquidity. AI can instantly know which markets are active and ready to trade.
- **`get_wallet_portfolio`**: Fetches the open Long and Short options positions for any provided Solana wallet address.
- **`generate_trade_link`**: Safely prepares a transaction URL. Instead of having the AI sign a transaction directly (which is a security risk), the AI returns a secure deep-link to the Stableperp Web UI (https://stableperp.tech) where the user can review and sign the transaction using their browser wallet.

## Installation

You can run this server directly via `npx` in any compatible MCP client without installing it locally!

### Configuring in Cursor / Windsurf
1. Open Settings -> MCP.
2. Add a new MCP Server.
3. Name: `Stableperp`
4. Command: `npx`
5. Args: `-y stableperp-mcp@latest` (To always fetch the newest bug fixes) or point directly to the local dist file: `node /path/to/stableperp-mcp/dist/index.js`

### Configuring in Claude Desktop
Add the following to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "stableperp": {
      "command": "npx",
      "args": ["-y", "stableperp-mcp@latest"],
      "env": {
        "RPC_URL": "https://api.mainnet-beta.solana.com",
        "WEB_UI_BASE_URL": "https://stableperp.tech"
      }
    }
  }
}
```

*Note for Cursor / Windsurf:* You can set these environment variables directly within the MCP settings UI when adding the server.

## Updating / Troubleshooting
If your AI assistant is returning outdated or incorrect market data, it may be using a cached version of the MCP Server.
To force an update to the newest version (e.g., `>=1.0.3`):
- **Claude Desktop**: Quit the application completely (Cmd+Q / Ctrl+Q) and reopen it. This forces `npx` to check for the `@latest` tag.
- **Cursor/Windsurf**: Restart the MCP Server from the settings panel, or manually run `npx clear-npx-cache` in your terminal before restarting.

## Local Development

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Start the server locally for testing:
   ```bash
   npm start
   ```

## Environment Variables

- `RPC_URL`: Your Solana RPC endpoint (default: `https://api.mainnet-beta.solana.com`)
- `WEB_UI_BASE_URL`: The domain of the Stableperp Web UI for trade links (default: `https://stableperp.tech`)

## License
ISC
