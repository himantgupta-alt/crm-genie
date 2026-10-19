// Org connections for the Assessment agent, and real discovery runs from the Org Compiler.
//
//   - Each regional org is connected with "Connect with Salesforce" (OAuth web server flow with PKCE, connected app
//     "Org Compiler"; no password ever reaches this server). Only the refresh token is kept, encrypted with
//     CONNECTION_KEY (AES-256-GCM), in ops.org_connection. Disconnect revokes it at Salesforce.
//   - Each run uses the agent code of the latest commit on main (AGENTS_REPO, AGENTS_REF), fetched from GitHub
//     and cached per commit, so a change pushed to git is picked up by the next run; the packaged copy is the
//     fallback. The run records which commit it used.
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
const zlib = require('zlib');

const { KEY, enc, dec, mask } = require('./connections-crypto');

const CLIENT_ID = process.env.ORGC_OAUTH_CLIENT_ID || '';
const DATA = process.env.RUNTIME_DATA_DIR || path.join(process.env.HOME || os.tmpdir(), 'orgcompiler-data');
// Agents ship inside the app package (runtime/) on the server; locally they are the repository's own.
const RUNTIME = fs.existsSync(path.join(__dirname, 'runtime', 'src', 'generators')) ? path.join(__dirname, 'runtime', 'src') : path.join(__dirname, '..');
const DEFAULT_ORGS = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'agents', 'assessment', 'engagement.json'), 'utf8'));

// Agent code for a run: the latest commit on the repository's main branch, so a change pushed to git is used by
// the next run without waiting for a deploy. The packaged copy (runtime/VERSION) is the fallback.
const DEPLOYED = (() => { try { return fs.readFileSync(path.join(__dirname, 'runtime', 'VERSION'), 'utf8').trim() || null; } catch { return null; } })();
const REPO = process.env.AGENTS_REPO || 'himantgupta-alt/crm-genie';
const REF = process.env.AGENTS_REF || 'main';
const AGENT_FILES = ['src/paths.js', 'src/generators/lib.js', 'src/generators/assess-org.js', 'src/generators/discover-org.js', 'src/generators/emit-assessment.js',
  'src/generators/emit-discovery.js', 'src/generators/apex-functions.js', 'src/agents/assessment/engagement.json', 'src/agents/assessment/capabilities.json', 'src/agents/assessment/agent.json'];
let latestCache = { at: 0, sha: null };
async function latestSha() {
  if (Date.now() - latestCache.at < 60000) return latestCache.sha;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${REF}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'org-compiler' } });
    latestCache = { at: Date.now(), sha: r.ok ? (await r.json()).sha : null };
  } catch { latestCache = { at: Date.now(), sha: null }; }
  return latestCache.sha;
}
async function agentsFor(useLatest, log) {
  const deployed = { root: RUNTIME, sha: DEPLOYED, source: 'deployed' };
  if (!useLatest) return deployed;
  const sha = await latestSha();
  if (!sha) { log('agent code: GitHub not reachable; using the deployed agents'); return deployed; }
  if (sha === DEPLOYED) return { ...deployed, source: `${REF} (same as deployed)` };
  const dir = path.join(DATA, 'agents', sha);
  if (!fs.existsSync(path.join(dir, '.complete'))) {
    for (const f of AGENT_FILES) {
      const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${f}`).catch(() => null);
      if (!r?.ok) { log(`agent code: ${f} not found at ${sha.slice(0, 7)}; using the deployed agents`); return deployed; }
      const out = path.join(dir, f);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await r.text());
    }
    fs.writeFileSync(path.join(dir, '.complete'), sha);
  }
  return { root: path.join(dir, 'src'), sha, source: REF };
}
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
      res.json({ orgs: (await rows()).map(view), oauthReady: !!(CLIENT_ID && KEY), storageReady: !!KEY, runner: 'server', agents: { repo: REPO, ref: REF, deployed: DEPLOYED, latest: await latestSha() }, job: job && { ...job, log: job.log.slice(-60) } });
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

  const run = (script, args, env, log, root = RUNTIME) => new Promise((resolve) => {
    // NODE_PATH: the agents load the app's own Salesforce client (jsforce), wherever they are installed.
    const p = spawn(process.execPath, [path.join(root, 'generators', script), ...args], { cwd: root, env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules'), ...env } });
    const out = (d) => String(d).split('\n').filter(Boolean).forEach((l) => log(l.replace(/(token|secret)=\S+/gi, '$1=…')));
    p.stdout.on('data', out); p.stderr.on('data', out);
    p.on('close', (code) => resolve(code));
  });

  app.post('/api/discovery/run', async (req, res) => {
    if (job && !job.finishedAt) return err(res, 409, 'A discovery run is already in progress');
    const all = (await rows()).filter((r) => r.token_enc);
    const wanted = Array.isArray(req.body?.regions) && req.body.regions.length ? all.filter((r) => req.body.regions.includes(r.region)) : all;
    if (!wanted.length) return err(res, 400, 'Connect at least one org first');
    // Every run is the whole Discovery agent: org scan, as-is, fit-gap (business areas) and report (business processes).
    const scope = 'full';
    job = { id: `DISC-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', scope, regions: wanted.map((r) => r.region), labels: Object.fromEntries(wanted.map((r) => [r.region, r.label])), log: [], progress: null, by: req.session?.n || null };
    res.json(job);
    const j = job;
    const log = (l) => {
      // The sub-agents print "discovery: <step> <done>/<total> (<pct>%)"; the latest one drives the progress bar.
      const m = /^discovery: (.+?) (\d+)\/(\d+) \((\d+)%\)$/.exec(l);
      if (m) j.progress = { ...j.progress, step: m[1], done: Number(m[2]), total: Number(m[3]), pct: Number(m[4]) };
      j.log.push(`${new Date().toISOString().slice(11, 19)}  ${l}`); if (j.log.length > 400) j.log.shift();
    };
    // Agent code: the latest commit on main unless the caller asks for the deployed copy.
    const agents = await agentsFor(req.body?.useLatest !== false, log);
    j.agents = { sha: agents.sha, source: agents.source };
    log(`agent code: commit ${agents.sha ? agents.sha.slice(0, 7) : 'unknown'} (${agents.source})`);
    const adlc = path.join(DATA, 'adlc');
    fs.mkdirSync(adlc, { recursive: true });
    // The engagement for this run: the orgs in this run, under the names given on the Connections page. The demo's
    // sample framing (fictional company, expected markets) applies only when every org in the run is a demo org;
    // any other org is reported as itself.
    const engagementFile = path.join(DATA, 'engagement.json');
    const demo = DEFAULT_ORGS.sampleData && wanted.every((r) => DEFAULT_ORGS.orgs.some((o) => o.region === r.region));
    const orgList = wanted.map((r) => ({ region: r.region, label: r.label, alias: r.region }));
    fs.writeFileSync(engagementFile, JSON.stringify(demo ? { ...DEFAULT_ORGS, orgs: orgList }
      : { client: wanted.length === 1 ? wanted[0].label : 'Salesforce orgs', sampleData: false, orgs: orgList }, null, 2));
    const base_ = { ADLC_DIR: adlc, ENGAGEMENT_FILE: engagementFile, BUNDLE_DIR: DATA };
    let failed = false;
    for (const [k, r] of wanted.entries()) {
      j.progress = { org: r.label, orgIndex: k + 1, orgs: wanted.length, step: 'connecting', done: 0, total: 0, pct: 0 };
      let a;
      try { a = await accessFor(r); } catch (e) { log(`${r.label}: cannot sign in (${e.message})`); failed = true; await owner('UPDATE ops.org_connection SET last_run = $2 WHERE region = $1', [r.region, { id: j.id, status: 'failed', at: new Date().toISOString(), message: e.message }]); continue; }
      const env = { ...base_, SF_REFRESH_TOKEN: a.refresh, SF_INSTANCE_URL: a.instance, SF_CLIENT_ID: r.client_id, SF_LOGIN_URL: r.login_url };
      // The Discovery agent's sub-agents, each read-only against the org.
      j.progress = { ...j.progress, agent: 'As-is sub-agent', step: 'starting' };
      log(`${r.label}: As-is sub-agent (read-only)`);
      const c1 = await run('assess-org.js', [r.region, r.label], env, log, agents.root);
      j.progress = { ...j.progress, agent: 'Org scan sub-agent', step: 'starting', done: 0, total: 0, pct: 0 };
      log(`${r.label}: Org scan sub-agent (read-only)`);
      const c2 = c1 === 0 ? await run('discover-org.js', [r.region, r.label], env, log, agents.root) : 1;
      const ok = c1 === 0 && c2 === 0;
      if (!ok) failed = true;
      await owner('UPDATE ops.org_connection SET last_run = $2 WHERE region = $1', [r.region, { id: j.id, status: ok ? 'ok' : 'failed', at: new Date().toISOString() }]);
    }
    for (const [script, agent] of [['emit-assessment.js', 'Fit-gap sub-agent'], ['emit-discovery.js', 'Report sub-agent']]) {
      j.progress = { agent, step: script === 'emit-assessment.js' ? 'business areas and verdicts' : 'report, business processes and explorer', done: 0, total: 0, pct: 100 };
      log(`all orgs: ${agent}`);
      if (await run(script, [], base_, log, agents.root) !== 0) failed = true;
    }
    j.progress = null;
    j.finishedAt = new Date().toISOString();
    j.status = failed ? 'finished with errors' : 'complete';
    log(`run ${j.id} ${j.status}`);
    try { archive(j); } catch (e) { log(`run history: ${e.message}`); }
  });

  // Run history: each finished run keeps what it produced in RUNS/<run id>/ (bundles, report, run record), so the
  // console shows the latest run by default and any earlier run on request. The newest KEEP_RUNS are kept.
  const RUNS = path.join(DATA, 'runs');
  const KEEP_RUNS = Number(process.env.KEEP_RUNS) || 30;
  const gzCache = new Map(); // response bodies of recent runs, plain and compressed
  const readJson = (f) =>(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  function archive(j) {
    const dir = path.join(RUNS, j.id);
    fs.mkdirSync(dir, { recursive: true });
    // A discovery-only run has no fit-gap of its own; the bundle left from an earlier full run is not copied.
    const files = [['discovery-bundle.json', DATA], ...(j.scope === 'full' ? [['assessment-bundle.json', DATA]] : []),
      ['discovery-report.md', path.join(DATA, 'adlc', '1-discover', 'assessment')]];
    for (const [f, from] of files) if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(dir, f));
    const labels = j.regions.map((r) => j.labels?.[r] || r);
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id: j.id, startedAt: j.startedAt, finishedAt: j.finishedAt, status: j.status, scope: j.scope, regions: j.regions, orgs: labels, by: j.by, agents: j.agents, log: j.log }, null, 2));
    const all = fs.readdirSync(RUNS).filter((d) => fs.existsSync(path.join(RUNS, d, 'run.json'))).sort().reverse();
    for (const old of all.slice(KEEP_RUNS)) fs.rmSync(path.join(RUNS, old), { recursive: true, force: true });
  }
  const runList = () => (fs.existsSync(RUNS) ? fs.readdirSync(RUNS).sort().reverse().map((d) => readJson(path.join(RUNS, d, 'run.json'))).filter(Boolean)
    .map(({ log: _log, ...r }) => ({ ...r, hasDiscovery: fs.existsSync(path.join(RUNS, r.id, 'discovery-bundle.json')), hasAssessment: fs.existsSync(path.join(RUNS, r.id, 'assessment-bundle.json')) })) : []);

  // Results from before the history existed become its first entry, so nothing produced earlier is lost.
  try {
    const legacy = path.join(DATA, 'discovery-bundle.json');
    if (!runList().length && fs.existsSync(legacy)) {
      const at = fs.statSync(legacy).mtime.toISOString();
      const d = readJson(legacy);
      const id = `DISC-${at.slice(0, 16).replace(/[-:T]/g, '')}`;
      const dir = path.join(RUNS, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(legacy, path.join(dir, 'discovery-bundle.json'));
      const ab = path.join(DATA, 'assessment-bundle.json');
      // The fit-gap belongs to that run only if it was produced with it.
      if (fs.existsSync(ab) && Math.abs(fs.statSync(ab).mtimeMs - fs.statSync(legacy).mtimeMs) < 15 * 60000) fs.copyFileSync(ab, path.join(dir, 'assessment-bundle.json'));
      const orgs = (d?.orgs || []).filter((o) => o.extracted);
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id, startedAt: null, finishedAt: at, status: 'complete', scope: fs.existsSync(path.join(dir, 'assessment-bundle.json')) ? 'full' : 'discovery', regions: orgs.map((o) => o.region), orgs: orgs.map((o) => o.label), by: null, agents: null, log: [] }, null, 2));
    }
  } catch (e) { console.error('run history import', e.message); }

  app.get('/api/discovery/runs',(_req, res) => res.set('Cache-Control', 'no-store').json({ runs: runList() }));

  app.get('/api/discovery/run', (_req, res) => res.json(job ? { ...job, log: job.log.slice(-200) } : null));

  // Results of one run: ?run=<id>, else the latest in the history. Runs from before the history existed are read
  // from DATA itself. Without any run, the console keeps its built-in sample.
  app.get('/api/assessment-data', (req, res) => {
    const runs = runList();
    const wantedRun = req.query.run ? runs.find((r) => r.id === String(req.query.run)) : runs[0];
    if (req.query.run && !wantedRun) return res.status(404).json({ error: { message: 'Unknown run' } });
    const dir = wantedRun ? path.join(RUNS, wantedRun.id) : DATA;
    const latest = !req.query.run || wantedRun?.id === runs[0]?.id;
    // A large org's bundle is 15 MB of JSON; compressed it is a small fraction, so the console shows the run in
    // a second or two instead of twenty. A finished run never changes, so its compressed body is built once.
    const key = `${dir}|${latest}`;
    let body = gzCache.get(key);
    if (!body) {
      const assessment = readJson(path.join(dir, 'assessment-bundle.json'));
      const discovery = readJson(path.join(dir, 'discovery-bundle.json'));
      if (!assessment && !discovery) return res.status(404).json({ error: { message: 'No discovery run on this server yet' } });
      const json = JSON.stringify({ assessment, discovery, runId: wantedRun?.id || job?.id || null, finishedAt: wantedRun?.finishedAt || job?.finishedAt || null, scope: wantedRun?.scope || null, orgs: wantedRun?.orgs || null, latest });
      body = { json, gz: zlib.gzipSync(json) };
      if (wantedRun) { gzCache.set(key, body); if (gzCache.size > 6) gzCache.delete(gzCache.keys().next().value); }
    }
    res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' });
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) res.set('Content-Encoding', 'gzip').send(body.gz);
    else res.send(body.json);
  });
}

module.exports = { install };
