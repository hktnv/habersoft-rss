#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' "usage: capture-production-postgres-backup.sh --repository-dir <repo> --compose-file <path> --shared-env <path> --runtime-image-env <path> --output-dir <new-empty-output-dir>" >&2
}

repository_dir=
compose_file=
shared_env=
runtime_image_env=
output_dir=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-dir) repository_dir=${2:-}; shift 2 ;;
    --compose-file) compose_file=${2:-}; shift 2 ;;
    --shared-env|--env-file) shared_env=${2:-}; shift 2 ;;
    --runtime-image-env) runtime_image_env=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$repository_dir" ] || [ -z "$compose_file" ] || [ -z "$shared_env" ] || [ -z "$runtime_image_env" ] || [ -z "$output_dir" ]; then
  usage
  exit 1
fi

case "$output_dir" in
  "$repository_dir"|"$repository_dir"/*)
    printf '%s\n' "output-dir must be outside the repository checkout" >&2
    exit 1
    ;;
esac

script_sha="NOT_RECORDED"
if command -v sha256sum >/dev/null 2>&1; then
  script_sha="$(sha256sum "$0" | awk '{print $1}')"
fi

cd "$repository_dir"

node scripts/production-backup.mjs \
  --compose-file "$compose_file" \
  --shared-env "$shared_env" \
  --runtime-image-env "$runtime_image_env" \
  --output-dir "$output_dir" \
  --handoff-source-commit "__MS019C_SOURCE_COMMIT__" \
  --handoff-capture-script-sha256 "$script_sha"
