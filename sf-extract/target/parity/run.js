// Parity harness for one object family.
//   1. Build a fresh Postgres (PGlite, in memory) from target/db/*.sql.
//   2. Load the org's exported rows (output/data) in load mode, recompute roll-ups.
//   3. Compare every derived value Postgres computes with the value Salesforce stored.
//   4. Replay rule cases (parity/cases.json) and compare outcomes with the expected answers.
// Writes parity/report.json and parity/report.md. Exits non-zero on any mismatch.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const TARGET = path.resolve(__dirname, '..');
const ROOT = path.resolve(TARGET, '..');
const bp = JSON.parse(fs.readFileSync(path.join(ROOT, 'blueprint', 'blueprint.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(TARGET, 'db', 'manifest.json'), 'utf8'));
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
if (manifest.blueprintHash !== bp.contentHash) throw new Error('target/db was emitted from a different blueprint; re-run emit-postgres');

const entities = new Map(bp.entities.map((e) => [e.id, e]));
const derivations = new Map(bp.derivations.map((d) => [d.id, d]));
const family = new Set(manifest.family);
const T = (id) => `app.${entities.get(id).name}`;
const fieldBySource = (entityId, source) => entities.get(entityId).fields.find((f) => f.source === source);

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
const readCsv = (entityId) => {
  const f = path.join(ROOT, 'output', 'data', `${entityId}.csv`);
  return fs.existsSync(f) ? parseCsv(fs.readFileSync(f, 'utf8')) : [];
};

const same = (a, b) => {
  const blank = (v) => v === null || v === undefined || v === '';
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return Math.abs(na - nb) < 1e-9;
  return String(a) === String(b);
};

async function columnsOf(db, table) {
  const [schema, name] = table.split('.');
  const r = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER'`, [schema, name]);
  return new Set(r.rows.map((x) => x.column_name));
}

async function load(db) {
  const loaded = {};
  const order = [...manifest.referenceTables, ...manifest.family];
  await db.exec(`BEGIN; SET LOCAL app.loading = 'on';`);
  for (const id of order) {
    const e = entities.get(id);
    const cols = await columnsOf(db, T(id));
    // Loadable: physical, not generated, not roll-up (recomputed below so the roll-up logic is tested).
    const fields = e.fields.filter((f) => cols.has(f.name) && derivations.get(f.derivation)?.strategy !== 'trigger_maintained');
    const rows = readCsv(id);
    for (const r of rows) {
      const use = fields.filter((f) => f.source in r);
      const sql = `INSERT INTO ${T(id)} (${use.map((f) => f.name).join(', ')}) VALUES (${use.map((_, i) => `$${i + 1}`).join(', ')})`;
      await db.query(sql, use.map((f) => (r[f.source] === '' ? null : r[f.source])));
    }
    loaded[id] = rows.length;
  }
  await db.exec('COMMIT;');
  const recomputed = (await db.query('SELECT app.recompute_all_rollups() AS n')).rows[0].n;
  // Auto-number counters continue after the highest loaded number.
  for (const id of manifest.family) {
    const name = entities.get(id).fields.find((f) => f.autoNumber);
    if (!name) continue;
    await db.query(`INSERT INTO app.autonumber (entity, last_value)
      SELECT $1, COALESCE(max(substring(${name.name} from '[0-9]+$')::bigint), 0) FROM ${T(id)}
      ON CONFLICT (entity) DO UPDATE SET last_value = EXCLUDED.last_value`, [id]);
  }
  return { loaded, recomputed };
}

// TODAY() formulas were evaluated by Salesforce on the export day. Recover that day from the data and
// require every row to agree on it; a disagreement would itself be a parity failure.
function exportDay(rows, d) {
  const endField = d.expr.args?.[0]?.path?.[0];
  const days = new Map();
  for (const r of rows) {
    if (!r[endField] || r[d.field.split('.')[1]] === '') continue;
    const end = new Date(`${r[endField]}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - Number(r[d.field.split('.')[1]]));
    const k = end.toISOString().slice(0, 10);
    days.set(k, (days.get(k) ?? 0) + 1);
  }
  return [...days.entries()].sort((a, b) => b[1] - a[1]);
}

async function compareDerived(db) {
  const results = [];
  for (const id of manifest.family) {
    const rows = readCsv(id);
    const byId = new Map(rows.map((r) => [r.Id, r]));
    for (const d of bp.derivations.filter((x) => x.entity === id && x.kind !== 'platform')) {
      const f = entities.get(id).fields.find((x) => x.id === d.field);
      let asOf = null;
      if (d.analysis?.volatile) {
        const days = exportDay(rows, d);
        asOf = days[0]?.[0];
        await db.query(`SELECT set_config('app.as_of_date', $1, false)`, [asOf]);
        if (days.length > 1) results.push({ derivation: d.id, note: `rows disagree on the export day: ${JSON.stringify(days)}` });
      }
      const pg = await db.query(`SELECT id, ${f.name}::text AS v FROM ${T(id)}_v`);
      const mismatches = [];
      for (const r of pg.rows) {
        const sf = byId.get(r.id)?.[f.source];
        if (!same(sf, r.v)) mismatches.push({ id: r.id, salesforce: sf, postgres: r.v });
      }
      await db.query(`SELECT set_config('app.as_of_date', '', false)`);
      results.push({ derivation: d.id, strategy: d.strategy, rows: pg.rows.length, matched: pg.rows.length - mismatches.length, asOf, mismatches: mismatches.slice(0, 5) });
    }
  }
  return results;
}

// ---------------------------------------------------------------- rule cases

function dateToken(v, today) {
  const m = /^@today(?:([+-]\d+)([dm]))?$/.exec(v);
  if (!m) return null;
  const d = new Date(`${today}T00:00:00Z`);
  if (m[2] === 'd') d.setUTCDate(d.getUTCDate() + Number(m[1]));
  if (m[2] === 'm') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + Number(m[1]));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last)); // Apex addMonths clamps to month end
  }
  return d.toISOString().slice(0, 10);
}

const ROLE = (grantId) => {
  const g = bp.security.find((x) => x.id === grantId);
  if (!g) throw new Error(`unknown grant ${grantId}`);
  return `sf_${g.kind === 'profile' ? 'profile' : 'permset'}_${g.name.replace(/[^A-Za-z0-9]+/g, '_')}`.toLowerCase().slice(0, 63);
};

async function classify(db, err) {
  if (err.code === 'P0001' && err.hint) return err.hint;
  if (err.code === '42501') return 'system:insufficient_access';
  if (err.code === '23514') {
    if (/_picklist$/.test(err.constraint)) return 'system:restricted_picklist';
    const r = await db.query('SELECT rule_id FROM app.rule_message WHERE constraint_name = $1', [err.constraint]);
    if (r.rows[0]) return r.rows[0].rule_id;
  }
  if (err.code === '23502') return 'system:required_field_missing';
  if (err.code === '23503') return 'system:invalid_cross_reference';
  return `system:${err.code} ${err.message}`;
}

async function runCase(db, c, today) {
  if (c.pending) return { id: c.id, origin: c.origin, status: 'pending', reason: c.pending };
  const ids = {};
  const entityOf = {};
  const val = (v) => {
    if (typeof v !== 'string') return v;
    if (v.startsWith('@today')) return dateToken(v, today);
    if (v.startsWith('@')) {
      if (!(v.slice(1) in ids)) throw new Error(`unknown alias ${v}`);
      return ids[v.slice(1)];
    }
    return v;
  };
  const cols = (entityId, values) => Object.entries(values).map(([k, v]) => {
    const f = fieldBySource(entityId, k);
    if (!f) throw new Error(`${entityId}.${k} not in blueprint`);
    return [f.name, val(v)];
  });
  const log = [];
  await db.exec(`BEGIN; SET LOCAL app.as_of_date = '${today}';`);
  try {
    for (const [i, s] of (c.steps ?? []).entries()) {
      await db.exec(`SAVEPOINT step; ${s.role ? `SET LOCAL ROLE ${ROLE(s.role)};` : ''}`);
      let outcome = 'ok';
      let detail = null;
      try {
        if (s.insert) {
          const e = entities.get(s.insert);
          const kv = cols(s.insert, s.values ?? {});
          // Reference tables have no id default; mint a Salesforce-shaped id with the entity's key prefix.
          const idCol = family.has(s.insert) ? [] : [['id', `app.new_sfid('${e.keyPrefix}')`]];
          const sql = `INSERT INTO ${T(s.insert)} (${[...idCol, ...kv].map(([k]) => k).join(', ')}) ` +
            `VALUES (${[...idCol.map(([, x]) => x), ...kv.map((_, j) => `$${j + 1}`)].join(', ')}) RETURNING id`;
          const r = await db.query(sql, kv.map(([, v]) => v));
          if (s.as) { ids[s.as] = r.rows[0].id; entityOf[s.as] = s.insert; }
        } else if (s.update) {
          const id = entityOf[s.update];
          const kv = cols(id, s.values);
          await db.query(`UPDATE ${T(id)} SET ${kv.map(([k], j) => `${k} = $${j + 1}`).join(', ')} WHERE id = $${kv.length + 1}`, [...kv.map(([, v]) => v), ids[s.update]]);
        } else if (s.delete) {
          await db.query(`DELETE FROM ${T(entityOf[s.delete])} WHERE id = $1`, [ids[s.delete]]);
        } else if (s.read) {
          const id = entityOf[s.read];
          const wanted = Object.keys(s.expect).map((k) => fieldBySource(id, k));
          const src = family.has(id) ? `${T(id)}_v` : T(id);
          const r = await db.query(`SELECT ${wanted.map((f) => `${f.name}::text AS "${f.source}"`).join(', ')} FROM ${src} WHERE id = $1`, [ids[s.read]]);
          const got = r.rows[0] ?? {};
          const bad = Object.entries(s.expect).filter(([k, v]) => !same(String(v), got[k]));
          if (bad.length) { outcome = 'mismatch'; detail = Object.fromEntries(bad.map(([k, v]) => [k, { expected: v, got: got[k] }])); }
        } else if (s.count) {
          const kv = cols(s.count, s.where);
          const r = await db.query(`SELECT count(*)::int AS n FROM ${T(s.count)} WHERE ${kv.map(([k], j) => `${k} = $${j + 1}`).join(' AND ')}`, kv.map(([, v]) => v));
          if (r.rows[0].n !== s.expect) { outcome = 'mismatch'; detail = { expected: s.expect, got: r.rows[0].n }; }
        }
        if (s.expectError) { outcome = 'mismatch'; detail = { expectedError: s.expectError, got: 'accepted' }; }
        await db.exec('RESET ROLE; RELEASE SAVEPOINT step;');
      } catch (err) {
        await db.exec('ROLLBACK TO SAVEPOINT step; RESET ROLE; RELEASE SAVEPOINT step;');
        const got = await classify(db, err);
        if (s.expectError === got) outcome = 'rejected-as-expected';
        else { outcome = 'mismatch'; detail = { expected: s.expectError ?? 'accepted', got }; }
      }
      log.push({ step: i + 1, action: Object.keys(s).find((k) => ['insert', 'update', 'delete', 'read', 'count'].includes(k)), role: s.role, outcome, detail });
    }
  } finally {
    await db.exec('ROLLBACK;');
  }
  return { id: c.id, origin: c.origin, status: log.every((l) => l.outcome !== 'mismatch') ? 'pass' : 'fail', steps: log };
}

// ---------------------------------------------------------------- main

async function main() {
  const db = await PGlite.create();
  await db.exec(`SET TIME ZONE 'UTC';`);
  for (const f of manifest.files) await db.exec(fs.readFileSync(path.join(TARGET, 'db', f), 'utf8'));
  const load_ = await load(db);
  const derived = await compareDerived(db);
  const today = new Date().toISOString().slice(0, 10);
  const caseResults = [];
  for (const c of cases) caseResults.push(await runCase(db, c, today));

  const derivedOk = derived.filter((d) => d.rows !== undefined).every((d) => d.matched === d.rows) && !derived.some((d) => d.note);
  const casesOk = caseResults.every((c) => c.status !== 'fail');
  const report = {
    blueprintHash: bp.contentHash, family: manifest.family, ranAt: new Date().toISOString(),
    load: load_, derived, cases: caseResults,
    summary: {
      derivedValues: `${derived.reduce((a, d) => a + (d.matched ?? 0), 0)}/${derived.reduce((a, d) => a + (d.rows ?? 0), 0)} rows matched across ${derived.filter((d) => d.rows !== undefined).length} derived fields`,
      cases: `${caseResults.filter((c) => c.status === 'pass').length} pass, ${caseResults.filter((c) => c.status === 'fail').length} fail, ${caseResults.filter((c) => c.status === 'pending').length} pending`,
      ok: derivedOk && casesOk,
    },
  };
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(__dirname, 'report.md'), markdown(report));

  console.log(`loaded: ${Object.entries(load_.loaded).map(([k, v]) => `${k}=${v}`).join(' ')}; roll-up rows recomputed: ${load_.recomputed}`);
  for (const d of derived) console.log(`  ${d.derivation.padEnd(42)} ${d.note ?? `${d.matched}/${d.rows}${d.asOf ? ` (as of ${d.asOf})` : ''}${d.mismatches.length ? ` e.g. ${JSON.stringify(d.mismatches[0])}` : ''}`}`);
  for (const c of caseResults) {
    console.log(`  ${c.status.toUpperCase().padEnd(8)} ${c.id}${c.reason ? ` - ${c.reason}` : ''}`);
    for (const s of (c.steps ?? []).filter((x) => x.outcome === 'mismatch')) console.log(`           step ${s.step} ${s.action}: ${JSON.stringify(s.detail)}`);
  }
  console.log(`${report.summary.ok ? 'PARITY OK' : 'PARITY FAILED'}: ${report.summary.derivedValues}; cases ${report.summary.cases}`);
  process.exit(report.summary.ok ? 0 : 1);
}

function markdown(r) {
  const L = [`# Parity report: ${r.family.join(', ')}`, '', `Blueprint ${r.blueprintHash.slice(0, 12)}, run ${r.ranAt}. **${r.summary.ok ? 'PARITY OK' : 'PARITY FAILED'}**`, '',
    `- Loaded from the org export: ${Object.entries(r.load.loaded).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `- Derived values: ${r.summary.derivedValues}`, `- Rule cases: ${r.summary.cases}`, '',
    '## Derived values (Salesforce stored value vs Postgres computed value)', '', '| Field | Strategy | Matched | Note |', '|---|---|---|---|'];
  for (const d of r.derived) L.push(`| ${d.derivation} | ${d.strategy ?? ''} | ${d.rows !== undefined ? `${d.matched}/${d.rows}` : ''} | ${d.note ?? (d.asOf ? `TODAY() pinned to ${d.asOf}` : '')} |`);
  L.push('', '## Rule cases', '', '| Case | Origin | Result |', '|---|---|---|');
  for (const c of r.cases) L.push(`| ${c.id} | ${c.origin} | ${c.status}${c.reason ? `: ${c.reason}` : ''} |`);
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error(e); process.exit(1); });
