// Assessment agent: as-is extraction of every regional org, then fit-gap, comparison, report and architecture.
// An org whose CLI alias is not authorised on this machine is skipped and reported; its earlier as-is file stays.
const fs = require('fs');
const path = require('path');
const P = require('../../paths');
const engagement = require('./engagement.json');

async function run({ sh, log }) {
  const skipped = [];
  for (const o of engagement.orgs) {
    if (sh(`sf org display --target-org ${o.alias} --json`, { quiet: true }) !== 0) { skipped.push(o.label); log(`skip ${o.label}: alias ${o.alias} not authorised`); continue; }
    const step = `node src/generators/assess-org.js ${o.region} "${o.label}"`;
    log(`$ SF_ALIAS=${o.alias} ${step}`);
    if (sh(step, { env: { SF_ALIAS: o.alias } }) !== 0) return { status: 'failed', summary: `as-is extraction failed for ${o.label}` };
    const disc = `node src/generators/discover-org.js ${o.region} "${o.label}"`;
    log(`$ SF_ALIAS=${o.alias} ${disc}`);
    if (sh(disc, { env: { SF_ALIAS: o.alias } }) !== 0) return { status: 'failed', summary: `discovery extraction failed for ${o.label}` };
  }
  for (const g of ['emit-assessment', 'emit-discovery']) {
    log(`$ node src/generators/${g}.js`);
    if (sh(`node src/generators/${g}.js`) !== 0) return { status: 'failed', summary: `${g} failed` };
  }
  const fg = JSON.parse(fs.readFileSync(path.join(P.ASSESSMENT, 'fit-gap.json'), 'utf8'));
  const counts = Object.keys(fg.verdicts).map((v) => `${fg.items.filter((i) => i.verdict === v).length} ${fg.verdicts[v].toLowerCase()}`).join(' · ');
  return {
    status: 'ok',
    summary: `${fg.orgs.filter((o) => o.extracted).length}/${fg.orgs.length} orgs · ${fg.items.length} components · ${counts}${skipped.length ? ` · not connected: ${skipped.join(', ')}` : ''}`,
    details: { orgs: fg.orgs.map((o) => ({ org: o.label, extracted: o.extracted })), capabilities: fg.capabilities.length, skipped },
  };
}

module.exports = { spec: require('./agent.json'), run };
