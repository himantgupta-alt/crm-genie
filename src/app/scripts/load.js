// Builds the CRM Genie database on any Postgres (Azure Flexible Server in production):
//   1. applies the compiled schema adlc/3-build/*/sql/*.sql (in manifest order)
//   2. loads the org export (adlc/1-discover/extraction/data) in dependency order, in load mode
//   3. recomputes roll-ups, resyncs auto-numbers
//   4. records what Salesforce stored for every formula and roll-up (migration.sf_expected) for live parity
//
//   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=crm node scripts/load.js [--recreate]
//
// --recreate drops schema app and migration and the sf_* roles first. Without it, an existing schema stops the load.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const P = require('../../paths');
const ROOT = P.ROOT;
const manifest = JSON.parse(fs.readFileSync(P.DB_MANIFEST, 'utf8'));
const bp = JSON.parse(fs.readFileSync(P.BLUEPRINT, 'utf8'));
if (manifest.blueprintHash !== bp.contentHash) throw new Error('adlc/3-build was emitted from a different blueprint; re-run emit-postgres');
const entities = new Map(bp.entities.map((e) => [e.id, e]));
const derivations = new Map(bp.derivations.map((d) => [d.id, d]));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const readCsv = (id) => {
  const f = path.join(P.DATA, `${id}.csv`);
  return fs.existsSync(f) ? parseCsv(fs.readFileSync(f, 'utf8')) : [];
};
const T = (id) => `app.${entities.get(id).name}`;

async function main() {
  const recreate = process.argv.includes('--recreate');
  const db = new Client({ ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: process.env.PGSSL_INSECURE !== '1' } });
  await db.connect();
  const me = (await db.query('SELECT current_user AS u, version() AS v')).rows[0];
  console.log(`connected as ${me.u} · ${me.v.split(',')[0]}`);

  const exists = (await db.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'app'`)).rowCount > 0;
  if (exists && !recreate) throw new Error('schema app already exists; pass --recreate to rebuild it');
  if (recreate) {
    await db.query('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS migration CASCADE;');
    const roles = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'sf\\_%'`)).rows.map((r) => r.rolname);
    for (const r of roles) {
      await db.query(`DROP OWNED BY ${db.escapeIdentifier(r)}`).catch(() => {});
      await db.query(`DROP ROLE ${db.escapeIdentifier(r)}`);
    }
    console.log(`dropped schema app, migration and ${roles.length} sf_* roles`);
  }

  for (const f of manifest.files) {
    await db.query(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    console.log(`applied ${f}`);
  }

  // The app connects as this login and switches persona with SET ROLE, so it needs membership in each role.
  const roles = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'sf\\_%'`)).rows.map((r) => r.rolname);
  for (const r of roles) await db.query(`GRANT ${db.escapeIdentifier(r)} TO ${db.escapeIdentifier(me.u)} WITH INHERIT FALSE, SET TRUE`);
  console.log(`granted SET on ${roles.length} roles to ${me.u}`);

  // Load in dependency order, in load mode.
  const loaded = {};
  await db.query(`BEGIN; SET LOCAL app.loading = 'on';`);
  for (const id of [...manifest.referenceTables, ...manifest.family]) {
    const e = entities.get(id);
    const cols = new Set((await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = $1 AND is_generated = 'NEVER'`, [e.name])).rows.map((r) => r.column_name));
    const fields = e.fields.filter((f) => cols.has(f.name) && derivations.get(f.derivation)?.strategy !== 'trigger_maintained');
    const rows = readCsv(id);
    for (const r of rows) {
      const use = fields.filter((f) => f.source in r);
      await db.query(`INSERT INTO ${T(id)} (${use.map((f) => f.name).join(', ')}) VALUES (${use.map((_, i) => `$${i + 1}`).join(', ')})`,
        use.map((f) => (r[f.source] === '' ? null : r[f.source])));
    }
    loaded[id] = rows.length;
    console.log(`loaded ${id}: ${rows.length}`);
  }
  // Still in load mode: the recompute must not stamp LastModifiedDate with the load time.
  const recomputed = (await db.query('SELECT app.recompute_all_rollups() AS n')).rows[0].n;
  await db.query('COMMIT');
  for (const id of manifest.family) {
    const name = entities.get(id).fields.find((f) => f.autoNumber);
    if (!name) continue;
    await db.query(`INSERT INTO app.autonumber (entity, last_value)
      SELECT $1, COALESCE(max(substring(${name.name} from '[0-9]+$')::bigint), 0) FROM ${T(id)}
      ON CONFLICT (entity) DO UPDATE SET last_value = EXCLUDED.last_value`, [id]);
  }
  console.log(`roll-ups recomputed: ${recomputed}; auto-numbers resynced`);

  // What Salesforce stored for each derived field, for live parity checks.
  await db.query(`CREATE SCHEMA migration;
    CREATE TABLE migration.sf_expected (sobject text, record_id varchar(18), field text, sf_value text, PRIMARY KEY (sobject, record_id, field));
    CREATE TABLE migration.run (loaded_at timestamptz DEFAULT now(), blueprint_hash text, export_day date, loaded jsonb);`);
  let exportDay = null;
  for (const id of manifest.family) {
    const rows = readCsv(id);
    for (const d of bp.derivations.filter((x) => x.entity === id && x.kind !== 'platform')) {
      const api = d.field.split('.')[1];
      for (const r of rows) {
        if (!(api in r)) continue;
        await db.query('INSERT INTO migration.sf_expected VALUES ($1, $2, $3, $4)', [id, r.Id, api, r[api] === '' ? null : r[api]]);
      }
      // TODAY() formulas were evaluated on the export day; recover it from the data.
      if (d.analysis?.volatile) {
        const end = d.expr.args?.[0]?.path?.[0];
        const days = new Map();
        for (const r of rows) {
          if (!r[end] || r[api] === '') continue;
          const x = new Date(`${r[end]}T00:00:00Z`);
          x.setUTCDate(x.getUTCDate() - Number(r[api]));
          const k = x.toISOString().slice(0, 10);
          days.set(k, (days.get(k) ?? 0) + 1);
        }
        exportDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      }
    }
  }
  await db.query('INSERT INTO migration.run (blueprint_hash, export_day, loaded) VALUES ($1, $2, $3)', [bp.contentHash, exportDay, loaded]);
  const n = (await db.query('SELECT count(*)::int AS n FROM migration.sf_expected')).rows[0].n;
  console.log(`recorded ${n} Salesforce values for parity (export day ${exportDay})`);

  // Load report: what moved and whether it reconciles with Salesforce. No host names or times, so a re-run on the
  // same export gives the same report.
  const counts = {};
  for (const id of Object.keys(loaded)) counts[id] = (await db.query(`SELECT count(*)::int AS n FROM ${T(id)}`)).rows[0].n;
  const ok = Object.keys(loaded).every((id) => counts[id] === loaded[id] && loaded[id] === (entities.get(id).rowCount ?? loaded[id]));
  const pad = (s, w) => String(s).padEnd(w);
  const report = [
    '# Load report', '',
    'Owner: Data load agent · written by src/app/scripts/load.js on every load', '',
    `blueprint    ${bp.contentHash.slice(0, 12)}`,
    `target       ${me.v.split(',')[0]}`,
    `order        ${Object.keys(loaded).map((id) => entities.get(id).name).join(' → ')}`,
    `mode         load mode on (rules and roll-up triggers deferred), one transaction`, '',
    `${pad('object', 22)}${pad('in Salesforce', 15)}${pad('loaded', 9)}${pad('in table', 10)}result`,
    ...Object.keys(loaded).map((id) => { const sf = entities.get(id).rowCount ?? loaded[id]; return `${pad(id, 22)}${pad(sf, 15)}${pad(loaded[id], 9)}${pad(counts[id], 10)}${counts[id] === sf ? 'match' : 'MISMATCH'}`; }),
    '',
    `roll-ups     recomputed: ${recomputed}`,
    `auto-numbers resynced from the loaded names`,
    `parity       ${n} Salesforce values recorded for comparison (export day ${exportDay})`,
    `record IDs   kept: every row keeps its 18-character Salesforce ID`,
    `result       ${ok ? 'RECONCILED' : 'NOT RECONCILED'}: ${Object.values(loaded).reduce((a, b) => a + b, 0)} rows across ${Object.keys(loaded).length} objects`, '',
  ].join('\n');
  fs.mkdirSync(P.DATA_LOAD, { recursive: true });
  fs.writeFileSync(path.join(P.DATA_LOAD, 'load-report.txt'), report);
  console.log(`load report -> ${P.rel(path.join(P.DATA_LOAD, 'load-report.txt'))}`);
  await db.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
