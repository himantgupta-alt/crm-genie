#!/usr/bin/env bash
# Phase 1: full extraction. Usage: SF_ALIAS=myorg ./scripts/run-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ALIAS="${SF_ALIAS:-myorg}"

echo "== 1/5 Schema (REST describe) + manifest =="
node scripts/extract-schema.js

echo "== 2/5 Metadata retrieve (Metadata API, incl. folder-based reports, dashboards, templates) =="
sf project retrieve start --manifest manifest/package.xml --target-org "$ALIAS" --ignore-conflicts --wait 30 --json > output/retrieve-result.json || true

echo "== 3/5 Business rules & automations =="
node scripts/extract-logic.js

echo "== 4/5 Data export =="
node scripts/export-data.js

echo "== 5/5 Inventory + gap register =="
node scripts/extract-inventory.js
