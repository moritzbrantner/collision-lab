#!/usr/bin/env bash
set -euo pipefail

renderer="${1:-}"
if [[ "$renderer" != "three" && "$renderer" != "wgpu" ]]; then
  echo "usage: $0 <three|wgpu>" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web_root="$repo_root/web"

if [[ ! -d "$web_root/out" || ! -f "$web_root/lib/wgpu-wasm-pkg/collision_wgpu_wasm.js" ]]; then
  (
    cd "$web_root"
    bun run wasm
    GITHUB_ACTIONS=false bun run build
  )
fi

cd "$web_root"
if [[ "${CI:-false}" == "true" ]]; then
  exec xvfb-run -a bun scripts/profile-renderer.mjs "$renderer"
fi
exec bun scripts/profile-renderer.mjs "$renderer"
