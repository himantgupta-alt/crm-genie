#!/usr/bin/env bash
# Phase 1: full extraction. Usage: SF_ALIAS=myorg ./scripts/run-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ALIAS="${SF_ALIAS:-myorg}"

echo "== 1/4 Schema (REST describe) =="
node scripts/extract-schema.js

echo "== 2/4 Metadata retrieve (Metadata API) =="
sf project retrieve start --manifest manifest/package.xml --target-org "$ALIAS" --ignore-conflicts --wait 30 --json > output/retrieve-result.json || true

echo "== 3/4 Business rules & automations =="
node scripts/extract-logic.js

echo "== 4/4 Data export =="
node scripts/export-data.js
