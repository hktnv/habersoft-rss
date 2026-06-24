#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' "usage: verify-off-host-postgres-restore.sh --repository-dir <repo> --input-dir <flat-returned-backup-dir> --receipt <external-restore-receipt>" >&2
}

repository_dir=
input_dir=
receipt=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-dir) repository_dir=${2:-}; shift 2 ;;
    --input-dir) input_dir=${2:-}; shift 2 ;;
    --receipt) receipt=${2:-}; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$repository_dir" ] || [ -z "$input_dir" ] || [ -z "$receipt" ]; then
  usage
  exit 1
fi

cd "$repository_dir"

node scripts/production-restore-verify.mjs \
  --input-dir "$input_dir" \
  --receipt "$receipt"
