// Seeds one Org Compiler connection from this machine's Salesforce CLI login, so the hosted Org Compiler starts
// connected to the org already in use (shown masked on the Connections page; replace it with Connect).
//
//   CONNECTION_KEY=… PGHOST=… PGUSER=… PGPASSWORD=… PGDATABASE=… node scripts/seed-connection.js eu myorg
//   … node scripts/seed-connection.js cg cgorg "CG Cloud"      (any org: region, CLI alias, name)
//
// Reads the CLI's refresh token (sf org display --verbose), encrypts it with CONNECTION_KEY and stores it in
// ops.org_connection. The token never touches disk or git; adlc/6-go-live/infra/seed_connection.ps1 sets the env.
const { execFileSync } = require('child_process');
const { Pool } = require('pg');

const [region = 'eu', alias = 'myorg', labelArg] = process.argv.slice(2);
if (!process.env.CONNECTION_KEY) { console.error('CONNECTION_KEY is required'); process.exit(2); }
const { enc, mask } = require('../connections-crypto');
const engagement = require('../../agents/assessment/engagement.json');
// Name shown on the Connections page: given on the command line, else the demo engagement's, else the region.
const label = labelArg || engagement.orgs.find((o) => o.region === region)?.label || region;

(async () => {
  const sf = (args) => JSON.parse(execFileSync(process.platform === 'win32' ? `sf.cmd ${args.join(' ')}` : 'sf', process.platform === 'win32' ? [] : args, { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] })).result;
  const out = sf(['org', 'display', '--target-org', alias, '--json']);
  // Recent CLI versions show the auth URL only through this command: force://<clientId>:<secret>:<refreshToken>@<host>
  const authUrl = sf(['org', 'auth', 'show-sfdx-auth-url', '--target-org', alias, '--json'])?.sfdxAuthUrl;
  const m = /^force:\/\/([^:]+):([^:]*):([^@]+)@(.+)$/.exec(authUrl || '');
  if (!m) throw new Error(`no CLI auth URL for ${alias}`);
  const [, clientId, , refreshToken] = m;
  const pool = new Pool({ ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ops;
    CREATE TABLE IF NOT EXISTS ops.org_connection (
      region text PRIMARY KEY, label text NOT NULL, login_url text NOT NULL, position int NOT NULL DEFAULT 0,
      client_id text, instance_url text, org_id text, username text, token_enc text,
      connected_at timestamptz, connected_by text, last_run jsonb)`);
  await pool.query(`INSERT INTO ops.org_connection (region, label, login_url, client_id, instance_url, org_id, username, token_enc, connected_at, connected_by)
      VALUES ($1, $8, $2, $3, $4, $5, $6, $7, now(), 'Salesforce CLI (seeded)')
    ON CONFLICT (region) DO UPDATE SET login_url = EXCLUDED.login_url, client_id = EXCLUDED.client_id, instance_url = EXCLUDED.instance_url,
      org_id = EXCLUDED.org_id, username = EXCLUDED.username, token_enc = EXCLUDED.token_enc, connected_at = now(), connected_by = EXCLUDED.connected_by`,
  [region, out.instanceUrl, clientId, out.instanceUrl, out.id, out.username, enc(refreshToken), label]);
  await pool.end();
  console.log(`connection ${region}: ${mask(out.username)} seeded from CLI alias ${alias}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
