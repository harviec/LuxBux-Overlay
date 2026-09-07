#!/usr/bin/env bash
# Builds dist/chrome and dist/firefox (load-unpacked folders) plus a zip of each.
# Usage:  ./build.sh
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
dist="$root/dist"

rm -rf "$dist"

for target in chrome firefox; do
  out="$dist/$target"
  mkdir -p "$out"

  cp "$root"/src/* "$out"/
  cp "$root/manifests/manifest.$target.json" "$out/manifest.json"

  ( cd "$out" && zip -qr "../luxbux-overlay-$target.zip" . )

  echo "built $target  ->  dist/$target   (+ dist/luxbux-overlay-$target.zip)"
done
