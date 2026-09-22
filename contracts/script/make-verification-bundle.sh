#!/usr/bin/env bash
# Builds everything the block explorer needs to verify the deployed contracts, as files.
#
#   contracts/ $ bash script/make-verification-bundle.sh [broadcast-run.json] [out-dir]
#
# `forge verify-contract` is the normal route, but it needs to reach the explorer, and several Indonesian
# ISPs block *.robinhood.com. This writes the same inputs to disk instead, so verification becomes a
# paste job in the explorer UI from any connection that can reach it (a Tor window, a phone's hotspot, a
# colleague abroad). It is also the record of what was deployed, which an auditor will ask for.
#
# Per contract it writes:
#   <Name>.standard-input.json  the Solidity standard JSON input (all sources + the exact settings)
#   <Name>.args.txt             the ABI-encoded constructor arguments, without the leading 0x
# and one VERIFY.md tying them to their addresses.
set -euo pipefail

RUN=${1:-broadcast/Deploy.s.sol/46630/run-latest.json}
OUT=${2:-verification}
FORGE=${FORGE:-forge}

[ -f "$RUN" ] || { echo "no broadcast file at $RUN" >&2; exit 1; }
mkdir -p "$OUT"

# Compiler settings must match the deployment byte for byte, so they are read from foundry.toml.
SOLC=$(grep -oP 'solc_version\s*=\s*"\K[^"]+' foundry.toml)
RUNS=$(grep -oP 'optimizer_runs\s*=\s*\K\d+' foundry.toml)
VIA_IR=$(grep -oP 'via_ir\s*=\s*\K\w+' foundry.toml)
EVM=$(grep -oP 'evm_version\s*=\s*"\K[^"]+' foundry.toml)

{
  echo "# Verifying the HanMarket contracts"
  echo
  echo "Compiler \`v$SOLC\`, optimizer **on** with **$RUNS** runs, via-IR **$VIA_IR**, EVM version **$EVM**."
  echo "All four must match exactly or the bytecode will not."
  echo
  echo "In the explorer, open the address, choose **Verify & Publish**, then"
  echo "**Solidity (Standard JSON Input)**, upload the \`.standard-input.json\` below and paste the"
  echo "matching \`.args.txt\` into the constructor-arguments field. Contracts with an empty args file"
  echo "take no constructor arguments."
  echo
  echo "| Contract | Address | Standard input | Constructor args |"
  echo "|---|---|---|---|"
} > "$OUT/VERIFY.md"

# contract name -> source path, so forge knows which unit to flatten
declare -A SRC=(
  [MockUSDC]=test/mocks/MockUSDC.sol
  [TestnetPriceFeed]=src/testnet/TestnetPriceFeed.sol
  [MarketRegistry]=src/core/MarketRegistry.sol
  [OracleRouter]=src/oracle/OracleRouter.sol
  [FeeManager]=src/core/FeeManager.sol
  [RiskManager]=src/risk/RiskManager.sol
  [Vault]=src/core/Vault.sol
  [OptionsEngine]=src/options/OptionsEngine.sol
  [PerpsEngine]=src/perps/PerpsEngine.sol
)

# every CREATE in the broadcast, as "Name<TAB>address<TAB>0x<init code>"
python3 - "$RUN" <<'PY' > "$OUT/.creates.tsv"
import json, sys
for t in json.load(open(sys.argv[1]))["transactions"]:
    if t["transactionType"] == "CREATE":
        print(f'{t["contractName"]}\t{t["contractAddress"]}\t{t["transaction"]["input"]}')
PY

while IFS=$'\t' read -r NAME ADDR INIT; do
  src=${SRC[$NAME]:-}
  [ -n "$src" ] || { echo "skip $NAME: no source path mapped" >&2; continue; }

  "$FORGE" verify-contract --show-standard-json-input "$ADDR" "$src:$NAME" > "$OUT/$NAME.standard-input.json"

  # The constructor arguments are whatever the init code carries past the contract's creation bytecode.
  # Comparing against the compiled artifact's bytecode is exact, and needs no ABI encoding by hand.
  python3 - "$NAME" "$INIT" "$OUT" <<'PY'
import json, sys, pathlib
name, init, out = sys.argv[1], sys.argv[2][2:], sys.argv[3]
art = json.load(open(f"out/{name}.sol/{name}.json"))
created = art["bytecode"]["object"][2:]
# link references and immutables can differ, so match on length rather than prefix
args = init[len(created):] if init.startswith(created) else ""
if not args and len(init) > len(created):
    args = init[len(created):]
pathlib.Path(f"{out}/{name}.args.txt").write_text(args)
PY

  bytes=$(wc -c < "$OUT/$NAME.args.txt")
  echo "| \`$NAME\` | \`$ADDR\` | \`$NAME.standard-input.json\` | $([ "$bytes" -gt 1 ] && echo "\`$NAME.args.txt\`" || echo "none") |" >> "$OUT/VERIFY.md"
  echo "wrote $NAME"
done < "$OUT/.creates.tsv"

rm -f "$OUT/.creates.tsv"
echo
echo "Bundle in $OUT/ — start with $OUT/VERIFY.md"
