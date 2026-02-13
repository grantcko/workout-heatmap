#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Slowburn.app"
BUILD_APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
INSTALL_PATH="/Applications/$APP_NAME"

cd "$ROOT_DIR"
npx tauri build

if [[ ! -d "$BUILD_APP_PATH" ]]; then
  echo "Built app not found at: $BUILD_APP_PATH" >&2
  exit 1
fi

rm -rf "$INSTALL_PATH"
cp -R "$BUILD_APP_PATH" /Applications/
echo "Installed $APP_NAME to /Applications"
