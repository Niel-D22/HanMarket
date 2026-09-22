# HanMarket — Task List Menuju Mainnet (untuk dikerjakan bersama Gemini)

Dokumen ini untuk dibaca oleh AI lain (Gemini) atau developer baru yang belum tahu proyek ini sama
sekali. Berisi konteks penuh + daftar task berurutan. **Task berhenti tepat sebelum broadcast ke
mainnet** — task terakhir adalah checklist yang harus ditandatangani manusia, bukan dikerjakan AI.

---

## 0. Konteks proyek (baca dulu sebelum mengerjakan apa pun)

**HanMarket** = platform derivatif onchain (opsi + perpetual) untuk saham Hong Kong / China, di atas
**Robinhood Chain** (Arbitrum Orbit L2). Testnet chain ID `46630`, mainnet chain ID `4663`.

Model: vault-as-counterparty (bukan order book). Satu pool USDC (`Vault.sol`) jadi lawan transaksi
semua trader. Opsi = European cash-settled, capped payout. Perp = isolated margin, funding by skew.

Repo: `D:\BELAJAR WEB3\stableperp vChina\`
- `contracts/` — Foundry project (Solidity 0.8.24, OpenZeppelin v5.4, `via_ir = true`)
- `web/` — React + Vite terminal, di-deploy ke Vercel project **hanmarket**
- `api/` — Express API lokal + script operasional (create-markets, keeper, e2e test)

**Status sekarang: testnet sudah live dan terbukti jalan.**
- 9 kontrak dipasang, 119 transaksi, semua sukses.
- 192 seri opsi untuk 9 saham (BABA, 0700.HK, 9988.HK, 1810.HK, 1211.HK, PDD, JD, NIO, BIDU).
- Website live: https://hanmarket.vercel.app
- Uji end-to-end (mint → deposit → buy → sell) lulus, dan sudah dicoba manual lewat MetaMask oleh
  pemilik proyek — sukses, tx tercatat onchain.
- Belum diaudit. Belum ada modal asli. **Mainnet belum di-deploy, dan memang belum boleh.**

Alamat kontrak testnet (chain 46630), untuk referensi struktur — **jangan dipakai di mainnet**:
```
collateralToken (MockUSDC) 0x2848aB87bDA098bb58CF70D1747839D95108E1f4
marketRegistry              0x2e523c27c4686929D8F25176C2B7d934EFf959F9
oracleRouter                0xBE2cb42686E78A2E6c21f77C5f10e71c5394C097
feeManager                  0x698e84A0454182C7FD48325Ad11D67B2C35f64c8
riskManager                 0x1b4bf0748F3323839a61e71fAcC4547166b32Cf6
vault                       0xD2EAEf238dC7fd327df37ec336d706D7dA18eEDC
optionsEngine                0xC99F41a39a014E4b799E3183BF5f8eD2ECE8C036
perpsEngine                  0xE256Ac034dbF78460ba951b155031200d6478654
```
Deployer testnet: `0x3D47DB6B0B38F8361564c7e26451fbf676304f4F` (kunci di WSL, `~/hanperp/keys/`,
**tidak boleh dipakai ulang di mainnet**).

Script deploy: `contracts/script/Deploy.s.sol`. Dia sendiri menolak berjalan di mainnet
(`block.chainid == 4663`) kalau dua env berikut kosong:
```solidity
require(!mainnet, "set USDC_ADDRESS on mainnet");   // MockUSDC dilarang di mainnet
require(!mainnet || babaFeed != address(0), "set BABA_FEED on mainnet");
```
Ini pengaman yang **jangan dihapus atau dilewati** dengan cara apa pun.

---

## Aturan kerja untuk siapa pun (termasuk Gemini) yang meneruskan dokumen ini

1. **Jangan pernah menjalankan `--broadcast` ke chain ID 4663 (mainnet).** Sampai Task 9 di bawah
   ditandatangani manusia yang berwenang, semua kerja mainnet berhenti di simulasi (`forge script`
   tanpa `--broadcast`) atau di jaringan fork lokal.
2. **Jangan membuat, meminjam, atau menebak alamat USDC / feed harga.** Kalau tidak yakin sebuah
   alamat resmi, tulis "PERLU VERIFIKASI MANUSIA" dan berhenti di situ.
3. **Jangan pernah meminta atau menampilkan private key** siapa pun di chat, commit, atau log.
4. Kalau sebuah task butuh keputusan bisnis/hukum/modal yang bukan keputusan teknis, **tandai
   sebagai BLOCKED — perlu keputusan manusia** dan lanjut ke task lain yang tidak terhalang.

---

## Daftar Task

### Task 1 — Keeper (robot operasional) menyala terus di testnet
**Tujuan:** harga feed, sesi perp, settlement opsi, dan likuidasi berjalan otomatis tanpa dipicu manual.
- Kode: `api/src/keeper.ts`, dijalankan lewat `npm run keeper:once` atau proses cron.
- Env yang dibutuhkan sudah ada di `api/.env` (`KEEPER_PRIVATE_KEY`, `PRICE_SIGNER_KEY`,
  `TESTNET_DEPLOYMENT`, `PRICES_URL=https://hanmarket.vercel.app/api`).
- Pilih hosting: Railway, Render, Fly.io, atau VPS kecil. Jalankan sebagai proses long-running
  (bukan serverless) karena keeper melakukan polling tiap menit.
- **Cek dulu saldo gas operator** sebelum menjadwalkan apa pun:
  `cast balance 0x3D47DB6B0B38F8361564c7e26451fbf676304f4F --rpc-url https://robinhood-sepolia-rpc.publicnode.com`
  Kalau di bawah 0.0002 ETH, klaim lagi di https://faucet.zalalena.com/robinhood sebelum lanjut.
- **Selesai kalau:** log keeper jalan tanpa error "HTTP request failed" selama minimal 1 jam terus-menerus.

### Task 2 — Opsi otomatis mingguan untuk semua 33 saham
**Tujuan:** seri opsi baru dibuat otomatis tiap minggu, untuk seluruh katalog, bukan cuma 9 saham.
- Script: `api/scripts/create-markets.ts`, jalankan dengan `--symbols` kosong untuk semua saham.
- Jadwalkan lewat cron di hosting yang sama dengan Task 1, misalnya tiap Senin.
- **Selesai kalau:** `seriesCount()` di OptionsEngine bertambah otomatis tiap minggu tanpa dijalankan manual.

### Task 3 — Verifikasi source code kontrak di explorer
**Tujuan:** siapa pun bisa membaca source Solidity langsung dari explorer, bukan cuma bytecode.
- Alat: `forge verify-contract` (Foundry), target explorer testnet Robinhood Chain.
- Perlu API key/endpoint verifikasi explorer Robinhood — cek dokumentasi resmi mereka; kalau tidak
  ada endpoint verify publik, tandai **BLOCKED — perlu info dari tim Robinhood Chain**.
- **Selesai kalau:** halaman `https://explorer.testnet.chain.robinhood.com/address/<kontrak>` menampilkan
  tab "Contract" dengan source code, bukan cuma bytecode.

### Task 4 — Uji dengan pengguna nyata (bukan cuma script)
**Tujuan:** minimal 2-3 orang selain developer mencoba trading penuh: connect wallet, mint, deposit,
buy, sell, withdraw — dan semua masalah UX dicatat.
- Panduan langkah sudah ada (lihat riwayat chat proyek / minta ke pemilik proyek).
- Catat setiap error message asli yang muncul, screenshot, dan alamat wallet yang dipakai supaya bisa
  ditelusuri di explorer.
- **Selesai kalau:** ada catatan tertulis berisi minimal 3 sesi uji berbeda dan daftar bug/UX issue yang ditemukan.

### Task 5 — 11 fitur terminal yang tertunda (opsional, boleh paralel)
Daftar: 24h High/Low/Vol, timeframe intraday 1m–1D + OHLC legend, opsi chart TradingView untuk ADR,
tab Options Flow, tampilan All Expiries, watchlist yang bisa diedit + favorit, volume di sidebar,
panel yang bisa dilipat, shortcut navigasi Positions/Orders/History, baris "Settlement Token: USDC",
link X di top bar.
- Tidak menghalangi testnet publik atau audit. Kerjakan kalau ada waktu luang.

### Task 6 — Repo belum punya commit git
**Tujuan:** ada riwayat/cadangan kode.
- Semua file di repo statusnya "untracked" (belum pernah di-commit).
- `git add -A && git commit -m "..."` di root repo, lalu push ke remote privat.
- **Selesai kalau:** `git log` menunjukkan minimal satu commit, dan remote (GitHub privat/internal) punya salinannya.

### Task 7 — Audit keamanan (BLOCKED — keputusan & anggaran manusia)
**Tujuan:** pihak ketiga independen memeriksa seluruh kontrak sebelum menyentuh uang asli.
- Ini **bukan task yang bisa dikerjakan AI**. Yang bisa disiapkan AI/dev:
  - Bekukan/tag versi kode yang akan diaudit (`git tag audit-candidate-v1`).
  - Siapkan dokumen ringkas: daftar kontrak, alur uang, daftar 34 tes yang sudah lulus, dan
    known-limitations (misal: harga saham selain BABA memakai signed price dari server, bukan Chainlink).
  - Hasil akhir Task 7 = laporan audit + semua temuan **critical/high sudah diperbaiki dan diuji ulang**.
- **BLOCKED sampai:** anggaran dan auditor dipilih oleh pemilik proyek/perusahaan.

### Task 8 — Kesiapan operasional & legal (sebagian BLOCKED — keputusan manusia)
Bukan task teknis, tapi wajib selesai sebelum Task 9:
- ✅ **Token collateral resmi ditemukan: USDG, bukan USDC.** Robinhood Chain memilih USDG (Global
  Dollar, diterbitkan Paxos, konsorsium termasuk Robinhood sendiri) sebagai stablecoin native-nya —
  bukan USDC. Dikonfirmasi lewat search independen (KuCoin, CryptoBriefing, globaldollar.com/newsroom)
  dan diverifikasi manual oleh pemilik proyek di `robinhoodchain.blockscout.com`:
  ```
  0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  ```
  Sinyal verifikasi yang dicek: badge "Contract ✓" (source terverifikasi), website resmi
  `globaldollar.com` tertaut di halaman token, **369.550 holder**, **230.617.208 transfer**,
  market cap **$3,27 miliar**, decimals 6. Di antara 50+ token bernama sama yang muncul saat
  pencarian "USDG" di explorer (mayoritas tiruan/scam tanpa badge dan tanpa harga), ini satu-satunya
  dengan verified badge dan harga $1 tertera. Kontrak kita bersifat generik (`IERC20 collateralToken`),
  jadi tidak masalah walau namanya bukan literal "USDC" — variabel deploy `USDC_ADDRESS` cukup diisi
  alamat USDG ini.
- **Dompet multisig** (misal Safe) untuk `OWNER` dan `TREASURY` di deploy mainnet — dibuat dan
  ditandatangani oleh minimal 2-3 orang berwenang, bukan satu kunci di satu laptop. **BLOCKED.**
- **Modal likuiditas asli** yang akan disetor ke Vault — sumber dana dan jumlah awal disepakati.
  Saran dari diskusi eksternal: mulai dari modal sendiri, seminimal mungkin, jangan langsung buka ke
  LP publik. **BLOCKED — keputusan pemilik proyek.**
- **Kajian legal**: apakah produk derivatif saham ini butuh izin di yurisdiksi target. **BLOCKED.**
- **BLOCKED sampai:** tiga poin terakhir di atas punya jawaban tertulis dari pemilik proyek.

### Task 9 — Checklist final sebelum broadcast mainnet (WAJIB tanda tangan manusia)
**AI tidak boleh mencentang task ini sendiri.** Sebelum siapa pun menjalankan
`forge script script/Deploy.s.sol --rpc-url <mainnet-rpc> --broadcast` ke chain 4663:

- [ ] Task 7 (audit) selesai, semua temuan critical/high sudah diperbaiki dan diuji ulang.
- [ ] Task 8 (multisig, modal, legal) selesai dan terverifikasi.
- [x] `USDC_ADDRESS` mainnet (isi dengan alamat USDG) sudah dicek langsung oleh manusia berwenang di
      block explorer resmi: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. Cek ulang sesaat sebelum
      broadcast — alamat token bisa saja berganti seiring waktu.
- [ ] `BABA_FEED` = `0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984` (Chainlink "Robinhood X BABA/USD")
      sudah dicek bahwa alamat ini masih aktif dan benar di dokumentasi Chainlink terbaru.
- [ ] Dompet deployer mainnet baru (bukan dompet testnet) sudah diisi ETH asli secukupnya.
- [ ] `OWNER` dan `TREASURY` di-set ke alamat multisig, bukan alamat deployer pribadi.
- [ ] Simulasi (`forge script` **tanpa** `--broadcast`) sudah dijalankan dan hasilnya direview manusia.
- [ ] Minimal dua orang berwenang menyetujui secara tertulis untuk lanjut broadcast.

**Begitu semua kotak di atas dicentang oleh manusia**, langkah broadcast teknisnya sama persis
dengan testnet (script yang sama, RPC dan env yang beda) — dan itu instruksi terpisah yang akan
diberikan setelah Task 9 selesai, bukan bagian dari dokumen ini.

---

## Ringkasan untuk Gemini
Kerjakan Task 1 → 2 → 3 → 4 → 5 → 6 secara berurutan atau paralel sesuai kapasitas. Task 7 dan 8
tandai BLOCKED dan laporkan balik ke pemilik proyek untuk keputusan. **Jangan mengerjakan atau
mendekati Task 9 sampai diminta eksplisit oleh manusia dengan bukti Task 7 dan 8 sudah selesai.**
