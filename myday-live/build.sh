#!/usr/bin/env bash
# Rebuild the bundle and stamp a new version into index.html, so browsers
# fetch a URL they've never seen rather than reusing an old cached copy.
set -euo pipefail
cd "$(dirname "$0")"
npx esbuild src/main.jsx --bundle --minify --format=iife --target=es2019 \
  --loader:.jsx=jsx --jsx=automatic --outfile=public/app.js \
  --define:process.env.NODE_ENV='"production"'
V=$(date +%s)
sed -i -E 's|<script src="/app\.js(\?v=[0-9]+)?"></script>|<script src="/app.js?v='"$V"'"></script>|' public/index.html
echo "built, version $V"
