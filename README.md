# HanMarket

Options tunai (cash-settled) untuk saham Hong Kong dan China ADR, dibayar dalam USDC, di **Robinhood Chain** (Ethereum L2 berbasis Arbitrum).

| Folder | Isi | Jalan di |
|---|---|---|
| `contracts/` | Smart contract Solidity (Foundry) | WSL Ubuntu |
| `api/` | API harga dan chart, keeper settlement, script membuat market | Windows (Node 22) |
| `web/` | Website React + Vite + wallet EVM (RainbowKit/wagmi) | Windows, deploy ke Vercel |
| `mcp/` | Server MCP lama, **belum diperbarui** (masih versi Solana) | — |

> ⚠️ Kontrak belum diaudit. Gunakan testnet saja.

## Cara kerja singkat

- **Writer** mengunci USDC sebesar `cap` per kontrak (payout maksimum) dan memasang harga (ask).
- **Buyer** membayar ask writer dan menerima token opsi (ERC-1155).
- Setelah expiry, market di-settle **sekali**:
  - **Alibaba (BABA):** feed Chainlink *Robinhood BABA / USD*. Kontrak hanya menerima round terakhir sebelum expiry, jadi harga tidak bisa dimanipulasi.
  - **Saham lain:** belum ada feed onchain di Robinhood Chain, jadi harganya ditandatangani server HanMarket (EIP-712). User harus percaya harga ini, dan UI menandainya "HanMarket".
  - Kalau tidak ada harga valid sampai masa *grace* habis, owner bisa settle manual. Settlement manual ini tercatat onchain.
- **Holder** redeem payout, dan **writer** klaim sisa collateral.

Frontend membaca market, order book, dan posisi **langsung dari kontrak**, jadi tidak perlu database atau indexer.

## Jaringan

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 46630 | 4663 |
| RPC (tidak diblokir ISP) | `https://robinhood-sepolia-rpc.publicnode.com` | `https://robinhood-rpc.publicnode.com` |
| Gas | ETH testnet (faucet) | ETH |
| USDC | MockUSDC dari script deploy (bisa di-mint) | USDC asli |

> Provider seperti Telkomsel "Internet Baik" memblokir `*.robinhood.com`. Karena itu project ini memakai RPC pihak ketiga.

## 1. Kontrak (WSL Ubuntu)

```bash
cd ~/hanperp/contracts-evm          # salinan dari D:\...\contracts (lihat script sinkronisasi di bawah)
forge build
forge test                          # 17 tes: siklus lengkap, serangan, fuzz solvency
ROBINHOOD_MAINNET_RPC=https://robinhood-rpc.publicnode.com forge test --match-contract HanPerpFork -vv   # tes dengan feed BABA asli
```

Deploy ke testnet (wallet operator harus punya ETH testnet):

```bash
export ROBINHOOD_TESTNET_RPC=https://robinhood-sepolia-rpc.publicnode.com
export PRICE_SIGNER=0x...           # alamat price signer
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --private-key $(cat ~/hanperp/keys/operator.key) --broadcast
```

Untuk mainnet, isi juga `USDC_ADDRESS` dan `BABA_FEED=0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984`.

## 2. API (`api/`)

```bash
cd api
npm install
copy .env.example .env              # isi TESTNET_OPTIONS_ADDRESS, KEEPER_PRIVATE_KEY, PRICE_SIGNER_KEY, OWNER_PRIVATE_KEY
npm run dev                         # http://localhost:8080 (keeper jalan tiap 5 menit kalau key diisi)

npm run markets:create -- --network testnet     # buat market minggu depan (5 strike, call + put)
npm run markets:seed                            # testnet: pasang offer supaya ada yang bisa dibeli
npx ts-node scripts/check-settlement-price.ts 0700.HK 2026-09-17T08:00:00Z
```

## 3. Web (`web/`)

```bash
cd web
npm install
npm run dev                         # http://localhost:5173
```

`web/.env`:

```
VITE_API_URL=http://localhost:8080/api
VITE_TESTNET_OPTIONS_ADDRESS=0x...
VITE_MAINNET_OPTIONS_ADDRESS=
VITE_WALLETCONNECT_PROJECT_ID=      # opsional, gratis dari cloud.reown.com (untuk wallet HP / QR)
```

Deploy: `vercel deploy --prod` dari folder `web/` (project Vercel: `hanperp`, domain https://hanperp.vercel.app). Di Vercel, `/api/prices` dan `/api/candles` jalan sebagai serverless function (`web/api/`).
