// Encryption and masking for stored org connections. The key comes from CONNECTION_KEY; tokens are sealed with
// AES-256-GCM (random IV, authenticated), so a database copy alone does not reveal them.
const crypto = require('crypto');

const KEY = process.env.CONNECTION_KEY ? crypto.createHash('sha256').update(process.env.CONNECTION_KEY).digest() : null;
const enc = (s) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const b = Buffer.concat([c.update(s, 'utf8'), c.final()]); return [iv, c.getAuthTag(), b].map((x) => x.toString('base64')).join('.'); };
const dec = (s) => { const [iv, tag, b] = s.split('.').map((x) => Buffer.from(x, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag); return Buffer.concat([d.update(b), d.final()]).toString('utf8'); };
// h•••@e•••.com: enough to recognise an account, not enough to reuse it.
const mask = (u) => { if (!u) return null; const [name, dom = ''] = String(u).split('@'); return `${name[0]}•••@${dom ? `${dom[0]}•••${dom.includes('.') ? dom.slice(dom.lastIndexOf('.')) : ''}` : '•••'}`; };

module.exports = { KEY, enc, dec, mask };
