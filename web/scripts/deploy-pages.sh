#!/usr/bin/env bash
# Build the site and publish web/dist to the gh-pages branch (served by GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
REMOTE=$(git -C .. remote get-url origin)
cd dist
touch .nojekyll            # serve files as-is (no Jekyll processing)
cp index.html 404.html     # unknown paths fall back to the app
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C ../.. config user.name)" -c user.email="$(git -C ../.. config user.email)" \
  commit -q -m "Deploy $(git -C ../.. rev-parse --short HEAD)"
git push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Published to gh-pages"
