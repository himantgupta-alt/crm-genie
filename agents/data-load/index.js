// Data load agent: loads the org's data into the target database. Skipped when no target database is
// configured (the Verification agent then loads an in-memory PostgreSQL itself). See agent.json
// "scaling" for how this agent is split into a coordinator and parallel workers for large orgs.
async function run({ sh, log }) {
  if (!process.env.PGHOST) {
    const reason = 'no target database configured (PGHOST); Verification loads an in-memory PostgreSQL instead';
    log(reason);
    return { status: 'skipped', summary: reason };
  }
  const cmd = 'node target/app/scripts/load.js --recreate';
  log(`$ ${cmd}`);
  if (sh(cmd) !== 0) return { status: 'failed', summary: 'load failed' };
  return { status: 'ok', summary: `loaded into ${process.env.PGHOST}` };
}

module.exports = { spec: require('./agent.json'), run };
