#!/usr/bin/env bash
set -euo pipefail

npm run build

rm -rf .pkgbuild
mkdir -p .pkgbuild release

npx esbuild src/relay/index.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node18 \
  --outfile=.pkgbuild/relay-entry.cjs

cp -r public .pkgbuild/public

cat > .pkgbuild/package.json <<'EOF'
{
  "name": "mpp-portable-bundle",
  "version": "0.0.0",
  "type": "commonjs",
  "bin": "relay-entry.cjs",
  "pkg": {
    "assets": [
      "public/**/*"
    ]
  }
}
EOF

npx pkg .pkgbuild --targets node18-win-x64 --output release/MPP-portable.exe
cp release/MPP-portable.exe release/MPP-Setup.exe
