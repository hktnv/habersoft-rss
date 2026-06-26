#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' "usage: verify-off-host-postgres-restore.sh --repository-dir <repo> --input-dir <flat-returned-backup-dir> --receipt <external-restore-receipt> [--preflight-only]" >&2
}

required_tooling_commit="__MS019C_REQUIRED_TOOLING_COMMIT__"
canonical_remote="__MS019C_CANONICAL_REMOTE__"
contract_version="__MS019C_CONTRACT_VERSION__"
required_tool_hashes=$(cat <<'MS019C_TOOL_HASHES'
__MS019C_REQUIRED_TOOL_LINES__
MS019C_TOOL_HASHES
)

fail_class() {
  printf 'MS019C_PREFLIGHT_FAILED:%s\n' "$1" >&2
  exit 1
}

main() {
repository_dir=
input_dir=
receipt=
preflight_only=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-dir) repository_dir=${2:-}; shift 2 ;;
    --input-dir) input_dir=${2:-}; shift 2 ;;
    --receipt) receipt=${2:-}; shift 2 ;;
    --preflight-only) preflight_only=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail_class "UNSUPPORTED_FLAG" ;;
  esac
done

if [ -z "$repository_dir" ] || [ -z "$input_dir" ] || [ -z "$receipt" ]; then
  usage
  exit 1
fi

preflight

if [ "$preflight_only" = "true" ]; then
  printf '%s\n' "restore handoff preflight passed"
  exit 0
fi

umask 077
cd "$repo_real"

node scripts/production-restore-verify.mjs \
  --input-dir "$input_dir" \
  --receipt "$receipt"
}

preflight() {
  resolve_repository
  verify_canonical_remote
  verify_required_commit
  verify_required_tool_files
  verify_restore_contract
  verify_input_directory
  verify_receipt_output
}

resolve_repository() {
  repo_top="$(git -C "$repository_dir" rev-parse --show-toplevel 2>/dev/null)" || fail_class "REPOSITORY_GIT_WORKTREE_INVALID"
  repo_real="$(cd "$repo_top" 2>/dev/null && pwd -P)" || fail_class "REPOSITORY_GIT_WORKTREE_INVALID"
}

normalize_remote() {
  remote_value=${1%/}
  remote_value=${remote_value%.git}
  printf '%s\n' "$remote_value"
}

verify_canonical_remote() {
  origin_url="$(git -C "$repo_real" remote get-url origin 2>/dev/null)" || fail_class "CANONICAL_REPOSITORY_MISMATCH"
  if [ "$(normalize_remote "$origin_url")" != "$(normalize_remote "$canonical_remote")" ]; then
    fail_class "CANONICAL_REPOSITORY_MISMATCH"
  fi
}

verify_required_commit() {
  git -C "$repo_real" merge-base --is-ancestor "$required_tooling_commit" HEAD >/dev/null 2>&1 || fail_class "REPOSITORY_TOOLING_COMMIT_MISSING"
}

verify_required_tool_files() {
  while read -r relative_path expected_sha; do
    [ -n "$relative_path" ] || continue
    [ -n "$expected_sha" ] || fail_class "REPOSITORY_TOOL_HASH_MISMATCH"
    git -C "$repo_real" ls-files --error-unmatch -- "$relative_path" >/dev/null 2>&1 || fail_class "REPOSITORY_TOOL_HASH_MISMATCH"
    [ -f "$repo_real/$relative_path" ] || fail_class "REPOSITORY_TOOL_HASH_MISMATCH"
    actual_sha="$(file_sha256 "$repo_real/$relative_path")"
    [ "$actual_sha" = "$expected_sha" ] || fail_class "REPOSITORY_TOOL_HASH_MISMATCH"
    git -C "$repo_real" diff --quiet -- "$relative_path" >/dev/null 2>&1 || fail_class "REPOSITORY_TOOL_LOCALLY_MODIFIED"
    git -C "$repo_real" diff --cached --quiet -- "$relative_path" >/dev/null 2>&1 || fail_class "REPOSITORY_TOOL_LOCALLY_MODIFIED"
  done <<< "$required_tool_hashes"
}

verify_restore_contract() {
  contract_json="$(cd "$repo_real" && node scripts/production-restore-verify.mjs contract:describe 2>/dev/null)" || fail_class "CLI_CONTRACT_COMMAND_FAILED"
  printf '%s\n' "$contract_json" | grep -F '"tool_name": "production-restore-verify"' >/dev/null || fail_class "CLI_CONTRACT_TOOL_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F "\"contract_version\": \"$contract_version\"" >/dev/null || fail_class "CLI_CONTRACT_VERSION_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F '"accepted_input_mode": "capture-bundle-and-legacy-backup-file"' >/dev/null || fail_class "CLI_CONTRACT_INPUT_MODE_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F '"output_mode": "external-restore-receipt-json"' >/dev/null || fail_class "CLI_CONTRACT_OUTPUT_MODE_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F '"production_mutation_performed": false' >/dev/null || fail_class "CLI_CONTRACT_MUTATION_FLAG_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F '"production_restore_performed": false' >/dev/null || fail_class "CLI_CONTRACT_RESTORE_FLAG_MISMATCH"
}

verify_input_directory() {
  [ -d "$input_dir" ] || fail_class "INPUT_BUNDLE_UNAVAILABLE"
  for required_file in main-service-production.dump backup-capture-metadata.json backup-capture-receipt.json checksums.sha256; do
    [ -f "$input_dir/$required_file" ] || fail_class "INPUT_BUNDLE_UNAVAILABLE"
  done
}

verify_receipt_output() {
  case "$receipt" in
    /*) ;;
    *) fail_class "RESTORE_RECEIPT_NOT_ABSOLUTE" ;;
  esac
  [ ! -e "$receipt" ] || fail_class "RESTORE_RECEIPT_COLLISION"
  receipt_parent=$(dirname "$receipt")
  [ -d "$receipt_parent" ] || fail_class "RESTORE_RECEIPT_PARENT_MISSING"
  parent_real="$(cd "$receipt_parent" 2>/dev/null && pwd -P)" || fail_class "RESTORE_RECEIPT_PARENT_MISSING"
  receipt_real="$parent_real/$(basename "$receipt")"
  case "$receipt_real" in
    "$repo_real"|"$repo_real"/*) fail_class "RESTORE_RECEIPT_UNDER_REPOSITORY" ;;
  esac
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));' "$1"
}

main "$@"
