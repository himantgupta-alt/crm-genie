// Org connections for the Assessment agent, and real discovery runs from the Org Compiler.
//
//   - Each regional org is connected with "Connect with Salesforce" (OAuth web server flow with PKCE, connected app
//     "Org Compiler"; no password ever reaches this server). Only the refresh token is kept, encrypted with
//     CONNECTION_KEY (AES-256-GCM), in ops.org_connection. Disconnect revokes it at Salesforce.
//   - "Run discovery" runs the real, read-only agents (assess-org, discover-org, then emit-assessment and
//     emit-discovery) against the connected orgs. Outputs go to RUNTIME_DATA_DIR and are served to the console by
//     /api/assessment-data, replacing the sample built into the page.
//
//   ORGC_OAUTH_CLIENT_ID  consumer key of the connected app (without it, Connect is disabled)
//   CONNECTION_KEY        32+ random characters (without it, nothing can be stored)
//   PUBLIC_URL            site address for the OAuth callback (default: from the request)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { KEY, enc, dec, mask } = require('./connections-crypto');

const CLIENT_ID = process.env.ORGC_OAUTH_CLIENT_ID || '';
const DATA = process.env.RUNTIME_DATA_DIR || path.join(process.env.HOME || os.tmpdir(), 'orgcompiler-data');
// Agents ship inside the app package (runtime/) on the server; locally they are the repository's own.
const RUNTIME = fs.existsSync(path.join(__dirname, 'runtime', 'src', 'generators')) ? path.join(__dirname, 'runtime', 'src') : path.join(__dirname, '..');
const GEN = path.join(RUNTIME, 'generators');
const DEFAULT_ORGS = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'agents', 'assessment', 'engagement.json'), 'utf8'));
const LOGIN_HOST = /^https:\/\/([a-z0-9-]+\.)*(salesforce\.com|force\.com|salesforce\.mil|cloudforce\.com)$/i;

const maskId = (id) => (id ? `${id.slice(0, 3)}…${id.slice(-3)}` : null);
const b64url = (b) => Buffer.from(b).toString('base64url');

let job = null; // one discovery run at a time: { id, startedAt, finishedAt, status, log[], regions[] }

function install(app, owner) {
  const ready = owner(`CREATE SCHEMA IF NOT EXISTS ops;
    CREATE TABLE IF NOT EXISTS ops.org_connection (
      region text PRIMARY KEY, label text NOT NULL, login_url text NOT NULL, position int NOT NULL DEFAULT 0,
      client_id text, instance_url text, org_id text, username text, token_enc text,
      connected_at timestamptz, connected_by text, last_run jsonb)`)
    .then(async () => {
      for (const [i, o] of DEFAULT_ORGS.orgs.entries()) {
        await owner('INSERT INTO ops.org_connection (region, label, login_url, position) VALUES ($1, $2, $3, $4) ON CONFLICT (region) DO NOTHING', [o.region, o.label, 'https://login.salesforce.com', i]);
      }
    }).catch((e) => console.error('connections table', e.message));
  const rows = async () => { await ready; return (await owner('SELECT * FROM ops.org_connection ORDER BY position, region')).rows; };
  const one = async (region) => { await ready; return (await owner('SELECT * FROM ops.org_connection WHERE region = $1', [region])).rows[0]; };
  const view = (r) => ({ region: r.region, label: r.label, loginUrl: r.login_url, connected: !!r.token_enc, username: mask(r.username), orgId: maskId(r.org_id),
    instanceHost: r.instance_url ? new URL(r.instance_url).host.replace(/^[^.]+/, (s) => `${s.slice(0, 3)}…`) : null, connectedAt: r.connected_at, connectedBy: r.connected_by,
    method: r.client_id === 'PlatformCLI' ? 'Salesforce CLI login (seeded)' : r.client_id ? 'Connect with Salesforce' : null, lastRun: r.last_run });
  const err = (res, status, message) => res.status(status).json({ error: { message } });
  const base = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  app.get('/api/connections', async (_req, res) => {
    try {
      res.json({ orgs: (await rows()).map(view), oauthReady: !!(CLIENT_ID && KEY), storageReady: !!KEY, runner: 'server', job: job && { ...job, log: job.log.slice(-60) } });
    } catch (e) { err(res, 500, e.message); }
  });

  app.put('/api/connections/:region', async (req, res) => {
    const { label, loginUrl } = req.body || {};
    if (loginUrl && !LOGIN_HOST.test(String(loginUrl).replace(/\/$/, ''))) return err(res, 400, 'Login URL must be a Salesforce address, for example https://login.salesforce.com or https://yourdomain.my.salesforce.com');
    const r = await one(req.params.region);
    if (!r) return err(res, 404, 'Unknown org');
    const changedLogin = loginUrl && loginUrl.replace(/\/$/, '') !== r.login_url;
    // A different login address means a different org: the old token no longer applies.
    await owner(`UPDATE ops.org_connection SET label = COALESCE($2, label), login_url = COALESCE($3, login_url)${changedLogin ? ', token_enc = NULL, username = NULL, org_id = NULL, instance_url = NULL, client_id = NULL, connected_at = NULL' : ''} WHERE region = $1`,
      [r.region, label ? String(label).slice(0, 60) : null, loginUrl ? loginUrl.replace(/\/$/, '') : null]);
    res.json(view(await one(r.region)));
  });

  app.post('/api/connections', async (req, res) => {
    const { label, loginUrl } = req.body || {};
    if (!label) return err(res, 400, 'Name the org');
    if (loginUrl && !LOGIN_HOST.test(String(loginUrl).replace(/\/$/, ''))) return err(res, 400, 'Login URL must be a Salesforce address');
    const region = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || `org-${Date.now()}`;
    await ready;
    await owner('INSERT INTO ops.org_connection (region, label, login_url, position) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1 FROM ops.org_connection)) ON CONFLICT (region) DO NOTHING', [region, String(label).slice(0, 60), (loginUrl || 'https://login.salesforce.com').replace(/\/$/, '')]);
    res.json(view(await one(region)));
  });

  // OAuth web server flow with PKCE. The verifier travels in a short-lived HttpOnly cookie.
  app.get('/oauth/start', async (req, res) => {
    if (!CLIENT_ID || !KEY) return res.status(503).send('Connecting orgs is not configured on this server.');
    const r = await one(String(req.query.region || ''));
    if (!r) return res.status(404).send('Unknown org');
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(16));
    res.set('Set-Cookie', `oc_pkce=${b64url(JSON.stringify({ verifier, state, region: r.region }))}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=600${req.secure ? '; Secure' : ''}`);
    const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: `${base(req)}/oauth/callback`, scope: 'api refresh_token openid', state, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'login consent' });
    res.redirect(`${r.login_url}/services/oauth2/authorize?${q}`);
  });

  app.get('/oauth/callback', async (req, res) => {
    const back = (msg) => res.redirect(`/compiler#connections${msg ? `:${encodeURIComponent(msg)}` : ''}`);
    try {
      const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('oc_pkce='));
      if (!raw) return back('The sign-in took too long; try Connect again.');
      const p = JSON.parse(Buffer.from(raw.slice(8), 'base64url').toString('utf8'));
      res.append('Set-Cookie', 'oc_pkce=; Path=/oauth; Max-Age=0');
      if (req.query.error) return back(`Salesforce said: ${req.query.error_description || req.query.error}`);
      if (req.query.state !== p.state) return back('The sign-in could not be verified; try again.');
      const r = await one(p.region);
      const tok = await fetch(`${r.login_url}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), client_id: CLIENT_ID, redirect_uri: `${base(req)}/oauth/callback`, code_verifier: p.verifier }) }).then((x) => x.json());
      if (!tok.refresh_token) return back(`No refresh token returned (${tok.error_description || tok.error || 'check the connected app policy'})`);
      const id = await fetch(tok.id, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((x) => x.json());
      await owner(`UPDATE ops.org_connection SET client_id = $2, instance_url = $3, org_id = $4, username = $5, token_enc = $6, connected_at = now(), connected_by = $7 WHERE region = $1`,
        [r.region, CLIENT_ID, tok.instance_url, id.organization_id, id.username, enc(tok.refresh_token), req.session?.n || null]);
      back();
    } catch (e) { back(`Connection failed: ${e.message}`); }
  });

  async function accessFor(r) {
    const refresh = dec(r.token_enc);
    const t = await fetch(`${r.instance_url || r.login_url}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: r.client_id }) }).then((x) => x.json());
    if (!t.access_token) throw new Error(t.error_description || t.error || 'token refresh failed');
    return { refresh, access: t.access_token, instance: t.instance_url || r.instance_url };
  }

  app.post('/api/connections/:region/test', async (req, res) => {
    const r = await one(req.params.region);
    if (!r?.token_enc) return err(res, 400, 'Not connected');
    try {
      const a = await accessFor(r);
      const lim = await fetch(`${a.instance}/services/data/v67.0/limits`, { headers: { Authorization: `Bearer ${a.access}` } }).then((x) => x.json());
      res.json({ ok: true, apiRemaining: lim.DailyApiRequests?.Remaining ?? null, apiMax: lim.DailyApiRequests?.Max ?? null });
    } catch (e) { err(res, 502, e.message); }
  });

  app.delete('/api/connections/:region/token', async (req, res) => {
    const r = await one(req.params.region);
    if (!r) return err(res, 404, 'Unknown org');
    if (r.token_enc) { try { await fetch(`${r.instance_url || r.login_url}/services/oauth2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: dec(r.token_enc) }) }); } catch { /* revoke is best effort; the token is deleted here anyway */ } }
    await owner('UPDATE ops.org_connection SET token_enc = NULL, username = NULL, org_id = NULL, instance_url = NULL, client_id = NULL, connected_at = NULL WHERE region = $1', [r.region]);
    res.json(view(await one(r.region)));
  });

  // ---------------------------------------------------------------- discovery runs

  const run = (script, args, env, log) => new Promise((resolve) => {
    // NODE_PATH: the agents load the app's own Salesforce client (jsforce), wherever they are installed.
    const p = spawn(process.execPath, [path.join(GEN, script), ...args], { cwd: RUNTIME, env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules'), ...env } });
    const out = (d) => String(d).split('\n').filter(Boolean).forEach((l) => log(l.replace(/(token|secret)=\S+/gi, '$1=…')));
    p.stdout.on('data', out); p.stderr.on('data', out);
    p.on('close', (code) => resolve(code));
  });

  app.post('/api/discovery/run', async (req, res) => {
    if (job && !job.finishedAt) return err(res, 409, 'A discovery run is already in progress');
    const all = (await rows()).filter((r) => r.token_enc);
    const wanted = Array.isArray(req.body?.regions) && req.body.regions.length ? all.filter((r) => req.body.regions.includes(r.region)) : all;
    if (!wanted.length) return err(res, 400, 'Connect at least one org first');
    job = { id: `DISC-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', regions: wanted.map((r) => r.region), log: [], by: req.session?.n || null };
    res.json(job);
    const j = job;
    const log = (l) => { j.log.push(`${new Date().toISOString().slice(11, 19)}  ${l}`); if (j.log.length > 400) j.log.shift(); };
    const adlc = path.join(DATA, 'adlc');
    fs.mkdirSync(adlc, { recursive: true });
    // The engagement for this run: the connected orgs, under the names given on the Connections page.
    const engagementFile = path.join(DATA, 'engagement.json');
    const everyOrg = await rows();
    fs.writeFileSync(engagementFile, JSON.stringify({ ...DEFAULT_ORGS, sampleData: DEFAULT_ORGS.sampleData && everyOrg.some((r) => r.region === 'eu' && r.token_enc), orgs: everyOrg.map((r) => ({ region: r.region, label: r.label, alias: r.region })) }, null, 2));
    const base_ = { ADLC_DIR: adlc, ENGAGEMENT_FILE: engagementFile, BUNDLE_DIR: DATA };
    let failed = false;
    for (const r of wanted) {
      let a;
      try { a = await accessFor(r); } catch (e) { log(`${r.label}: cannot sign in (${e.message})`); failed = true; await owner('UPDATE ops.org_connection SET last_run = $2 WHERE region = $1', [r.region, { id: j.id, status: 'failed', at: new Date().toISOString(), message: e.message }]); continue; }
      const env = { ...base_, SF_REFRESH_TOKEN: a.refresh, SF_INSTANCE_URL: a.instance, SF_CLIENT_ID: r.client_id, SF_LOGIN_URL: r.login_url };
      log(`${r.label}: as-is extraction (read-only)`);
      const c1 = await run('assess-org.js', [r.region, r.label], env, log);
      log(`${r.label}: full discovery (read-only)`);
      const c2 = c1 === 0 ? await run('discover-org.js', [r.region, r.label], env, log) : 1;
      const ok = c1 === 0 && c2 === 0;
      if (!ok) failed = true;
      await owner('UPDATE ops.org_connection SET last_run = $2 WHERE region = $1', [r.region, { id: j.id, status: ok ? 'ok' : 'failed', at: new Date().toISOString() }]);
    }
    for (const g of ['emit-assessment.js', 'emit-discovery.js']) { log(`all orgs: ${g.replace('.js', '')}`); if (await run(g, [], base_, log) !== 0) failed = true; }
    j.finishedAt = new Date().toISOString();
    j.status = failed ? 'finished with errors' : 'complete';
    log(`run ${j.id} ${j.status}`);
  });

  app.get('/api/discovery/run', (_req, res) => res.json(job ? { ...job, log: job.log.slice(-200) } : null));

  // Results of the latest real run, if there is one; the console falls back to its built-in sample otherwise.
  app.get('/api/assessment-data', (_req, res) => {
    const read = (f) => (fs.existsSync(path.join(DATA, f)) ? JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) : null);
    const assessment = read('assessment-bundle.json');
    const discovery = read('discovery-bundle.json');
    if (!assessment && !discovery) return res.status(404).json({ error: { message: 'No discovery run on this server yet' } });
    res.set('Cache-Control', 'no-store').json({ assessment, discovery, runId: job?.id || null, finishedAt: job?.finishedAt || null });
  });
}

module.exports = { install };
