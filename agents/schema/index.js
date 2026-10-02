// Schema agent: tables, keys, calculations and roll-ups for the object family.
const PARTS = 'runtime,tables,views,rollups';

async function run({ sh, log, family }) {
  const cmd = `node scripts/emit-postgres.js ${family.join(',')} --parts ${PARTS}`;
  log(`$ ${cmd}`);
  if (sh(cmd) !== 0) return { status: 'failed', summary: 'generator failed' };
  return { status: 'ok', summary: 'runtime, tables, views and roll-ups generated', details: { parts: PARTS.split(',') } };
}

module.exports = { spec: require('./agent.json'), run };
