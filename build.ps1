# Builds dist/chrome and dist/firefox (load-unpacked folders) plus a zip of each.
# Usage:  ./build.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'

Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue

foreach ($target in 'chrome', 'firefox') {
  $out = Join-Path $dist $target
  New-Item -ItemType Directory -Force -Path $out | Out-Null

  Copy-Item (Join-Path $root 'src\*') $out -Recurse
  Copy-Item (Join-Path $root "manifests\manifest.$target.json") (Join-Path $out 'manifest.json')

  $zip = Join-Path $dist "luxbux-overlay-$target.zip"
  Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force

  Write-Host "built $target  ->  dist/$target   (+ dist/luxbux-overlay-$target.zip)"
}
