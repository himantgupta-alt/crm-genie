#!/usr/bin/env bash
# Phase 1: full extraction. Usage (from the repository root): SF_ALIAS=myorg ./src/generators/run-all.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
X=adlc/1-discover/extraction
ALIAS="${SF_ALIAS:-myorg}"

echo "== 1/5 Schema (REST describe) + manifest =="
node src/generators/extract-schema.js

echo "== 2/5 Metadata retrieve (Metadata API, incl. folder-based reports, dashboards, templates) =="
sf project retrieve start --manifest $X/metadata/package.xml --target-org "$ALIAS" --ignore-conflicts --wait 30 --json > $X/metadata/retrieve-result.json || true

echo "== 3/5 Business rules & automations =="
node src/generators/extract-logic.js

echo "== 4/5 Data export =="
node src/generators/export-data.js

echo "== 5/5 Inventory + gap register =="
node src/generators/extract-inventory.js
