// Local end-to-end check of CRM Genie before deploying: PGlite (Postgres 18) over a socket, the real loader,
// the real server, and the API calls the UI makes, including rule rejections and persona restrictions.
//   cd target && npm i @electric-sql/pglite-socket --no-save && node parity/app-smoke.mjs
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..', 'app');
const PGPORT = 54329;
const PORT = 8091;
// Expected sizes come from the org export, so the test follows the data as the org grows.
import fs from 'node:fs';
const csvRows = (name) => fs.readFileSync(path.resolve(here, '..', '..', 'output', 'data', `${name}.csv`), 'utf8')
  .split('\n').slice(1).filter((l) => /^[a-zA-Z0-9]{18},/.test(l)).length;
const SUBS = csvRows('Subscription__c');
const LINES = csvRows('Subscription_Line__c');
const DERIVED = SUBS * 4 + LINES * 2; // 4 derived fields on a subscription, 2 on a line

const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(PGPORT), PGUSER: 'postgres', PGDATABASE: 'postgres', PGSSLMODE: 'disable', PG_POOL_MAX: '1', PORT: String(PORT), SF_INSTANCE_URL: 'https://example.invalid' };

const run = (args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, args, { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '';
  p.stdout.on('data', (d) => { out += d; if (opts.echo) process.stdout.write(d); });
  p.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
  p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${args.join(' ')} exited ${code}`))));
});

const db = await PGlite.create();
let sock = new PGLiteSocketServer({ db, port: PGPORT, host: '127.0.0.1' });
await sock.start();
let server;
let failures = 0;
try {
  await run(['scripts/load.js'], { echo: true });
  server = spawn(process.execPath, ['server.js'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));

  const call = async (method, url, body, persona = 'admin') => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Persona': persona }, body: body ? JSON.stringify(body) : undefined });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data };
  };
  const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  · ${detail}` : ''}`);
  };

  const health = await call('GET', '/health');
  check('health', health.status === 200);
  const page = await fetch(`http://127.0.0.1:${PORT}/`);
  check('index.html served', page.status === 200 && (await page.text()).includes('CRM Genie'));
  const comp = await fetch(`http://127.0.0.1:${PORT}/compiler`);
  check('/compiler served', comp.status === 200);

  const meta = await call('GET', '/api/meta');
  check('meta (admin) all fields readable', Object.values(meta.data.subscription.fls).every((x) => x.read));
  const metaA = await call('GET', '/api/meta', null, 'analytics');
  check('meta (analytics) nothing editable', Object.values(metaA.data.subscription.fls).every((x) => !x.edit));
  const metaP = await call('GET', '/api/meta', null, 'subscription_management');
  check('meta (permset) MRR editable, Line Count read-only', metaP.data.subscription.fls.monthly_recurring_revenue.edit && !metaP.data.subscription.fls.line_count.edit && metaP.data.subscription.fls.line_count.read);

  const home = await call('GET', '/api/home');
  check('home KPIs', home.status === 200 && home.data.kpi.total === SUBS, `${SUBS} subscriptions · active MRR ${home.data.kpi.active_mrr}, active ${home.data.kpi.active}`);
  const list = await call('GET', '/api/subscriptions');
  check(`list ${SUBS} subscriptions`, list.data.rows.length === SUBS);
  const active = list.data.rows.find((r) => r.status === 'Active');
  const cancelled = list.data.rows.find((r) => r.status === 'Cancelled');
  const rec = await call('GET', `/api/subscriptions/${active.id}`);
  check('record with lines and names', rec.status === 200 && Array.isArray(rec.data.lines) && rec.data.record._names.account_id, `${rec.data.record.subscription_number} · ${rec.data.lines.length} lines`);

  // TODAY() in the org user's time zone, as Salesforce evaluates it.
  const laToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const expectDays = Math.round((Date.parse(rec.data.record.end_date) - Date.parse(laToday)) / 864e5);
  check('Days To Renewal uses the org time zone', meta.data.timeZone === 'America/Los_Angeles' && Number(rec.data.record.days_to_renewal) === expectDays, `${rec.data.record.days_to_renewal} (LA today ${laToday})`);

  // Traversal used by the record pages: line record, reference records and their related lists.
  const line = rec.data.lines[0];
  if (line) {
    const lr = await call('GET', `/api/lines/${line.id}`);
    check('line record with parent name', lr.status === 200 && lr.data.record._names.subscription_id === rec.data.record.subscription_number, `${lr.data.record?.line_number} → ${lr.data.record?._names?.subscription_id}`);
    if (line.product_id) {
      const pl = await call('GET', `/api/lines?product=${line.product_id}`);
      check('product related lines', pl.status === 200 && pl.data.rows.some((x) => x.id === line.id), `${pl.data.rows?.length} lines`);
    }
  }
  const withContact = list.data.rows.find((x) => x.primary_contact_id);
  if (withContact) {
    const c = await call('GET', `/api/ref/contact/${withContact.primary_contact_id}`);
    const cs = await call('GET', `/api/subscriptions?contact=${withContact.primary_contact_id}`);
    check('contact page and related subscriptions', c.status === 200 && c.data.record.name && cs.data.rows.some((x) => x.id === withContact.id), c.data.record?.name);
  }
  const withOpp = list.data.rows.find((x) => x.source_opportunity_id);
  if (withOpp) {
    const os = await call('GET', `/api/subscriptions?opportunity=${withOpp.source_opportunity_id}`);
    check('opportunity related subscriptions', os.status === 200 && os.data.rows.every((x) => x.source_opportunity_id === withOpp.source_opportunity_id) && os.data.rows.length > 0);
  }
  check('unknown reference kind → 404', (await call('GET', '/api/ref/user/005000000000000AAA')).status === 404);

  let r = await call('PATCH', `/api/subscriptions/${active.id}`, { status: 'Cancelled', cancellation_reason: '' });
  check('cancel without reason rejected (CHECK)', r.status === 400 && r.data.error.rule === 'Subscription__c.Cancellation_Reason_Required', r.data.error?.message);
  r = await call('PATCH', `/api/subscriptions/${cancelled.id}`, { status: 'Active' });
  check('reactivation rejected (guard)', r.status === 400 && r.data.error.rule === 'Subscription__c.No_Reactivation_After_Cancel', r.data.error?.message);
  r = await call('POST', `/api/subscriptions/${cancelled.id}/lines`, { quantity: 1, unit_price: 10 });
  check('line on cancelled subscription rejected (guard)', r.status === 400 && r.data.error.rule === 'Subscription_Line__c.Parent_Not_Cancelled', r.data.error?.message);
  r = await call('PATCH', `/api/subscriptions/${active.id}`, { monthly_recurring_revenue: 0 });
  check('active with zero MRR rejected (CHECK)', r.status === 400 && r.data.error.rule === 'Subscription__c.Active_Requires_MRR');
  r = await call('PATCH', `/api/subscriptions/${active.id}`, { status: 'Expired' });
  check('restricted picklist rejected', r.status === 400 && r.data.error.kind === 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', r.data.error?.message);

  const before = Number((await call('GET', `/api/subscriptions/${active.id}`)).data.record.total_line_value);
  r = await call('POST', `/api/subscriptions/${active.id}/lines`, { quantity: 2, unit_price: 50 }, 'subscription_management');
  const after = (await call('GET', `/api/subscriptions/${active.id}`)).data.record;
  check('permset adds line, roll-up updates', r.status === 201 && Number(after.total_line_value) === before + 100, `${before} → ${after.total_line_value}`);
  r = await call('PATCH', `/api/subscriptions/${active.id}`, { monthly_recurring_revenue: 999 }, 'subscription_management');
  const v = (await call('GET', `/api/subscriptions/${active.id}`)).data.record;
  check('permset edits MRR, annual value recomputes', r.status === 200 && Number(v.annual_value) === 11988);
  r = await call('PATCH', `/api/subscriptions/${active.id}`, { health_score: 10 }, 'analytics');
  check('read-only profile edit denied (42501)', r.status === 403 && r.data.error.kind === 'INSUFFICIENT_ACCESS', r.data.error?.message);

  const created = await call('POST', '/api/subscriptions', { account_id: rec.data.record.account_id, start_date: '2026-10-01', term_months: 12 });
  const nr = (await call('GET', `/api/subscriptions/${created.data.id}`)).data.record;
  check('create: auto-number, Apex defaults (end date, health 70)', created.status === 201 && /^SUB-\d{4}$/.test(nr.subscription_number) && nr.end_date === '2027-10-01' && Number(nr.health_score) === 70, `${nr.subscription_number} end ${nr.end_date}`);
  r = await call('DELETE', `/api/subscriptions/${created.data.id}`);
  check('delete', r.status === 204);

  const par = await call('GET', '/api/parity');
  const tot = par.data.fields.reduce((a, f) => a + f.total, 0);
  const m = par.data.fields.reduce((a, f) => a + f.matched, 0);
  // Two values changed above (MRR edit → annual value; added line → line count and total), so allow for them.
  // The edits above change up to 3 derived values (annual value, line count, total line value).
  check('parity endpoint', par.status === 200 && tot === DERIVED && m >= DERIVED - 4, `${m}/${tot} after test edits · export day ${par.data.asOf}`);

  // Production mode: sign-in required everywhere except /health and the login page.
  // PGlite's socket server serves one connection; restart it so the new server process can connect.
  await new Promise((r) => { server.once('exit', r); server.kill(); });
  await sock.stop();
  sock = new PGLiteSocketServer({ db, port: PGPORT, host: '127.0.0.1' });
  await sock.start();
  const { createRequire } = await import('node:module');
  const { hashPassword } = createRequire(import.meta.url)(path.join(appDir, 'auth.js'));
  const users = JSON.stringify({ tester: { name: 'Smoke Tester', hash: hashPassword('correct-horse-battery') } });
  server = spawn(process.execPath, ['server.js'], { cwd: appDir, env: { ...env, NODE_ENV: 'production', CRMGENIE_USERS: users, SESSION_SECRET: 'x'.repeat(40) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
  const base = `http://127.0.0.1:${PORT}`;
  const hr = await fetch(`${base}/health`);
  check('auth: /health stays public', hr.status === 200, `status ${hr.status}`);
  check('auth: API without session → 401', (await fetch(`${base}/api/home`)).status === 401);
  check('auth: page without session → login', (await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location')?.startsWith('/login'));
  const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'wrong-password-123' }) });
  check('auth: wrong password → 401', bad.status === 401);
  const good = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'correct-horse-battery' }) });
  const cookie = good.headers.get('set-cookie')?.split(';')[0];
  check('auth: right password → HttpOnly session cookie', good.status === 200 && /HttpOnly/.test(good.headers.get('set-cookie') || ''));
  const me = await fetch(`${base}/api/meta`, { headers: { cookie } }).then((r) => r.json());
  check('auth: session reaches the API', me.user?.name === 'Smoke Tester');
  check('auth: tampered cookie rejected', (await fetch(`${base}/api/home`, { headers: { cookie: cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } })).status === 401);
} finally {
  server?.kill();
  await sock.stop();
  await db.close();
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
