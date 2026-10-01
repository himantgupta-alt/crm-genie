// CRM Genie API + web host. Data lives in the Postgres schema compiled from the Salesforce org (target/db).
// Every request runs in a transaction under the selected persona's role (SET LOCAL ROLE), so field-level
// security, sharing and validation rules are enforced by the database, not by this code.
const path = require('path');
const express = require('express');
const { Pool, types } = require('pg');
const { SUBSCRIPTION, LINE, PERSONAS, isWritable } = require('./fields');

types.setTypeParser(1082, (v) => v); // date stays 'YYYY-MM-DD'; a JS Date would shift it by the server's time zone

const pool = new Pool({
  max: Number(process.env.PG_POOL_MAX || 5),
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: process.env.PGSSL_INSECURE !== '1' },
});
const SF_URL = process.env.SF_INSTANCE_URL || '';
const pub = path.join(__dirname, 'public');
const app = express();
app.set('trust proxy', 1); // App Service front end; req.ip is the client for sign-in rate limiting
app.use(express.json({ limit: '100kb' }));
app.disable('x-powered-by');
require('./auth').install(app, pub);

// ---------------------------------------------------------------- identity and persona

function userOf(req) {
  return { name: req.session?.n || 'unknown', id: req.session?.u || null };
}
function personaOf(req) {
  const key = req.get('x-persona') || 'admin';
  if (!PERSONAS[key]) throw httpError(400, `Unknown persona ${key}`);
  return { key, ...PERSONAS[key] };
}
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

async function tx(role, fn) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    if (role) await client.query(`SET LOCAL ROLE ${client.escapeIdentifier(role)}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { broken = true; });
    throw e;
  } finally {
    client.release(broken);
  }
}
const owner = (sql, params) => pool.query(sql, params);

// Column privileges per role, read from Postgres itself (what the Security Compiler granted).
const privCache = new Map();
async function privileges(role, relation) {
  const key = `${role}|${relation}`;
  if (privCache.has(key)) return privCache.get(key);
  const [schema, name] = relation.split('.');
  const r = await owner(
    `SELECT column_name,
            ${role ? 'has_column_privilege($3, $1 || \'.\' || $2, column_name, \'SELECT\')' : 'true'} AS r,
            ${role ? 'has_column_privilege($3, $1 || \'.\' || $2, column_name, \'UPDATE\')' : 'true'} AS u,
            ${role ? 'has_column_privilege($3, $1 || \'.\' || $2, column_name, \'INSERT\')' : 'true'} AS i
       FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    role ? [schema, name, role] : [schema, name],
  );
  const map = Object.fromEntries(r.rows.map((x) => [x.column_name, x]));
  privCache.set(key, map);
  return map;
}
async function access(persona, obj) {
  const [read, write] = await Promise.all([privileges(persona.role, obj.view), privileges(persona.role, obj.table)]);
  const fls = {};
  for (const f of obj.fields) {
    fls[f.col] = {
      read: !!read[f.col]?.r,
      edit: isWritable(f) && !!write[f.col]?.u && !f.createOnly,
      create: isWritable(f) && !!write[f.col]?.i,
    };
  }
  return fls;
}

// ---------------------------------------------------------------- errors in Salesforce terms

const fieldLabel = (col) => [...SUBSCRIPTION.fields, ...LINE.fields].find((f) => f.col === col)?.label ?? col;
// Validation-rule messages emitted with the schema (app.rule_message); read once.
let RULES = null;
async function rules() {
  if (!RULES) RULES = (await owner('SELECT constraint_name, rule_id, message, error_field FROM app.rule_message')).rows;
  return RULES;
}
async function sfError(e) {
  if (e.status) return e;
  const base = { code: e.code };
  if (e.code === '23514') {
    if (/_picklist$/.test(e.constraint || '')) {
      return httpError(400, `${fieldLabel(e.constraint.replace(/_picklist$/, ''))}: bad value for restricted picklist field`, { ...base, kind: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', field: e.constraint.replace(/_picklist$/, '') });
    }
    const m = (await rules()).find((x) => x.constraint_name === e.constraint);
    if (m) return httpError(400, m.message, { ...base, kind: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', rule: m.rule_id, field: m.error_field });
  }
  if (e.code === 'P0001') {
    const m = (await rules()).find((x) => x.rule_id === e.hint);
    return httpError(400, e.message, { ...base, kind: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', rule: e.hint, field: m?.error_field });
  }
  if (e.code === '42501') return httpError(403, 'You do not have the level of access necessary to perform the operation you requested.', { ...base, kind: 'INSUFFICIENT_ACCESS' });
  if (e.code === '23502') return httpError(400, `Required fields are missing: [${fieldLabel(e.column)}]`, { ...base, kind: 'REQUIRED_FIELD_MISSING', field: e.column });
  if (e.code === '23503') return httpError(400, 'Invalid cross reference id', { ...base, kind: 'INVALID_CROSS_REFERENCE_KEY' });
  if (['22P02', '22007', '22008', '22003'].includes(e.code)) return httpError(400, `Invalid value: ${e.message}`, { ...base, kind: 'INVALID_FIELD' });
  console.error(e);
  return httpError(500, 'Unexpected error', base);
}
const route = (fn) => (req, res, next) => fn(req, res).catch(async (e) => next(await sfError(e)));

// ---------------------------------------------------------------- helpers

function values(obj, body, mode) {
  const out = {};
  for (const [col, v] of Object.entries(body || {})) {
    const f = obj.fields.find((x) => x.col === col);
    if (!f || !isWritable(f) || (mode === 'update' && f.createOnly)) throw httpError(400, `Field ${col} is not writable`);
    out[col] = v === '' || v === undefined ? null : f.type === 'checkbox' ? !!v : v;
  }
  return out;
}
const selectList = (obj, fls) => ['id', ...obj.fields.filter((f) => fls[f.col].read).map((f) => f.col)].join(', ');
async function names(kind, ids) {
  const table = { account: 'app.account', contact: 'app.contact', opportunity: 'app.opportunity', product2: 'app.product2' }[kind];
  const list = [...new Set(ids.filter(Boolean))];
  if (!table || !list.length) return {};
  const r = await owner(`SELECT id, name FROM ${table} WHERE id = ANY($1)`, [list]);
  return Object.fromEntries(r.rows.map((x) => [x.id, x.name]));
}
async function decorate(obj, rows) {
  const lookups = obj.fields.filter((f) => f.type === 'lookup' && f.ref !== 'subscription');
  const maps = Object.fromEntries(await Promise.all(lookups.map(async (f) => [f.col, await names(f.ref, rows.map((r) => r[f.col]))])));
  return rows.map((r) => ({ ...r, _names: Object.fromEntries(lookups.map((f) => [f.col, maps[f.col][r[f.col]] ?? null])) }));
}

// ---------------------------------------------------------------- API

app.get('/health', async (_req, res) => { // public: used by App Service and the pipeline
  try { await owner('SELECT 1'); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); }
});

app.get('/api/meta', route(async (req, res) => {
  const persona = personaOf(req);
  res.json({
    user: userOf(req), persona: persona.key, personas: PERSONAS, sfInstanceUrl: SF_URL,
    subscription: { ...SUBSCRIPTION, fls: await access(persona, SUBSCRIPTION) },
    line: { ...LINE, fls: await access(persona, LINE) },
  });
}));

app.get('/api/lookups', route(async (_req, res) => {
  const q = (t) => owner(`SELECT id, name FROM ${t} ORDER BY name`).then((r) => r.rows);
  const [account, contact, opportunity, product2] = await Promise.all(['app.account', 'app.contact', 'app.opportunity', 'app.product2'].map(q));
  res.json({ account, contact, opportunity, product2 });
}));

app.get('/api/home', route(async (_req, res) => {
  const k = (await owner(`SELECT
      count(*) FILTER (WHERE status = 'Active')::int AS active,
      COALESCE(sum(monthly_recurring_revenue) FILTER (WHERE status = 'Active'), 0) AS active_mrr,
      COALESCE(sum(annual_value) FILTER (WHERE status = 'Active'), 0) AS active_arr,
      count(*) FILTER (WHERE status = 'Active' AND days_to_renewal BETWEEN 0 AND 30)::int AS renewals_30,
      count(*) FILTER (WHERE status = 'Active' AND health_score < 50)::int AS at_risk,
      count(*)::int AS total
    FROM app.subscription_v`)).rows[0];
  const byStatus = (await owner('SELECT status, count(*)::int AS n, COALESCE(sum(monthly_recurring_revenue), 0) AS mrr FROM app.subscription GROUP BY status ORDER BY status')).rows;
  const recent = (await owner(`SELECT s.id, s.subscription_number, s.status, s.monthly_recurring_revenue, s.last_modified_date, a.name AS account
    FROM app.subscription s JOIN app.account a ON a.id = s.account_id ORDER BY s.last_modified_date DESC, s.subscription_number DESC LIMIT 8`)).rows;
  const renewals = (await owner(`SELECT s.id, s.subscription_number, s.end_date, s.days_to_renewal, s.auto_renew, a.name AS account
    FROM app.subscription_v s JOIN app.account a ON a.id = s.account_id
    WHERE s.status = 'Active' AND s.days_to_renewal >= 0 ORDER BY s.days_to_renewal LIMIT 6`)).rows;
  res.json({ kpi: k, byStatus, recent, renewals });
}));

app.get('/api/subscriptions', route(async (req, res) => {
  const persona = personaOf(req);
  const fls = await access(persona, SUBSCRIPTION);
  const where = [];
  const params = [];
  if (req.query.status) { params.push(req.query.status); where.push(`status = $${params.length}`); }
  if (req.query.account) { params.push(req.query.account); where.push(`account_id = $${params.length}`); }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(subscription_number ILIKE $${params.length} OR account_id IN (SELECT id FROM app.account WHERE name ILIKE $${params.length}))`);
  }
  const rows = await tx(persona.role, async (c) => (await c.query(
    `SELECT ${selectList(SUBSCRIPTION, fls)} FROM ${SUBSCRIPTION.view} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY subscription_number`, params)).rows);
  res.json({ rows: await decorate(SUBSCRIPTION, rows), fls });
}));

app.get('/api/subscriptions/:id', route(async (req, res) => {
  const persona = personaOf(req);
  const fls = await access(persona, SUBSCRIPTION);
  const lfls = await access(persona, LINE);
  const out = await tx(persona.role, async (c) => {
    const s = (await c.query(`SELECT ${selectList(SUBSCRIPTION, fls)} FROM ${SUBSCRIPTION.view} WHERE id = $1`, [req.params.id])).rows[0];
    if (!s) throw httpError(404, 'Record not found');
    const lines = (await c.query(`SELECT ${selectList(LINE, lfls)} FROM ${LINE.view} WHERE subscription_id = $1 ORDER BY line_number`, [req.params.id])).rows;
    return { s, lines };
  });
  const [record] = await decorate(SUBSCRIPTION, [out.s]);
  res.json({ record, lines: await decorate(LINE, out.lines), fls, lineFls: lfls });
}));

app.post('/api/subscriptions', route(async (req, res) => {
  const persona = personaOf(req);
  const v = values(SUBSCRIPTION, req.body, 'create');
  const cols = Object.keys(v);
  const id = await tx(persona.role, async (c) => (await c.query(
    `INSERT INTO ${SUBSCRIPTION.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(v))).rows[0].id);
  res.status(201).json({ id });
}));

app.patch('/api/subscriptions/:id', route(async (req, res) => {
  const persona = personaOf(req);
  const v = values(SUBSCRIPTION, req.body, 'update');
  const cols = Object.keys(v);
  if (!cols.length) return res.json({ id: req.params.id });
  await tx(persona.role, async (c) => {
    const r = await c.query(`UPDATE ${SUBSCRIPTION.table} SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`, [...Object.values(v), req.params.id]);
    if (!r.rowCount) throw httpError(404, 'Record not found or not accessible');
  });
  res.json({ id: req.params.id });
}));

app.delete('/api/subscriptions/:id', route(async (req, res) => {
  const persona = personaOf(req);
  await tx(persona.role, async (c) => {
    const r = await c.query(`DELETE FROM ${SUBSCRIPTION.table} WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) throw httpError(404, 'Record not found or not accessible');
  });
  res.status(204).end();
}));

app.post('/api/subscriptions/:id/lines', route(async (req, res) => {
  const persona = personaOf(req);
  const v = values(LINE, { ...req.body, subscription_id: req.params.id }, 'create');
  const cols = Object.keys(v);
  const id = await tx(persona.role, async (c) => (await c.query(
    `INSERT INTO ${LINE.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(v))).rows[0].id);
  res.status(201).json({ id });
}));

app.patch('/api/lines/:id', route(async (req, res) => {
  const persona = personaOf(req);
  const v = values(LINE, req.body, 'update');
  const cols = Object.keys(v);
  await tx(persona.role, async (c) => {
    const r = await c.query(`UPDATE ${LINE.table} SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`, [...Object.values(v), req.params.id]);
    if (!r.rowCount) throw httpError(404, 'Record not found or not accessible');
  });
  res.json({ id: req.params.id });
}));

app.delete('/api/lines/:id', route(async (req, res) => {
  const persona = personaOf(req);
  await tx(persona.role, async (c) => {
    const r = await c.query(`DELETE FROM ${LINE.table} WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) throw httpError(404, 'Record not found or not accessible');
  });
  res.status(204).end();
}));

app.get('/api/accounts', route(async (_req, res) => {
  // totalActiveMrr mirrors SubscriptionService.totalActiveMrr in the org.
  const rows = (await owner(`SELECT a.id, a.name,
      count(s.id)::int AS subscriptions,
      count(s.id) FILTER (WHERE s.status = 'Active')::int AS active,
      COALESCE(sum(s.monthly_recurring_revenue) FILTER (WHERE s.status = 'Active'), 0) AS total_active_mrr
    FROM app.account a LEFT JOIN app.subscription s ON s.account_id = a.id
    GROUP BY a.id, a.name ORDER BY a.name`)).rows;
  res.json({ rows });
}));

app.get('/api/accounts/:id', route(async (req, res) => {
  const a = (await owner('SELECT id, name FROM app.account WHERE id = $1', [req.params.id])).rows[0];
  if (!a) throw httpError(404, 'Record not found');
  res.json({ record: a });
}));

app.get('/api/rules', route(async (_req, res) => {
  res.json({ rows: (await owner('SELECT constraint_name, rule_id, message, error_field FROM app.rule_message ORDER BY rule_id')).rows });
}));

// Live parity: values Salesforce stored at export vs values this database computes now.
app.get('/api/parity', route(async (_req, res) => {
  const run = (await owner('SELECT * FROM migration.run ORDER BY loaded_at DESC LIMIT 1').catch(() => ({ rows: [] }))).rows[0] ?? null;
  const fields = [
    { sobject: 'Subscription__c', api: 'Line_Count__c', view: 'app.subscription_v', col: 'line_count', strategy: 'Roll-up · trigger-maintained' },
    { sobject: 'Subscription__c', api: 'Annual_Value__c', view: 'app.subscription_v', col: 'annual_value', strategy: 'Formula · generated column' },
    { sobject: 'Subscription__c', api: 'Days_To_Renewal__c', view: 'app.subscription_v', col: 'days_to_renewal', strategy: 'Formula · computed on read' },
    { sobject: 'Subscription__c', api: 'Total_Line_Value__c', view: 'app.subscription_v', col: 'total_line_value', strategy: 'Roll-up · trigger-maintained' },
    { sobject: 'Subscription_Line__c', api: 'Account_Name__c', view: 'app.subscription_line_v', col: 'account_name', strategy: 'Cross-object formula · view' },
    { sobject: 'Subscription_Line__c', api: 'Line_Total__c', view: 'app.subscription_line_v', col: 'line_total', strategy: 'Formula · generated column' },
  ];
  const asOf = run?.export_day ?? null;
  const out = await tx(null, async (c) => {
    if (asOf) await c.query(`SELECT set_config('app.as_of_date', $1, true)`, [asOf]);
    const results = [];
    for (const f of fields) {
      const r = (await c.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE e.sf_value IS NOT DISTINCT FROM v.${f.col}::text
                                  OR (e.sf_value ~ '^-?[0-9.]+$' AND v.${f.col}::text ~ '^-?[0-9.]+$' AND e.sf_value::numeric = v.${f.col}::numeric))::int AS matched
           FROM migration.sf_expected e JOIN ${f.view} v ON v.id = e.record_id
          WHERE e.sobject = $1 AND e.field = $2`, [f.sobject, f.api])).rows[0];
      results.push({ ...f, ...r });
    }
    return results;
  });
  res.json({ run, asOf, fields: out });
}));

app.use('/api', (_req, _res, next) => next(httpError(404, 'Not found')));
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: { message: err.message, kind: err.kind, field: err.field, rule: err.rule, code: err.code } });
});

// ---------------------------------------------------------------- web

app.use((req, res, next) => {
  if (/\.(html|js|css)$/.test(req.path) || req.path === '/') res.set('Cache-Control', 'no-cache');
  next();
});
app.get('/compiler', (_req, res) => res.sendFile(path.join(pub, 'compiler.html')));
app.use(express.static(pub));
app.get('*', (_req, res) => res.sendFile(path.join(pub, 'index.html')));

pool.on('error', (e) => console.error('idle client error', e.message)); // a dropped connection must not crash the app

const port = Number(process.env.PORT || 8080);
app.listen(port, async () => {
  console.log(`CRM Genie listening on ${port}`);
  await rules().catch((e) => console.error('rule messages not loaded yet:', e.message));
});
