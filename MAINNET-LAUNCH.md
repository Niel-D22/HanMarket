# HanMarket: Runbook Launch Mainnet

Panduan langkah demi langkah dari "belum ada apa-apa di mainnet" sampai "pengguna bisa trading".
Semua perintah dijalankan dari **WSL (Ubuntu)** di folder repo, karena Foundry terpasang di sana:

```bash
cd "/mnt/d/BELAJAR WEB3/stableperp vChina"
bash contracts/script/mainnet/deploy-mainnet.sh <perintah>
```

Setiap perintah berhenti dengan tulisan merah **STOP: ...** kalau ada yang salah, sebelum mengirim transaksi apa pun.

---

## A. Persiapan (beberapa hari sebelum launch)

Keputusan yang harus sudah ada (lihat Task 7, 8, 9 di `MAINNET-PREP-TASKS.md`):
- Siapa 3 penandatangan multisig, dan berapa yang wajib setuju (disarankan 2 dari 3).
- Modal awal vault dalam USDG, lalu batas risiko yang sesuai dengan modal itu.
- Leverage mainnet: 3x (default) atau 10x.
- Status audit.

### A1. Buat wallet baru (jangan pakai wallet testnet)

| Wallet | Dipakai untuk | Disimpan di |
|---|---|---|
| Deployer | Membayar gas deploy, lalu tidak dipakai lagi | Keystore Foundry di laptop yang men-deploy |
| Keeper | Membuat seri opsi, sesi perp, settlement, likuidasi | Railway: `MAINNET_KEEPER_PRIVATE_KEY` |
| Price signer | Menandatangani harga settlement saham tanpa Chainlink | Railway: `MAINNET_PRICE_SIGNER_KEY` |
| Quote signer | Menandatangani harga opsi di terminal | Vercel: `MAINNET_QUOTE_SIGNER_KEY` |
| Safe multisig | Owner dan treasury semua kontrak | Kontrak Safe; dikendalikan 3 penandatangan (sebaiknya Ledger) |

Masukkan kunci deployer ke keystore Foundry (kunci dienkripsi dengan password, tidak pernah ditulis di file):
```bash
cast wallet import hanmarket-deployer --interactive
```

### A2. Isi ETH di Robinhood Chain (bridge dulu dari Ethereum atau Arbitrum)
- Deployer: **0,003 ETH** (deploy terpakai ±0,0016 ETH, sisanya cadangan).
- Keeper: **0,005 ETH** untuk hari pertama (membuat seri opsi pertama ±0,004 ETH untuk 33 saham).
- Salah satu penandatangan Safe: sedikit ETH untuk mengeksekusi transaksi Safe.

### A3. Deploy Safe multisig
```bash
cd api && npm run deploy:safe -- --network mainnet --owners 0xA,0xB,0xC --threshold 2 --dry-run
cd api && npm run deploy:safe -- --network mainnet --owners 0xA,0xB,0xC --threshold 2
```

### A4. Isi input launch
```bash
cp contracts/script/mainnet/mainnet.env.example contracts/script/mainnet/mainnet.env
```
Isi semua alamat (Safe, keeper, signer, deployer) dan batas risiko. File ini hanya berisi alamat, bukan kunci.

---

## B. Gladi resik (wajib, H-1 dan pagi hari launch)

```bash
bash contracts/script/mainnet/deploy-mainnet.sh rehearse
```
Perintah ini menjalankan **seluruh launch di salinan mainnet lokal** (tidak ada yang terkirim ke mainnet):
1. membuat Safe 2-dari-3 sungguhan,
2. menjalankan skrip deploy yang sama persis,
3. membaca ulang semua pengaturan,
4. Safe menerima kepemilikan (2 tanda tangan dan 1 eksekusi),
5. LP menyetor USDG asli, trader deposit, buka dan tutup perp BABA di harga Chainlink asli, beli opsi, jual sebagian,
6. waktu dimajukan melewati expiry: settlement, redeem, withdraw,
7. waktu dimajukan 1 hari: LP menarik likuiditas.

Lanjut hanya kalau hasil akhirnya **REHEARSAL PASSED**.

---

## C. Hari launch

### C1. Cek semua input di mainnet
```bash
bash contracts/script/mainnet/deploy-mainnet.sh check
```
Yang diperiksa: RPC benar-benar mainnet 4663, saldo deployer cukup, keystore ada, owner adalah Safe dengan threshold ≥ 2,
keeper dan signer bukan owner, USDG (6 desimal), feed Chainlink BABA (8 desimal, diperbarui < 3 hari), dan semua unit test lulus.

### C2. Deploy
```bash
bash contracts/script/mainnet/deploy-mainnet.sh deploy
```
Urutannya: `check` lagi, simulasi dengan estimasi biaya, lalu minta Anda mengetik **DEPLOY HANMARKET MAINNET**. Setelah itu
barulah transaksi dikirim. Hasilnya:
- `contracts/deployments/mainnet-4663.json`: semua alamat kontrak (ini yang diposting),
- pembacaan ulang otomatis (status "pending": Safe belum menerima kepemilikan),
- `contracts/deployments/mainnet-accept-ownership.json`: transaksi Safe yang siap ditandatangani.

### C3. Safe menerima kepemilikan ketujuh kontrak
Semua kontrak memakai Ownable2Step, jadi kepemilikan **belum pindah** sampai Safe menerimanya. Jangan lewati langkah ini.
```bash
# penandatangan 1, di komputernya sendiri (Ledger)
bash contracts/script/mainnet/deploy-mainnet.sh accept-sign --ledger
# penandatangan 2
bash contracts/script/mainnet/deploy-mainnet.sh accept-sign --ledger
# siapa pun yang punya sedikit ETH
bash contracts/script/mainnet/deploy-mainnet.sh accept-exec --account hanmarket-deployer
# pastikan semua sudah benar
bash contracts/script/mainnet/deploy-mainnet.sh verify accepted
```
Sebelum menandatangani, setiap penandatangan mencocokkan `safeTxHash` di file JSON dengan yang tampil di Ledger.

### C4. Nyalakan aplikasi untuk mainnet
**Vercel** (web dan API):
- `VITE_MAINNET_DEPLOYMENT` = isi `mainnet-4663.json` (satu baris JSON)
- `MAINNET_QUOTE_SIGNER_KEY` = kunci quote signer (tandai Sensitive)
- `MAINNET_RPC_URL` = URL Alchemy mainnet (untuk proxy `/api/rpc`, tandai Sensitive)
- lalu deploy ulang (`vercel deploy --prod`)

**Railway** (keeper):
- `MAINNET_DEPLOYMENT` = JSON yang sama
- `MAINNET_KEEPER_PRIVATE_KEY`, `MAINNET_PRICE_SIGNER_KEY`
- restart, lalu cek log: `[markets:mainnet] N created` dan tidak ada error

### C5. Isi vault (dari Safe)
Safe (atau LP yang disepakati) memanggil `approve` USDG ke Vault, lalu `addLiquidity(jumlah, 0)`. Setoran LP terkunci 24 jam.

### C6. Uji dengan nominal kecil, lalu umumkan
- Buka terminal mode Mainnet, deposit beberapa USDG, buka dan tutup perp BABA kecil, beli 1 kontrak opsi.
- Cek transaksinya di explorer mainnet.
- Setelah semua jalan, posting alamat kontrak (format seperti `X-POST-CONTRACTS.txt`, dengan link explorer mainnet).

---

## D. Catatan yang sudah diketahui

- **Wallet dengan delegasi EIP-7702 bisa gagal membeli opsi.** Opsi adalah token ERC-1155, sehingga alamat yang memiliki
  kode harus bisa menerima ERC-1155. Gladi resik menemukan bahwa akun uji Anvil di mainnet sudah didelegasikan ke kontrak
  "sweeper" dan menolak token opsi. Wallet biasa (MetaMask EOA, Rabby, Ledger) tidak terpengaruh. Pada hari launch, uji
  juga dengan MetaMask Smart Account kalau ingin mendukungnya.
- Terminal menampilkan **USDG** di mode Mainnet dan USDC di Testnet, otomatis.

## E. Kalau terjadi masalah

| Situasi | Tindakan |
|---|---|
| `check` atau `rehearse` gagal | Jangan deploy. Baca pesan STOP, perbaiki inputnya, ulangi. |
| Deploy berhenti di tengah | Jangan jalankan ulang begitu saja. Lihat `contracts/deployments/mainnet-deploy.log` dan `contracts/broadcast/`, catat kontrak yang sudah jadi, lalu diskusikan dulu. |
| `verify` menunjukkan [FAIL] | Jangan buka trading. Pengaturan bisa dikoreksi oleh owner (Safe) lewat fungsi `set...`. |
| Ada bug setelah trading dibuka | Owner (Safe) memanggil `pause()` di Vault, OptionsEngine, dan PerpsEngine. Penarikan dana pengguna tetap bisa. |
