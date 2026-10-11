#!/usr/bin/env bash
# Collector for the root `performance:work` capability.
#
# Runs the Cargo tests that measure the deterministic work counters for the
# operations declared in .performance/contract.json and prints one
# `coding-tooling/work-evidence/v1` document on stdout. Cargo output goes to
# stderr so stdout carries only the evidence. Each test checks correctness
# against its oracle before it writes `<operation>.json` into
# COLLISION_LAB_WORK_EVIDENCE_DIR; with that variable set, the tests leave the
# work bounds to `coding-tooling performance work`, and without it they
# assert the same bounds themselves.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

contract=".performance/contract.json"
suite="collision-lab/acceptance-work-v1"

evidence_dir="$(mktemp -d)"
trap 'rm -rf "$evidence_dir"' EXIT
export COLLISION_LAB_WORK_EVIDENCE_DIR="$evidence_dir"

run_tests() {
  cargo test --quiet "$@" >&2
}

run_tests --test work_complexity -- --exact \
  clustered_fixed_density_broad_phase_work_scales_per_algorithm_contract \
  sparse_fixed_density_broad_phase_work_scales_per_algorithm_contract \
  retained_dynamic_tree_sync_work_scales_with_moving_bodies_only
run_tests --manifest-path zombie-arena-3d-wasm/Cargo.toml --lib -- --exact \
  work_complexity::shared_flow_field_builds_once_regardless_of_agent_count \
  work_complexity::topology_or_goal_change_rebuilds_the_shared_field_exactly_once

# Contract order; a missing fragment means a test did not run or failed.
operations=(
  broad-phase-clustered-fixed-density
  broad-phase-sparse-fixed-density
  retained-dynamic-tree-frame-sync
  shared-flow-field-fixed-goal
  shared-flow-field-change-rebuild
)
fragments=()
for operation in "${operations[@]}"; do
  fragment="$evidence_dir/$operation.json"
  if [[ ! -s "$fragment" ]]; then
    printf 'missing work evidence for %s\n' "$operation" >&2
    exit 1
  fi
  fragments+=("$(<"$fragment")")
done

# Hash the contract bytes as they are on disk now, after the tests ran.
if command -v sha256sum >/dev/null 2>&1; then
  contract_sha="$(sha256sum "$contract" | cut -d' ' -f1)"
else
  contract_sha="$(shasum -a 256 "$contract" | cut -d' ' -f1)"
fi

joined="$(IFS=,; printf '%s' "${fragments[*]}")"
printf '{"schemaVersion":"coding-tooling/work-evidence/v1","suite":"%s","contractSha256":"%s","operations":[%s]}\n' \
  "$suite" "$contract_sha" "$joined"
