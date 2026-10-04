#!/bin/sh
set -eu
local_test_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
local_test_helper=${LOCAL_TEST_ENV_HELPER:-$HOME/.agents/skills/local-test-env/scripts/compose_instance.py}
if [ ! -f "$local_test_helper" ]; then
  printf '%s\n' "Local Test Environment helper not found. Set LOCAL_TEST_ENV_HELPER to compose_instance.py." >&2
  exit 1
fi
local_test_action=${1:-}
if [ "$#" -gt 0 ]; then shift; fi
case "$local_test_action" in
  prepare)
    exec python3 "$local_test_helper" prepare --project-dir "$local_test_project_dir" --file "$local_test_project_dir/compose.data-center-test.yaml" "$@"
    ;;
  list)
    exec python3 "$local_test_helper" list --project-dir "$local_test_project_dir" "$@"
    ;;
  up|inspect|down)
    if [ "$#" -eq 0 ]; then
      printf '%s\n' "Usage: $0 $local_test_action INSTANCE_ID [options]" >&2
      exit 1
    fi
    local_test_instance=$1
    shift
    exec python3 "$local_test_helper" "$local_test_action" --project-dir "$local_test_project_dir" --instance "$local_test_instance" "$@"
    ;;
  *)
    printf '%s\n' "Usage: $0 prepare | list | up INSTANCE_ID | inspect INSTANCE_ID | down INSTANCE_ID [--delete-data]" >&2
    exit 1
    ;;
esac
