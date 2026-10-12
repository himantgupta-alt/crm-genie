// In-app sign-in, used because the tenant does not allow creating the app registration that App Service
// (Entra) authentication needs. Same interim approach as Cash Forecasting.
//
//   CRMGENIE_USERS   JSON: { "<username>": { "name": "<display name>", "hash": "scrypt$<salt b64>$<hash b64>" } }
//   SESSION_SECRET   32+ random characters; signs the session cookie
//   LOGIN_PREFILL    optional JSON { "username": "...", "password": "..." }; filled into the sign-in form so
//                    demo reviewers only click Log In. Anyone who can open /login can read it.
//
// Without CRMGENIE_USERS the app runs open only outside production (local development and the smoke test).
const crypto = require('crypto');

const COOKIE = 'cg_session';
const TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // "Keep me signed in"
const PUBLIC = new Set(['/health', '/login', '/auth/login', '/auth/prefill', '/app.css', '/login.js']);

function loadUsers() {
  if (!process.env.CRMGENIE_USERS) return null;
  try { return JSON.parse(process.env.CRMGENIE_USERS); } catch { throw new Error('CRMGENIE_USERS is not valid JSON'); }
}
const USERS = loadUsers();
function loadPrefill() {
  if (!process.env.LOGIN_PREFILL) return {};
  try { return JSON.parse(process.env.LOGIN_PREFILL); } catch { throw new Error('LOGIN_PREFILL is not valid JSON'); }
}
const PREFILL = loadPrefill();
const SECRET = process.env.SESSION_SECRET || '';
const PROD = process.env.NODE_ENV === 'production';
const enabled = !!USERS;
if (enabled && SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(password, salt, 32).toString('base64')}`;
}
function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(got, want);
}

const b64url = (b) => Buffer.from(b).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
function issue(username, name, ttl) {
  const body = b64url(JSON.stringify({ u: username, n: name, exp: Date.now() + ttl }));
  return `${body}.${sign(body)}`;
}
function read(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [body, mac] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !mac) return null;
  const expect = sign(body);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (s.exp < Date.now() || !USERS?.[s.u]) return null;
  return s;
}
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;

// Five failed attempts per IP per 10 minutes.
const failures = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  failures.set(ip, list);
  return list.length >= 5;
}

function install(app, pub) {
  const path = require('path');
  app.get('/login', (_req, res) => res.sendFile(path.join(pub, 'login.html')));
  app.get('/auth/prefill', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ username: PREFILL.username || '', password: PREFILL.password || '' });
  });

  app.post('/auth/login', (req, res) => {
    const ip = req.ip;
    if (!enabled) return res.json({ ok: true });
    if (limited(ip)) return res.status(429).json({ error: { message: 'Too many attempts. Try again in a few minutes.' } });
    const username = String(req.body?.username || '').trim().toLowerCase();
    const user = USERS[username];
    if (!user || !verifyPassword(req.body?.password || '', user.hash)) {
      failures.get(ip).push(Date.now());
      return res.status(401).json({ error: { message: 'Your login attempt has failed. Make sure the username and password are correct.' } });
    }
    failures.delete(ip);
    const ttl = req.body?.remember ? REMEMBER_MS : TTL_MS;
    res.set('Set-Cookie', cookie(issue(username, user.name, ttl), ttl / 1000));
    res.json({ ok: true });
  });

  app.post('/auth/logout', (_req, res) => {
    res.set('Set-Cookie', cookie('', 0));
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (PUBLIC.has(req.path)) return next();
    if (!enabled) {
      if (PROD) return res.status(503).send('Sign-in is not configured.');
      req.session = { u: 'local', n: process.env.LOCAL_USER || 'local developer' };
      return next();
    }
    const s = read(req);
    if (s) { req.session = s; return next(); }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: { message: 'Session expired. Sign in again.', kind: 'INVALID_SESSION_ID' } });
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  });
}

module.exports = { install, hashPassword, enabled };
