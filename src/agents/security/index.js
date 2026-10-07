// Security agent: roles, column grants and row-level security from profiles, permission sets and sharing.
const fs = require('fs');
const path = require('path');
const P = require('../../paths');

async function run({ workdir, sh, log, family }) {
  const cmd = `node src/generators/emit-postgres.js ${family.join(',')} --parts security`;
  log(`$ ${cmd}`);
  if (sh(cmd) !== 0) return { status: 'failed', summary: 'generator failed' };
  log('$ node src/generators/emit-cutover.js --parts credentials');
  if (sh('node src/generators/emit-cutover.js --parts credentials') !== 0) return { status: 'failed', summary: 'credentials checklist failed' };
  const sql = fs.readFileSync(path.join(P.SQL_DIRS.security, '060_security.sql'), 'utf8');
  const roles = (sql.match(/^CREATE ROLE /gm) || []).length;
  const policies = (sql.match(/^CREATE POLICY /gm) || []).length;
  return { status: 'ok', summary: `${roles} roles · ${policies} row-level policies`, details: { roles, policies } };
}

module.exports = { spec: require('./agent.json'), run };
