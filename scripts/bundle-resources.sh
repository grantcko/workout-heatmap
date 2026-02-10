#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RES_DIR="$ROOT_DIR/src-tauri/resources"
APP_DIR="$RES_DIR/slowburn-app"

rm -rf "$RES_DIR"
mkdir -p "$APP_DIR"

rsync -a "$ROOT_DIR/server.js" "$APP_DIR/"
rsync -a "$ROOT_DIR/lib" "$APP_DIR/"
rsync -a "$ROOT_DIR/public" "$APP_DIR/"
rsync -a "$ROOT_DIR/package.json" "$APP_DIR/"
rsync -a "$ROOT_DIR/package-lock.json" "$APP_DIR/"

# Install only production deps into a temp dir to avoid dev-only binaries/symlinks.
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

rsync -a "$ROOT_DIR/package.json" "$TMP_DIR/"
rsync -a "$ROOT_DIR/package-lock.json" "$TMP_DIR/"
(
  cd "$TMP_DIR"
  npm ci --omit=dev
)
rsync -a "$TMP_DIR/node_modules" "$APP_DIR/"

# Avoid symlinks in resources and normalize perms for build scripts.
find "$APP_DIR/node_modules" -type l -delete
chmod -R u+rwX,go+rX "$APP_DIR/node_modules"

if [[ -f "$ROOT_DIR/slowburn.db" ]]; then
  cp "$ROOT_DIR/slowburn.db" "$RES_DIR/slowburn.db"
fi
