// Extraction agent: schema, metadata and data from the Salesforce org.
const fs = require('fs');
const path = require('path');
const P = require('../../paths');

const STEPS = [
  'node src/generators/extract-schema.js',
  'sf project retrieve start --manifest adlc/1-discover/extraction/metadata/package.xml --target-org myorg',
  'node src/generators/extract-logic.js',
  'node src/generators/export-data.js',
  'node src/generators/extract-inventory.js',
];

async function run({ workdir, sh, log }) {
  for (const step of STEPS) {
    log(`$ ${step}`);
    if (sh(step) !== 0) return { status: 'failed', summary: `step failed: ${step}` };
  }
  const index = JSON.parse(fs.readFileSync(path.join(P.SCHEMA, 'index.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(P.DATA, '_export-report.json'), 'utf8'));
  const rows = report.reduce((a, r) => a + (r.records || 0), 0);
  const errors = report.filter((r) => r.error).map((r) => r.object);
  const coverage = JSON.parse(fs.readFileSync(path.join(P.INVENTORY, 'coverage.json'), 'utf8'));
  return {
    status: 'ok',
    summary: `${index.length} objects described · ${rows} rows exported · ${errors.length} objects not exportable · gap register written`,
    details: { objects: index.length, rows, notExportable: errors, metadataTypes: coverage.retrievedTypes, foldered: coverage.foldered, notRequestedTypes: coverage.notRequested.length },
  };
}

module.exports = { spec: require('./agent.json'), run };
