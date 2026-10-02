// Extraction agent: schema, metadata and data from the Salesforce org.
const fs = require('fs');
const path = require('path');

const STEPS = [
  'node scripts/extract-schema.js',
  'sf project retrieve start --manifest manifest/package.xml --target-org myorg',
  'node scripts/extract-logic.js',
  'node scripts/export-data.js',
];

async function run({ workdir, sh, log }) {
  for (const step of STEPS) {
    log(`$ ${step}`);
    if (sh(step) !== 0) return { status: 'failed', summary: `step failed: ${step}` };
  }
  const index = JSON.parse(fs.readFileSync(path.join(workdir, 'output', 'schema', 'index.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(workdir, 'output', 'data', '_export-report.json'), 'utf8'));
  const rows = report.reduce((a, r) => a + (r.records || 0), 0);
  const errors = report.filter((r) => r.error).map((r) => r.object);
  return {
    status: 'ok',
    summary: `${index.length} objects described · ${rows} rows exported · ${errors.length} objects not exportable`,
    details: { objects: index.length, rows, notExportable: errors },
  };
}

module.exports = { spec: require('./agent.json'), run };
