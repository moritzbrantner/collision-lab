#!/usr/bin/env bash
set -euo pipefail

renderers="${RENDERER_PROFILE_RENDERERS:-three three-webgpu wgpu}"
object_counts="${RENDERER_PROFILE_OBJECTS_SET:-100 1000 5000 20000}"
frames="${RENDERER_PROFILE_FRAMES:-180}"
port="${RENDERER_PROFILE_PORT_START:-4174}"

for renderer in $renderers; do
  for objects in $object_counts; do
    echo "# renderer=$renderer objects=$objects frames=$frames port=$port" >&2
    raw_output="$({
      RENDERER_PROFILE_OBJECTS="$objects" \
        RENDERER_PROFILE_FRAMES="$frames" \
        RENDERER_PROFILE_PORT="$port" \
        bash "$(dirname "$0")/profile-renderer.sh" "$renderer"
    } 2>&1)"

    result_count="$(printf '%s\n' "$raw_output" | grep -c '^\{"done":true,' || true)"
    if [[ "$result_count" != "1" ]]; then
      printf '%s\n' "$raw_output" >&2
      echo "expected exactly one renderer profile result, got $result_count" >&2
      exit 1
    fi

    result="$(printf '%s\n' "$raw_output" | grep '^\{"done":true,' | tail -n 1)"
    normalized="$(printf '%s\n' "$result" | jq -c -e \
      --arg renderer "$renderer" \
      --argjson objects "$objects" \
      'select(.done == true and .renderer == $renderer and .objects == $objects)')"
    if [[ -z "$normalized" ]]; then
      printf '%s\n' "$raw_output" >&2
      echo "renderer profile result did not match requested cell" >&2
      exit 1
    fi

    printf '%s\n' "$normalized"
    port=$((port + 1))
  done
done
