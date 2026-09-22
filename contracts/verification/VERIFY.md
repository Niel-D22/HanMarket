# Verifying the HanMarket contracts

Compiler `v0.8.24`, optimizer **on** with **200** runs, via-IR **true**, EVM version **cancun**.
All four must match exactly or the bytecode will not.

In the explorer, open the address, choose **Verify & Publish**, then
**Solidity (Standard JSON Input)**, upload the `.standard-input.json` below and paste the
matching `.args.txt` into the constructor-arguments field. Contracts with an empty args file
take no constructor arguments.

| Contract | Address | Standard input | Constructor args |
|---|---|---|---|
| `MockUSDC` | `0x2848ab87bda098bb58cf70d1747839d95108e1f4` | `MockUSDC.standard-input.json` | none |
| `TestnetPriceFeed` | `0xd3c68f5afc3e8046179e75e247fc18d92e75a5de` | `TestnetPriceFeed.standard-input.json` | `TestnetPriceFeed.args.txt` |
| `MarketRegistry` | `0x2e523c27c4686929d8f25176c2b7d934eff959f9` | `MarketRegistry.standard-input.json` | `MarketRegistry.args.txt` |
| `OracleRouter` | `0xbe2cb42686e78a2e6c21f77c5f10e71c5394c097` | `OracleRouter.standard-input.json` | `OracleRouter.args.txt` |
| `FeeManager` | `0x698e84a0454182c7fd48325ad11d67b2c35f64c8` | `FeeManager.standard-input.json` | `FeeManager.args.txt` |
| `RiskManager` | `0x1b4bf0748f3323839a61e71facc4547166b32cf6` | `RiskManager.standard-input.json` | `RiskManager.args.txt` |
| `Vault` | `0xd2eaef238dc7fd327df37ec336d706d7da18eedc` | `Vault.standard-input.json` | `Vault.args.txt` |
| `OptionsEngine` | `0xc99f41a39a014e4b799e3183bf5f8ed2ece8c036` | `OptionsEngine.standard-input.json` | `OptionsEngine.args.txt` |
| `PerpsEngine` | `0xe256ac034dbf78460ba951b155031200d6478654` | `PerpsEngine.standard-input.json` | `PerpsEngine.args.txt` |
