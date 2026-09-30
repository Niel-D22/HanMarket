#!/usr/bin/env bash
# HanMarket mainnet launch, one step at a time. Run from WSL (Foundry lives there):
#
#   bash contracts/script/mainnet/deploy-mainnet.sh <command>
#
#   setup        install the pinned Foundry libraries and build
#   check        every input checked against the chain: RPC, balances, USDG, Chainlink, the Safe, the roles; unit tests
#   simulate     the deploy on a fork of mainnet, nothing sent: gas and ETH it will cost
#   rehearse     the whole launch on a local fork: a real 2-of-3 Safe, the deploy, the Safe accepting ownership,
#                a read-back of every setting, and a user's trades with real USDG and the real Chainlink BABA price
#   deploy       the real thing (asks you to type a confirmation first); saves deployments/mainnet-4663.json
#   verify [pending|accepted]   read the live deployment back and check every setting
#   accept-prepare              write the Safe transaction that accepts ownership of all 7 contracts
#   accept-sign <cast signer flags, e.g. --ledger or --account alice>   one Safe owner signs it, on their machine
#   accept-exec <cast signer flags>                                     anyone submits it once enough owners signed
#
# Inputs: contracts/script/mainnet/mainnet.env (see mainnet.env.example). No private key is ever read from a file.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C="$(cd "$HERE/../.." && pwd)"            # contracts/
OUT="$C/deployments"
DEPLOYMENT="$OUT/mainnet-4663.json"
ACCEPT="$OUT/mainnet-accept-ownership.json"
export PATH="$HOME/.foundry/bin:$PATH"
# Safe v1.4.1 MultiSendCallOnly (canonical deterministic address), used to batch the seven acceptOwnership calls
MULTISEND=0x9641d764fc13c8B624c04430C7356C1C7C8102e2
ZERO=0x0000000000000000000000000000000000000000

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { red "STOP: $*"; exit 1; }
ok() { green "  [ok] $*"; }

# load_env [rehearsal]: the rehearsal brings its own roles, so it only needs the network, the external contracts and the
# risk settings, and falls back to mainnet.env.example when mainnet.env has not been filled in yet
load_env() {
  local file="$HERE/mainnet.env"
  if [ ! -f "$file" ]; then
    [ "${1:-}" = rehearsal ] || die "copy mainnet.env.example to mainnet.env and fill it in"
    file="$HERE/mainnet.env.example"; echo "  (no mainnet.env yet: rehearsing with the example's risk settings)"
  fi
  set -a; # shellcheck disable=SC1090
  source "$file"; set +a
  local need=(MAINNET_RPC EXPECTED_CHAIN_ID USDC_ADDRESS BABA_FEED PERP_MAX_LEVERAGE PERP_INITIAL_MARGIN_BPS PERP_MAINTENANCE_MARGIN_BPS
              PERP_MAX_POSITION PERP_OI_CAP OPTIONS_RESERVE_CAP MAX_UTILIZATION_BPS)
  [ "${1:-}" = rehearsal ] || need+=(DEPLOYER_ACCOUNT DEPLOYER_ADDRESS OWNER TREASURY KEEPER PRICE_SIGNER QUOTE_SIGNER)
  for v in "${need[@]}"; do [ -n "${!v:-}" ] || die "$v is empty in $(basename "$file")"; done
}

lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
code_size() { local c; c=$(cast code "$1" --rpc-url "$2"); echo $(( (${#c} - 2) / 2 )); }

cmd_setup() {
  if [ ! -d "$C/lib/openzeppelin-contracts" ] || [ ! -d "$C/lib/forge-std" ]; then
    mkdir -p "$C/lib"
    if [ -n "${HM_LIB:-}" ] && [ -d "$HM_LIB/openzeppelin-contracts" ]; then
      cp -r "$HM_LIB/." "$C/lib/"
    else
      # the exact versions the contracts were written and tested against
      (cd "$C" && forge install --no-git foundry-rs/forge-std@v1.11.0 OpenZeppelin/openzeppelin-contracts@v5.4.0)
    fi
  fi
  grep -q '"version": "5.4.0"' "$C/lib/openzeppelin-contracts/package.json" || die "lib/openzeppelin-contracts is not v5.4.0"
  (cd "$C" && forge build) >/dev/null
  ok "libraries pinned (OpenZeppelin 5.4.0, forge-std 1.11.0) and contracts built"
}

cmd_check() {
  load_env
  bold "== network"
  local chain; chain=$(cast chain-id --rpc-url "$MAINNET_RPC")
  [ "$chain" = "$EXPECTED_CHAIN_ID" ] || die "RPC answers chain $chain, expected $EXPECTED_CHAIN_ID"
  ok "RPC is Robinhood Chain mainnet ($chain)"

  bold "== deployer"
  [ -f "$HOME/.foundry/keystores/$DEPLOYER_ACCOUNT" ] || die "no Foundry keystore '$DEPLOYER_ACCOUNT' (cast wallet import $DEPLOYER_ACCOUNT --interactive)"
  local bal; bal=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$MAINNET_RPC" --ether)
  python3 -c "import sys; sys.exit(0 if float('$bal') >= float('$MIN_DEPLOYER_ETH') else 1)" \
    || die "deployer holds $bal ETH, needs at least $MIN_DEPLOYER_ETH"
  ok "deployer $DEPLOYER_ADDRESS holds $bal ETH (keystore '$DEPLOYER_ACCOUNT' present)"
  [ "$(cast nonce "$DEPLOYER_ADDRESS" --rpc-url "$MAINNET_RPC")" = "0" ] || echo "  note: deployer nonce is not 0 (a used wallet); fine, but a fresh one is cleaner"

  bold "== roles"
  local d o t k p q; d=$(lower "$DEPLOYER_ADDRESS"); o=$(lower "$OWNER"); t=$(lower "$TREASURY"); k=$(lower "$KEEPER"); p=$(lower "$PRICE_SIGNER"); q=$(lower "$QUOTE_SIGNER")
  [ "$o" != "$d" ] || die "OWNER is the deployer"
  [ "$k" != "$o" ] && [ "$k" != "$d" ] || die "KEEPER must be its own key"
  [ "$p" != "$o" ] && [ "$q" != "$o" ] || die "signers must not be the owner"
  [ "$(code_size "$OWNER" "$MAINNET_RPC")" -gt 0 ] || die "OWNER has no contract code: deploy the Safe first (api: npm run deploy:safe)"
  local threshold owners; threshold=$(cast call "$OWNER" "getThreshold()(uint256)" --rpc-url "$MAINNET_RPC") || die "OWNER does not answer getThreshold(): not a Safe"
  owners=$(cast call "$OWNER" "getOwners()(address[])" --rpc-url "$MAINNET_RPC")
  [ "$threshold" -ge 2 ] || die "the Safe needs at least 2 signatures (threshold is $threshold)"
  ok "OWNER is a Safe, $threshold signatures of $owners"
  [ "$t" = "$o" ] || [ "$(code_size "$TREASURY" "$MAINNET_RPC")" -gt 0 ] || die "TREASURY is a plain wallet; use the Safe"
  ok "TREASURY $TREASURY"
  ok "KEEPER $KEEPER, PRICE_SIGNER $PRICE_SIGNER, QUOTE_SIGNER $QUOTE_SIGNER"
  local kb; kb=$(cast balance "$KEEPER" --rpc-url "$MAINNET_RPC" --ether)
  echo "  keeper holds $kb ETH (it pays for listing series and settling; top it up before trading opens)"

  bold "== settlement token and price feed"
  [ "$(code_size "$USDC_ADDRESS" "$MAINNET_RPC")" -gt 0 ] || die "USDC_ADDRESS has no contract"
  local sym dec; sym=$(cast call "$USDC_ADDRESS" "symbol()(string)" --rpc-url "$MAINNET_RPC"); dec=$(cast call "$USDC_ADDRESS" "decimals()(uint8)" --rpc-url "$MAINNET_RPC")
  [ "$dec" = "6" ] || die "settlement token has $dec decimals, expected 6"
  ok "settlement token $sym, $dec decimals ($USDC_ADDRESS)"
  local fdec desc round updated age
  fdec=$(cast call "$BABA_FEED" "decimals()(uint8)" --rpc-url "$MAINNET_RPC"); desc=$(cast call "$BABA_FEED" "description()(string)" --rpc-url "$MAINNET_RPC")
  [ "$fdec" = "8" ] || die "BABA_FEED has $fdec decimals, expected 8"
  grep -qi "BABA" <<<"$desc" || die "BABA_FEED describes itself as $desc"
  round=$(cast call "$BABA_FEED" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "$MAINNET_RPC")
  updated=$(sed -n 4p <<<"$round" | awk '{print $1}')
  age=$(( $(date +%s) - updated ))
  [ "$age" -lt 259200 ] || die "BABA_FEED last updated $((age / 3600))h ago (over 3 days: the deploy script refuses it)"
  ok "BABA feed '$desc', $fdec decimals, last update $((age / 3600))h ago, answer $(sed -n 2p <<<"$round" | awk '{print $1}')"

  bold "== risk settings to be deployed"
  echo "  leverage ${PERP_MAX_LEVERAGE}x, margins ${PERP_INITIAL_MARGIN_BPS}/${PERP_MAINTENANCE_MARGIN_BPS} bps"
  echo "  max position \$${PERP_MAX_POSITION}, open interest cap \$${PERP_OI_CAP} per side, options reserve cap \$${OPTIONS_RESERVE_CAP} per stock, utilization ${MAX_UTILIZATION_BPS} bps"

  bold "== code"
  cmd_setup
  (cd "$C" && forge test) >/tmp/hm-forge-test.log 2>&1 || { tail -30 /tmp/hm-forge-test.log; die "unit tests fail"; }
  ok "$(grep -Eo '[0-9]+ tests passed' /tmp/hm-forge-test.log | tail -1 || echo 'unit tests passed')"
  green "CHECK PASSED"
}

cmd_simulate() {
  load_env
  cmd_setup
  (cd "$C" && forge script script/Deploy.s.sol --fork-url "$MAINNET_RPC" --sender "$DEPLOYER_ADDRESS") \
    | grep -E "Chain |Estimated|assets|Error|revert" || die "simulation failed"
}

# ---------------------------------------------------------------- the Safe batch

# acceptOwnership() on every contract of a deployment, packed for MultiSendCallOnly
accept_batch_data() {
  local json="$1" packed="" addr
  for key in marketRegistry oracleRouter feeManager riskManager vault optionsEngine perpsEngine; do
    addr=$(python3 -c "import json; print(json.load(open('$json'))['$key'])")
    # operation 0 (call) | to | value 0 | data length 4 | acceptOwnership() selector
    packed+="00${addr:2}$(printf '%064x' 0)$(printf '%064x' 4)79ba5097"
  done
  cast calldata "multiSend(bytes)" "0x$packed"
}

accept_prepare() { # <rpc> <safe> <deployment json> <out json>
  local rpc="$1" safe="$2" json="$3" out="$4"
  [ "$(code_size "$MULTISEND" "$rpc")" -gt 0 ] || die "MultiSendCallOnly $MULTISEND is not deployed on this chain"
  local data nonce hash
  data=$(accept_batch_data "$json")
  nonce=$(cast call "$safe" "nonce()(uint256)" --rpc-url "$rpc")
  hash=$(cast call "$safe" "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)(bytes32)" \
    "$MULTISEND" 0 "$data" 1 0 0 0 "$ZERO" "$ZERO" "$nonce" --rpc-url "$rpc")
  python3 - "$out" "$safe" "$data" "$nonce" "$hash" <<'PY'
import json, sys
out, safe, data, nonce, h = sys.argv[1:]
json.dump({"what": "HanMarket: accept ownership of all 7 contracts", "safe": safe, "to": "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
           "operation": 1, "data": data, "nonce": int(nonce), "safeTxHash": h, "signatures": {}}, open(out, "w"), indent=2)
PY
  echo "$hash"
}

accept_sign() { # <out json> <cast signer flags...>
  local file="$1"; shift
  local hash signer sig
  hash=$(python3 -c "import json; print(json.load(open('$file'))['safeTxHash'])")
  signer=$(cast wallet address "$@")
  sig=$(cast wallet sign --no-hash "$hash" "$@")
  python3 - "$file" "$signer" "$sig" <<'PY'
import json, sys
f, signer, sig = sys.argv[1:]
d = json.load(open(f)); d["signatures"][signer.lower()] = sig; json.dump(d, open(f, "w"), indent=2)
print(f"signed by {signer}; {len(d['signatures'])} signature(s) collected")
PY
}

accept_exec() { # <rpc> <out json> <cast signer flags...>
  local rpc="$1" file="$2"; shift 2
  local safe data sigs threshold have
  safe=$(python3 -c "import json; print(json.load(open('$file'))['safe'])")
  data=$(python3 -c "import json; print(json.load(open('$file'))['data'])")
  threshold=$(cast call "$safe" "getThreshold()(uint256)" --rpc-url "$rpc")
  have=$(python3 -c "import json; print(len(json.load(open('$file'))['signatures']))")
  [ "$have" -ge "$threshold" ] || die "$have signature(s), the Safe needs $threshold"
  # the Safe wants signatures ordered by signer address, ascending
  sigs=$(python3 -c "import json; s=json.load(open('$file'))['signatures']; print('0x'+''.join(s[k][2:] for k in sorted(s, key=lambda a:int(a,16))))")
  cast send "$safe" "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)" \
    "$MULTISEND" 0 "$data" 1 0 0 0 "$ZERO" "$ZERO" "$sigs" --rpc-url "$rpc" "$@" >/dev/null
  ok "Safe executed: ownership of all 7 contracts accepted"
}

# ---------------------------------------------------------------- rehearsal on a local fork

cmd_rehearse() {
  load_env rehearsal
  cmd_setup
  # inside contracts/ because forge only lets scripts read files under the paths foundry.toml allows
  local R=http://127.0.0.1:8546 W="$C/deployments/.rehearsal"
  rm -rf "$W"; mkdir -p "$W"
  anvil --fork-url "$MAINNET_RPC" --port 8546 --silent &
  local ANVIL=$!
  trap "kill $ANVIL 2>/dev/null || true" EXIT
  for _ in $(seq 1 60); do cast chain-id --rpc-url "$R" >/dev/null 2>&1 && break; sleep 1; done
  [ "$(cast chain-id --rpc-url $R)" = "$EXPECTED_CHAIN_ID" ] || die "the fork is not chain $EXPECTED_CHAIN_ID"
  local FORK_BLOCK; FORK_BLOCK=$(cast block-number --rpc-url $R)
  ok "local fork of mainnet at block $FORK_BLOCK"

  # Fresh random keys for every role, funded with ETH on the fork: deployer, keeper, price signer, quote signer, LP, trader,
  # three Safe owners. Not anvil's well-known test accounts: their keys are public, and on Robinhood Chain mainnet those
  # addresses already carry EIP-7702 delegations to sweeper contracts, so they cannot even receive an ERC-1155 option.
  local K=() A=() w
  for _ in $(seq 0 8); do
    w=$(cast wallet new --json | python3 -c "import json,sys; d=json.load(sys.stdin); d=d['data'] if isinstance(d,dict) else d; print(d[0]['private_key'], d[0]['address'])")
    K+=("${w% *}"); A+=("${w#* }")
    cast rpc anvil_setBalance "${w#* }" 0x8AC7230489E80000 --rpc-url $R >/dev/null # 10 ETH
  done

  bold "== 1. a real 2-of-3 Safe (canonical v1.4.1 factory, as on mainnet)"
  local setup safe
  setup=$(cast calldata "setup(address[],uint256,address,bytes,address,address,uint256,address)" "[${A[6]},${A[7]},${A[8]}]" 2 "$ZERO" 0x \
    0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99 "$ZERO" 0 "$ZERO")
  safe=$(cast call 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67 "createProxyWithNonce(address,bytes,uint256)(address)" \
    0x29fcB43b46531BcA003ddC8FCB67FFE91900C762 "$setup" 1 --from "${A[0]}" --rpc-url $R)
  cast send 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67 "createProxyWithNonce(address,bytes,uint256)" \
    0x29fcB43b46531BcA003ddC8FCB67FFE91900C762 "$setup" 1 --private-key "${K[0]}" --rpc-url $R >/dev/null
  ok "Safe $safe, threshold $(cast call "$safe" 'getThreshold()(uint256)' --rpc-url $R)"

  # the rehearsal's roles; the risk settings stay exactly as in mainnet.env
  export OWNER=$safe TREASURY=$safe KEEPER=${A[1]} PRICE_SIGNER=${A[2]} QUOTE_SIGNER=${A[3]}
  export DEPLOYMENT_FILE=$W/deployment.json EXPECTED_CHAIN_ID ANVIL_FORK=true

  bold "== 2. the deploy script, exactly as it will run on mainnet"
  (cd "$C" && forge script script/Deploy.s.sol --rpc-url $R --private-key "${K[0]}" --broadcast) >"$W/deploy.log" 2>&1 \
    || { tail -40 "$W/deploy.log"; die "deploy failed on the fork"; }
  grep -o '{"collateralToken".*}' "$W/deploy.log" | tail -1 >"$DEPLOYMENT_FILE"
  [ -s "$DEPLOYMENT_FILE" ] || die "no deployment JSON in the deploy output"
  ok "deployed: $(cat "$DEPLOYMENT_FILE")"

  bold "== 3. read-back before the Safe accepts"
  (cd "$C" && OWNER_STAGE=pending forge script script/VerifyDeployment.s.sol --rpc-url $R) | grep -E "\[ok\]|\[FAIL\]|PASSED|FAILED" || die "verification failed"

  bold "== 4. the Safe accepts ownership: two owners sign, a third party submits"
  accept_prepare $R "$safe" "$DEPLOYMENT_FILE" "$W/accept.json" >/dev/null
  accept_sign "$W/accept.json" --private-key "${K[6]}"
  accept_sign "$W/accept.json" --private-key "${K[8]}"
  accept_exec $R "$W/accept.json" --private-key "${K[0]}"
  (cd "$C" && OWNER_STAGE=accepted forge script script/VerifyDeployment.s.sol --rpc-url $R) | grep -E "\[FAIL\]|PASSED|FAILED" || die "verification after accept failed"

  bold "== 5. real USDG for the LP and the trader (the real token contract, balances set on the local fork)"
  fund() { # <to> <amount, 6 decimals>
    # anvil writes the balance straight into the token's storage when it can find the slot (it cannot for USDG); otherwise a holder
    # from the last 50 blocks of transfers pays it (free RPCs refuse wider log ranges)
    cast rpc anvil_dealERC20 "$USDC_ADDRESS" "$1" "$(cast to-hex "$2")" --rpc-url $R >/dev/null 2>&1 && return 0
    # the 50 mainnet blocks before the fork: every block after it is one of the rehearsal's own transactions
    local holder
    for holder in $(cast logs --from-block $((FORK_BLOCK - 50)) --to-block "$FORK_BLOCK" --address "$USDC_ADDRESS" "Transfer(address,address,uint256)" --rpc-url $R --json \
               | python3 -c "import json,sys; d=json.load(sys.stdin); d=(d.get('data') or []) if isinstance(d,dict) else d; print('\n'.join(dict.fromkeys('0x'+t[26:] for l in d for t in l['topics'][1:3])))" | head -150); do
      local bal; bal=$(cast call "$USDC_ADDRESS" 'balanceOf(address)(uint256)' "$holder" --rpc-url $R | awk '{print $1}')
      if python3 -c "import sys; sys.exit(0 if int('$bal') > $2 else 1)"; then
        cast rpc anvil_impersonateAccount "$holder" --rpc-url $R >/dev/null
        cast rpc anvil_setBalance "$holder" 0xDE0B6B3A7640000 --rpc-url $R >/dev/null
        cast send "$USDC_ADDRESS" "transfer(address,uint256)" "$1" "$2" --from "$holder" --unlocked --rpc-url $R >/dev/null
        return 0
      fi
    done
    return 1
  }
  fund "${A[4]}" 1100000000 || die "could not give the LP USDG on the fork"
  fund "${A[5]}" 200000000 || die "could not give the trader USDG on the fork"
  [ "$(cast call "$USDC_ADDRESS" 'balanceOf(address)(uint256)' "${A[4]}" --rpc-url $R | awk '{print $1}')" -ge 1100000000 ] || die "LP funding did not land"
  ok "LP holds 1,100 USDG, trader holds 200 USDG"

  export LP_KEY=${K[4]} TRADER_KEY=${K[5]} KEEPER_KEY=${K[1]} QUOTE_SIGNER_KEY=${K[3]} PRICE_SIGNER_KEY=${K[2]}
  run_phase() {
    (cd "$C" && REHEARSAL_PHASE=$1 forge script script/Rehearsal.s.sol --rpc-url $R --broadcast) >"$W/$1.log" 2>&1 \
      || { tail -40 "$W/$1.log"; die "rehearsal phase '$1' failed"; }
    grep -E "^\s+(LP|keeper|trader|series|vault)" "$W/$1.log" | sed 's/^ */  /' | awk '!seen[$0]++'
  }
  bold "== 6. a user's day: liquidity, a BABA perp at the live Chainlink price, options bought and sold"
  run_phase trade
  cast rpc evm_increaseTime 7200 --rpc-url $R >/dev/null; cast rpc evm_mine --rpc-url $R >/dev/null
  bold "== 7. two hours later: settlement, redemption, withdrawal"
  run_phase settle
  cast rpc evm_increaseTime 90000 --rpc-url $R >/dev/null; cast rpc evm_mine --rpc-url $R >/dev/null
  bold "== 8. a day later: the LP takes liquidity back out"
  run_phase exit
  green "REHEARSAL PASSED: deploy, Safe handover, read-back and every user flow work on a fork of mainnet"
}

# ---------------------------------------------------------------- the real deploy

cmd_deploy() {
  cmd_check
  [ ! -e "$DEPLOYMENT" ] || die "$DEPLOYMENT already exists: HanMarket is already deployed on mainnet"
  bold "== simulation"
  cmd_simulate
  echo
  bold "About to deploy HanMarket to Robinhood Chain MAINNET from $DEPLOYER_ADDRESS."
  echo "Owner and treasury: $OWNER (Safe). This sends real transactions and spends real ETH."
  read -r -p "Type DEPLOY HANMARKET MAINNET to continue: " answer
  [ "$answer" = "DEPLOY HANMARKET MAINNET" ] || die "not confirmed"
  mkdir -p "$OUT"
  (cd "$C" && forge script script/Deploy.s.sol --rpc-url "$MAINNET_RPC" --account "$DEPLOYER_ACCOUNT" --sender "$DEPLOYER_ADDRESS" \
      --broadcast --slow) | tee "$OUT/mainnet-deploy.log"
  grep -o '{"collateralToken".*}' "$OUT/mainnet-deploy.log" | tail -1 >"$DEPLOYMENT"
  [ -s "$DEPLOYMENT" ] || die "no deployment JSON found in the output; check $OUT/mainnet-deploy.log and contracts/broadcast/"
  green "DEPLOYED: $DEPLOYMENT"
  cmd_verify pending
  cmd_accept_prepare
  bold "Next: two Safe owners run 'accept-sign', then anyone runs 'accept-exec', then 'verify accepted'."
}

cmd_verify() {
  load_env
  [ -s "$DEPLOYMENT" ] || die "no $DEPLOYMENT yet"
  (cd "$C" && DEPLOYMENT_FILE="$DEPLOYMENT" OWNER_STAGE="${1:-accepted}" forge script script/VerifyDeployment.s.sol --rpc-url "$MAINNET_RPC") \
    | grep -E "chain|\[ok\]|\[FAIL\]|BABA index|PASSED|FAILED" || die "verification failed"
}

cmd_accept_prepare() {
  load_env
  [ -s "$DEPLOYMENT" ] || die "no $DEPLOYMENT yet"
  local hash; hash=$(accept_prepare "$MAINNET_RPC" "$OWNER" "$DEPLOYMENT" "$ACCEPT")
  ok "wrote $ACCEPT; Safe transaction hash $hash"
  echo "  Each signer checks the hash matches on their own machine before signing."
}

case "${1:-}" in
  setup) cmd_setup ;;
  check) cmd_check ;;
  simulate) cmd_simulate ;;
  rehearse) cmd_rehearse ;;
  deploy) cmd_deploy ;;
  verify) cmd_verify "${2:-accepted}" ;;
  accept-prepare) cmd_accept_prepare ;;
  accept-sign) shift; accept_sign "$ACCEPT" "$@" ;;
  accept-exec) shift; load_env; accept_exec "$MAINNET_RPC" "$ACCEPT" "$@" ;;
  *) sed -n 2,20p "$0"; exit 1 ;;
esac
