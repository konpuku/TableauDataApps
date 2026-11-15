#!/usr/bin/env bash
# shared/ の kit.js / kit.css / local-query.js を各アプリの content/src/ に配る。
# パッケージは自己完結していなければならない(content/ の外は配信されない)ので、参照ではなくコピーする。
set -euo pipefail
cd "$(dirname "$0")/.."
for src in apps/*/Packages/*/content/src; do
  cp shared/kit.js shared/kit.css shared/local-query.js "$src/"
  echo "synced -> $src"
done
