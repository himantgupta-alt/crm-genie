// Verification agent: compares the target with the org's own values and replays rule cases.
const fs = require('fs');
const path = require('path');

async function run({ workdir, sh, log }) {
  log('$ node target/parity/run.js');
  const code = sh('node target/parity/run.js');
  const file = path.join(workdir, 'target', 'parity', 'report.json');
  if (!fs.existsSync(file)) return { status: 'failed', summary: 'no report produced' };
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    status: code === 0 && r.summary.ok ? 'ok' : 'failed',
    summary: `${r.summary.derivedValues}; cases ${r.summary.cases}`,
    details: r.summary,
  };
}

module.exports = { spec: require('./agent.json'), run };
