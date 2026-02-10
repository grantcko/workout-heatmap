#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/src-tauri/bin"
BUILD_DIR="$ROOT_DIR/src-tauri/sidecar"

mkdir -p "$OUT_DIR" "$BUILD_DIR"

HOST="$(rustc -vV | rg '^host: ' | awk '{print $2}')"
if [[ -z "$HOST" ]]; then
  echo "Could not determine Rust host target" >&2
  exit 1
fi

PLATFORM="$(node -p "process.platform")"
ARCH="$(node -p "process.arch")"
if [[ "$PLATFORM" == "darwin" ]]; then
  PLATFORM="macos"
fi

TARGET="node18-${PLATFORM}-${ARCH}"

npx --yes esbuild "$ROOT_DIR/server.js" \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node18 \
  --outfile="$BUILD_DIR/server.cjs"

npx --yes pkg "$BUILD_DIR/server.cjs" --targets "$TARGET" --output "$OUT_DIR/slowburn-server-$HOST"
