#!/usr/bin/env bash
set -euo pipefail

renderers="${RENDERER_PROFILE_RENDERERS:-three three-webgpu wgpu}"
object_counts="${RENDERER_PROFILE_OBJECTS_SET:-100 1000 5000 20000}"
frames="${RENDERER_PROFILE_FRAMES:-180}"
port="${RENDERER_PROFILE_PORT_START:-4174}"

for renderer in $renderers; do
  for objects in $object_counts; do
    echo "# renderer=$renderer objects=$objects frames=$frames port=$port" >&2
    RENDERER_PROFILE_OBJECTS="$objects" \
      RENDERER_PROFILE_FRAMES="$frames" \
      RENDERER_PROFILE_PORT="$port" \
      bash "$(dirname "$0")/profile-renderer.sh" "$renderer"
    port=$((port + 1))
  done
done
