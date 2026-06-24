#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' "usage: capture-production-postgres-backup.sh --repository-dir <repo> --compose-file <path> --shared-env <path> --runtime-image-env <path> --output-dir <new-empty-output-dir> [--preflight-only]" >&2
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
compose_file=
shared_env=
runtime_image_env=
output_dir=
preflight_only=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-dir) repository_dir=${2:-}; shift 2 ;;
    --compose-file) compose_file=${2:-}; shift 2 ;;
    --shared-env) shared_env=${2:-}; shift 2 ;;
    --runtime-image-env) runtime_image_env=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    --preflight-only) preflight_only=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail_class "UNSUPPORTED_FLAG" ;;
  esac
done

if [ -z "$repository_dir" ] || [ -z "$compose_file" ] || [ -z "$shared_env" ] || [ -z "$runtime_image_env" ] || [ -z "$output_dir" ]; then
  usage
  exit 1
fi

preflight

script_sha="NOT_RECORDED"
script_sha="$(file_sha256 "$0")"

if [ "$preflight_only" = "true" ]; then
  printf '%s\n' "backup handoff preflight passed"
  exit 0
fi

umask 077
cd "$repo_real"

node scripts/production-backup.mjs \
  --compose-file "$compose_file" \
  --shared-env "$shared_env" \
  --runtime-image-env "$runtime_image_env" \
  --output-dir "$output_dir" \
  --handoff-source-commit "$required_tooling_commit" \
  --handoff-capture-script-sha256 "$script_sha"
}

preflight() {
  resolve_repository
  verify_canonical_remote
  verify_required_commit
  verify_required_tool_files
  verify_backup_contract
  require_repo_file "$compose_file" "COMPOSE_CONTEXT_INVALID"
  require_repo_file "$shared_env" "SHARED_ENV_UNAVAILABLE"
  require_repo_file "$runtime_image_env" "RUNTIME_IMAGE_ENV_UNAVAILABLE"
  verify_output_directory
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

verify_backup_contract() {
  contract_json="$(cd "$repo_real" && node scripts/production-backup.mjs contract:describe 2>/dev/null)" || fail_class "CLI_CONTRACT_COMMAND_FAILED"
  printf '%s\n' "$contract_json" | grep -F '"tool_name": "production-backup"' >/dev/null || fail_class "CLI_CONTRACT_TOOL_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F "\"contract_version\": \"$contract_version\"" >/dev/null || fail_class "CLI_CONTRACT_VERSION_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F '"accepted_input_mode": "bundle-directory-and-legacy-file"' >/dev/null || fail_class "CLI_CONTRACT_INPUT_MODE_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F '"output_mode": "directory"' >/dev/null || fail_class "CLI_CONTRACT_OUTPUT_MODE_MISMATCH"
  printf '%s\n' "$contract_json" | grep -F '"production_mutation_performed": false' >/dev/null || fail_class "CLI_CONTRACT_MUTATION_FLAG_MISMATCH"
}

require_repo_file() {
  input_path=$1
  failure_class=$2
  case "$input_path" in
    /*) candidate=$input_path ;;
    *) candidate="$repo_real/$input_path" ;;
  esac
  [ -f "$candidate" ] || fail_class "$failure_class"
}

verify_output_directory() {
  case "$output_dir" in
    /*) ;;
    *) fail_class "OUTPUT_DIR_NOT_ABSOLUTE" ;;
  esac
  if [ -e "$output_dir" ]; then
    [ -d "$output_dir" ] || fail_class "OUTPUT_COLLISION"
    output_real="$(cd "$output_dir" 2>/dev/null && pwd -P)" || fail_class "OUTPUT_COLLISION"
    if find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
      fail_class "OUTPUT_COLLISION"
    fi
  else
    output_parent=$(dirname "$output_dir")
    [ -d "$output_parent" ] || fail_class "OUTPUT_PARENT_MISSING"
    parent_real="$(cd "$output_parent" 2>/dev/null && pwd -P)" || fail_class "OUTPUT_PARENT_MISSING"
    output_real="$parent_real/$(basename "$output_dir")"
  fi
  case "$output_real" in
    "$repo_real"|"$repo_real"/*) fail_class "OUTPUT_UNDER_REPOSITORY" ;;
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
