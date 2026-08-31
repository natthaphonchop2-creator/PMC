#!/bin/bash

set -Eeuo pipefail
set -o noclobber
HISTFILE=/dev/null
export HISTFILE
set +o history
set +x
umask 077
trap 'status=$?; printf "%s\n" "DEPLOY_ABORTED" >&2; exit "$status"' ERR

readonly PHASE="${1:-}"
readonly ENV_FILE="${PMC_BOOKING_DEPLOY_ENV_FILE:-}"

case "$PHASE" in
  preflight|approve|deploy) ;;
  *) printf '%s\n' 'usage: deploy-workbook-presentation.sh preflight|approve|deploy' >&2; exit 64 ;;
esac

require_private_file_before_source() {
  local file="$1"
  test -n "$file"
  test "${file#/}" != "$file"
  test -f "$file"
  test ! -L "$file"
  test -O "$file"
  test "$(file_mode "$file")" = '600'
}

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

require_private_file_before_source "$ENV_FILE"
# shellcheck disable=SC1090
source "$ENV_FILE"

# The environment file is owner-controlled, but it cannot weaken runner safety.
set +x
set -Eeuo pipefail
set -o noclobber
set +o history
HISTFILE=/dev/null
export HISTFILE
umask 077
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH clasp_config_project clasp_config_auth clasp_config_ignore
CDPATH=
export CDPATH
IFS=$' \t\n'

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
readonly REPO_ROOT="$(cd "$APP_ROOT/../.." && pwd -P)"
readonly VALIDATOR="$SCRIPT_DIR/validate-deploy-state.mjs"
readonly CLASP_BIN="$REPO_ROOT/node_modules/.bin/clasp"
readonly NODE_BIN="$(command -v node)"
readonly NPM_BIN="$(command -v npm)"
readonly GIT_BIN="$(command -v git)"
readonly SHASUM_BIN="$(command -v shasum)"
readonly PMC_OPERATOR_DEPLOY_DESCRIPTION='PMC Booking reviewed rollout'
readonly PMC_OPERATOR_EXPECTED_ROOT_DIR="$APP_ROOT/dist"
export PMC_OPERATOR_DEPLOY_DESCRIPTION PMC_OPERATOR_EXPECTED_ROOT_DIR

required_variable() {
  local name="$1"
  eval "test -n \"\${$name:-}\""
}

for name in \
  PMC_OPERATOR_REVIEWED_COMMIT \
  PMC_OPERATOR_REVIEWED_CODE_SHA256 \
  PMC_OPERATOR_CLASP_VERSION \
  PMC_OPERATOR_CLASP_PROFILE \
  PMC_OPERATOR_CLASP_PROJECT_FILE \
  PMC_OPERATOR_SCRIPT_ID \
  PMC_OPERATOR_DEPLOYMENT_ID \
  PMC_OPERATOR_EXPECTED_ACCOUNT_EMAIL \
  PMC_OPERATOR_PRIVATE_DIR
do
  required_variable "$name"
done
export \
  PMC_OPERATOR_REVIEWED_COMMIT \
  PMC_OPERATOR_REVIEWED_CODE_SHA256 \
  PMC_OPERATOR_CLASP_VERSION \
  PMC_OPERATOR_SCRIPT_ID \
  PMC_OPERATOR_DEPLOYMENT_ID \
  PMC_OPERATOR_EXPECTED_ACCOUNT_EMAIL

test -x "$VALIDATOR"
test -x "$CLASP_BIN"
test -x "$NODE_BIN"
test -x "$NPM_BIN"
test -x "$GIT_BIN"
test -x "$SHASUM_BIN"
[[ "$PMC_OPERATOR_REVIEWED_COMMIT" =~ ^[a-f0-9]{40}$ ]]
[[ "$PMC_OPERATOR_REVIEWED_CODE_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$PMC_OPERATOR_CLASP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$PMC_OPERATOR_CLASP_PROFILE" =~ ^[A-Za-z0-9._-]{1,64}$ ]]
[[ "$PMC_OPERATOR_SCRIPT_ID" =~ ^[A-Za-z0-9_-]{8,256}$ ]]
[[ "$PMC_OPERATOR_DEPLOYMENT_ID" =~ ^[A-Za-z0-9_-]{8,256}$ ]]
[[ "$PMC_OPERATOR_EXPECTED_ACCOUNT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]

for path in "$PMC_OPERATOR_CLASP_PROJECT_FILE" "$PMC_OPERATOR_PRIVATE_DIR"; do
  test "${path#/}" != "$path"
done
test -d "$PMC_OPERATOR_PRIVATE_DIR"
test ! -L "$PMC_OPERATOR_PRIVATE_DIR"
test -O "$PMC_OPERATOR_PRIVATE_DIR"
test "$(file_mode "$PMC_OPERATOR_PRIVATE_DIR")" = '700'
require_private_file_before_source "$PMC_OPERATOR_CLASP_PROJECT_FILE"

readonly PREFLIGHT_SEAL="$PMC_OPERATOR_PRIVATE_DIR/preflight.seal"
readonly APPROVAL_SEAL="$PMC_OPERATOR_PRIVATE_DIR/approval.seal"

run_clasp_json() {
  local output="$1"
  shift
  test ! -e "$output"
  "$CLASP_BIN" --json --user "$PMC_OPERATOR_CLASP_PROFILE" \
    --project "$PMC_OPERATOR_CLASP_PROJECT_FILE" "$@" > "$output" 2>&1
  chmod 600 "$output"
}

run_validator() {
  local output="$1"
  shift
  test ! -e "$output"
  if ! "$NODE_BIN" "$VALIDATOR" "$@" > "$output" 2>&1; then
    chmod 600 "$output"
    printf '%s\n' 'DEPLOY_ABORTED' >&2
    exit 1
  fi
  chmod 600 "$output"
}

preflight() {
  local tag="$1"
  local seal="$2"
  local build_log="$PMC_OPERATOR_PRIVATE_DIR/build-$tag.log"
  local code_hash="$PMC_OPERATOR_PRIVATE_DIR/code-$tag.sha256"
  local clasp_version="$PMC_OPERATOR_PRIVATE_DIR/clasp-version-$tag.txt"
  local account="$PMC_OPERATOR_PRIVATE_DIR/account-$tag.json"
  local deployments="$PMC_OPERATOR_PRIVATE_DIR/deployments-$tag.json"
  local versions="$PMC_OPERATOR_PRIVATE_DIR/versions-$tag.json"

  test ! -e "$seal"
  test "$($GIT_BIN -C "$REPO_ROOT" rev-parse HEAD)" = "$PMC_OPERATOR_REVIEWED_COMMIT"
  test -z "$($GIT_BIN -C "$REPO_ROOT" status --porcelain --untracked-files=all)"

  test ! -e "$build_log"
  "$NPM_BIN" --prefix "$REPO_ROOT" run booking:build > "$build_log" 2>&1
  chmod 600 "$build_log"
  test -z "$($GIT_BIN -C "$REPO_ROOT" status --porcelain --untracked-files=all)"
  test -f "$APP_ROOT/dist/Code.js"
  test ! -L "$APP_ROOT/dist/Code.js"
  test ! -e "$code_hash"
  "$SHASUM_BIN" -a 256 "$APP_ROOT/dist/Code.js" | awk '{print $1}' > "$code_hash"
  chmod 600 "$code_hash"
  test "$(tr -d '\n' < "$code_hash")" = "$PMC_OPERATOR_REVIEWED_CODE_SHA256"

  test ! -e "$clasp_version"
  "$CLASP_BIN" --version > "$clasp_version" 2>&1
  chmod 600 "$clasp_version"
  test "$(tr -d '\r\n' < "$clasp_version")" = "$PMC_OPERATOR_CLASP_VERSION"

  run_clasp_json "$account" show-authorized-user
  run_clasp_json "$deployments" deployments "$PMC_OPERATOR_SCRIPT_ID"
  run_clasp_json "$versions" versions "$PMC_OPERATOR_SCRIPT_ID"
  run_validator "$PMC_OPERATOR_PRIVATE_DIR/validator-$tag.log" preflight \
    "$PMC_OPERATOR_CLASP_PROJECT_FILE" "$account" "$deployments" "$versions" \
    "$code_hash" "$seal"
  require_private_file_before_source "$seal"
}

if [ "$PHASE" = 'preflight' ]; then
  test ! -e "$PREFLIGHT_SEAL"
  preflight 'preflight' "$PREFLIGHT_SEAL"
  printf '%s\n' 'PREFLIGHT_OK'
  exit 0
fi

if [ "$PHASE" = 'approve' ]; then
  require_private_file_before_source "$PREFLIGHT_SEAL"
  readonly APPROVAL_CANDIDATE="$PMC_OPERATOR_PRIVATE_DIR/approval-candidate.seal"
  test ! -e "$APPROVAL_CANDIDATE"
  test ! -e "$APPROVAL_SEAL"
  preflight 'approval' "$APPROVAL_CANDIDATE"
  cmp -s "$PREFLIGHT_SEAL" "$APPROVAL_CANDIDATE"
  cp "$APPROVAL_CANDIDATE" "$APPROVAL_SEAL"
  chmod 600 "$APPROVAL_SEAL"
  printf '%s\n' 'APPROVAL_RECORDED'
  exit 0
fi

require_private_file_before_source "$PREFLIGHT_SEAL"
require_private_file_before_source "$APPROVAL_SEAL"
cmp -s "$PREFLIGHT_SEAL" "$APPROVAL_SEAL"
readonly DEPLOY_CANDIDATE="$PMC_OPERATOR_PRIVATE_DIR/deploy-candidate.seal"
preflight 'deploy' "$DEPLOY_CANDIDATE"
cmp -s "$APPROVAL_SEAL" "$DEPLOY_CANDIDATE"

# No external mutation appears before this line.
readonly PUSH_JSON="$PMC_OPERATOR_PRIVATE_DIR/push.json"
readonly CREATED_JSON="$PMC_OPERATOR_PRIVATE_DIR/created-version.json"
readonly VERSIONS_AFTER_JSON="$PMC_OPERATOR_PRIVATE_DIR/versions-after.json"
readonly VERSION_FILE="$PMC_OPERATOR_PRIVATE_DIR/created-version.txt"
readonly CLONE_JSON="$PMC_OPERATOR_PRIVATE_DIR/immutable-clone.json"
readonly REDEPLOY_JSON="$PMC_OPERATOR_PRIVATE_DIR/redeploy.json"
readonly FINAL_JSON="$PMC_OPERATOR_PRIVATE_DIR/deployments-final.json"
readonly CLONE_DIR="$(mktemp -d "$PMC_OPERATOR_PRIVATE_DIR/immutable-clone.XXXXXX")"
chmod 700 "$CLONE_DIR"

run_clasp_json "$PUSH_JSON" push --force
run_clasp_json "$CREATED_JSON" version "$PMC_OPERATOR_DEPLOY_DESCRIPTION"
run_clasp_json "$VERSIONS_AFTER_JSON" versions "$PMC_OPERATOR_SCRIPT_ID"
run_validator "$PMC_OPERATOR_PRIVATE_DIR/validator-created-version.log" created-version \
  "$PMC_OPERATOR_PRIVATE_DIR/versions-deploy.json" "$CREATED_JSON" \
  "$VERSIONS_AFTER_JSON" "$VERSION_FILE"
require_private_file_before_source "$VERSION_FILE"
readonly CREATED_VERSION="$(tr -d '\r\n' < "$VERSION_FILE")"
[[ "$CREATED_VERSION" =~ ^[1-9][0-9]*$ ]]

if ! (
  cd "$CLONE_DIR"
  "$CLASP_BIN" --json --user "$PMC_OPERATOR_CLASP_PROFILE" \
    clone "$PMC_OPERATOR_SCRIPT_ID" "$CREATED_VERSION" --rootDir "$CLONE_DIR/content"
) > "$CLONE_JSON" 2>&1; then
  printf '%s\n' 'DEPLOY_ABORTED' >&2
  exit 1
fi
chmod 600 "$CLONE_JSON"
run_validator "$PMC_OPERATOR_PRIVATE_DIR/validator-clone.log" clone \
  "$CLONE_DIR/content/Code.js" "$VERSION_FILE"

run_clasp_json "$REDEPLOY_JSON" redeploy "$PMC_OPERATOR_DEPLOYMENT_ID" \
  --versionNumber "$CREATED_VERSION" --description "$PMC_OPERATOR_DEPLOY_DESCRIPTION"
run_validator "$PMC_OPERATOR_PRIVATE_DIR/validator-redeploy.log" redeploy \
  "$REDEPLOY_JSON" "$VERSION_FILE"
run_clasp_json "$FINAL_JSON" deployments "$PMC_OPERATOR_SCRIPT_ID"
run_validator "$PMC_OPERATOR_PRIVATE_DIR/validator-final.log" final "$FINAL_JSON" "$VERSION_FILE"

printf '%s\n' 'DEPLOY_VERIFIED'
