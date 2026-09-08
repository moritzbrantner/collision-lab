#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
binary="$root/target/release/collision-lab"
needs_build=0

if [[ ! -x "$binary" ]]; then
  needs_build=1
elif [[ "$root/Cargo.toml" -nt "$binary" ]]; then
  needs_build=1
elif find "$root/src" -type f -name '*.rs' -newer "$binary" -print -quit | grep -q .; then
  needs_build=1
fi

if [[ "$needs_build" -eq 1 ]]; then
  cargo build --quiet --release
fi

exec "$binary" \
  --objects 3000 \
  --cell-size 2.5 \
  --fat-margin 0.75 \
  --seed 42 \
  --world-extent 100 \
  --half-extent 0.5 \
  --scenario clustered
