// Confirms every source behind the package knowledge base (kb/packages/sources.json): each official page is opened
// in a headless browser (Salesforce Help renders in the browser, inside shadow DOM) and each PDF is downloaded and
// read, and the quoted words must be on it. Passing entries get today's date in "checked"; any miss fails the run.
//
//   node --use-system-ca src/generators/verify-kb-sources.js            all sources
//   node --use-system-ca src/generators/verify-kb-sources.js cpq-eos     only ids starting with this
//
// Needs Microsoft Edge or Google Chrome (BROWSER=<path> to choose) and, for PDFs, Python with PyMuPDF. Run on a
// workstation before changing kb/packages; it is not part of CI because it calls public websites.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const P = require('../paths');

const FILE = path.join(P.ROOT, 'kb', 'packages', 'sources.json');
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const only = process.argv[2] || '';
const todo = doc.sources.filter((s) => s.id.startsWith(only));
const norm = (s) => String(s).replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u00A0\s]+/g, ' ').toLowerCase().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSER = process.env.BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((b) => fs.existsSync(b));

async function pdfText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const f = path.join(os.tmpdir(), `kbsrc-${Date.now()}.pdf`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  const py = process.platform === 'win32' ? 'py' : 'python3';
  try { return execFileSync(py, ['-c', 'import sys, pymupdf; print("\\n".join(p.get_text() for p in pymupdf.open(sys.argv[1])))', f], { maxBuffer: 1 << 28 }).toString('utf8'); } finally { fs.rmSync(f, { force: true }); }
}

async function browser() {
  if (!BROWSER) throw new Error('no Edge or Chrome found; set BROWSER');
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kbsrc-'));
  const proc = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ } await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // All visible text, including inside shadow roots (Lightning web components).
  const DEEP = `(() => { const out = []; const walk = (n) => { if (n.nodeType === 3) out.push(n.nodeValue); if (n.shadowRoot) walk(n.shadowRoot); for (const c of n.childNodes || []) walk(c); }; walk(document.documentElement); return out.join(' '); })()`;
  // Some Salesforce sites refuse the headless browser's own name; present the regular browser's.
  const { result: v } = await send('Browser.getVersion');
  await send('Network.setUserAgentOverride', { userAgent: String(v?.userAgent || '').replace('HeadlessChrome', 'Chrome') });
  return {
    async text(url, quote) {
      await send('Page.navigate', { url });
      // Pages assemble their content after load; poll until the words appear or the time runs out.
      let t = '';
      for (let i = 0; i < 40; i++) {
        await sleep(i < 4 ? 1500 : 750);
        t = (await send('Runtime.evaluate', { expression: DEEP, returnByValue: true })).result?.result?.value || '';
        if (norm(t).includes(norm(quote))) break;
      }
      return t;
    },
    close() { try { ws.close(); } catch { /* closed */ } proc.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500); },
  };
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const byUrl = new Map();
  for (const s of todo) byUrl.set(s.url, [...(byUrl.get(s.url) || []), s]);
  let b = null; const failed = [];
  for (const [url, list] of byUrl) {
    let text = '';
    try {
      if (/\.pdf($|\?)/i.test(url)) text = await pdfText(url);
      else { b ||= await browser(); text = await b.text(url, list[0].quote); }
    } catch (e) { text = ''; console.log(`  could not open ${url}: ${e.message}`); }
    const page = norm(text);
    for (const s of list) {
      const ok = page.includes(norm(s.quote));
      if (ok) s.checked = today; else failed.push(s.id);
      console.log(`${ok ? 'ok  ' : 'MISS'} ${s.id.padEnd(22)} ${url.slice(0, 90)}`);
      // What the page showed instead (DEBUG=1): enough to tell a moved article from changed wording.
      if (!ok && process.env.DEBUG) {
        const k = process.env.DEBUG.length > 1 ? page.indexOf(process.env.DEBUG.toLowerCase()) : -1;
        console.log(`     page text (${page.length} chars): ${k >= 0 ? page.slice(Math.max(0, k - 300), k + 500) : page.slice(0, 400)}`);
      }
    }
  }
  if (b) b.close();
  fs.writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`\n${todo.length - failed.length}/${todo.length} sources confirmed${failed.length ? `; not found: ${failed.join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
