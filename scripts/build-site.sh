#!/usr/bin/env bash
# Build every app and assemble the one GitHub Pages site in _site/:
#   _site/                      -> https://manishkkk18.github.io/data/        (redirects to india/)
#   _site/india/                -> the home page                    (apps/home; reads both apps' data for its facts)
#   _site/india/night-lights/   -> India Night Lights               (apps/night-lights/web)
#   _site/india/smoke-watch/    -> India Smoke Watch                (apps/smoke-watch/web)
#   _site/india/monsoon/        -> The Monsoon, District by District (apps/monsoon, static, no build)
# Each app builds from its own folder with its own lockfile; data comes from the repo
# (Night Lights) or the smoke-watch-data branch checked out into apps/smoke-watch/data
# beforehand (Smoke Watch's live files). Run from the repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/_site"
rm -rf "$OUT"
mkdir -p "$OUT/india"

build_app() { # <folder with package.json> <destination under _site>
  echo "::group::Build $1"
  (cd "$ROOT/$1" && npm ci --no-audit --no-fund && npm run build)
  mkdir -p "$OUT/$2"
  cp -R "$ROOT/$1/dist/." "$OUT/$2/"
  echo "::endgroup::"
}

build_app apps/night-lights/web india/night-lights
build_app apps/smoke-watch/web india/smoke-watch

build_app apps/home india

# The Monsoon is a static site with no build step: copy its pages and data, not its pipeline.
mkdir -p "$OUT/india/monsoon"
(cd "$ROOT/apps/monsoon" && cp -R index.html favicon.svg og.png css js vendor data "$OUT/india/monsoon/")

cp "$ROOT/site/index.html" "$ROOT/site/404.html" "$OUT/"
touch "$OUT/.nojekyll"
echo "Site assembled: $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
