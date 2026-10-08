// Keeps the Org Compiler console honest: every repository file it shows is the real file, and every GitHub link
// points at something that exists.
//
//   node src/generators/emit-console.js
//
// 1. A file the console shows as `{ path: 'adlc/...', lang, code: <literal copy> }` becomes `code: FILE('adlc/...')`.
// 2. The real contents of every FILE('...') are embedded between the FILES markers (as emit-docs does for the
//    design documents), so the console works offline and from the deployed app.
// 3. Every repository path the console links to must exist in git; otherwise the script lists it and exits 1.
// Views the console computes on the page (SQL, load and parity reports) stay computed; their links go to the real files.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('../paths');

const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: P.ROOT }).toString().split('\n').filter(Boolean));
const folders = new Set([...tracked].flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
const isRepoPath = (p) => /^(adlc|src|docs|kb|evals|guardrails|presentations|\.github)\//.test(p);
// A shown path may carry a note: "adlc/3-build + extraction data", "inventory/ (25 files)". The path is the first word.
const clean = (p) => String(p).trim().split(/\s+/)[0].replace(/\/$/, '');
const exists = (p) => tracked.has(p) || folders.has(p);

let html = fs.readFileSync(P.CONSOLE, 'utf8');

// 1. Literal copies of real files become FILE() references.
const literal = /(\{ path: '([^']+)', lang: '[^']*', code: )(R`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*")/g;
let converted = 0;
html = html.replace(literal, (all, head, p) => (tracked.has(p) ? (converted++, `${head}FILE(${JSON.stringify(p)})`) : all));

// 2. Embed the real files.
const files = [...new Set([...html.matchAll(/FILE\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
const bundle = Object.fromEntries(files.filter((f) => tracked.has(f)).map((f) => [f, fs.readFileSync(path.join(P.ROOT, f), 'utf8').replace(/\r\n/g, '\n')]));
const a = html.indexOf('/*FILES-START*/'), b = html.indexOf('/*FILES-END*/');
if (a < 0 || b < a) throw new Error('FILES markers not found in the console');
html = html.slice(0, a + 15) + JSON.stringify(bundle).replace(/<\//g, '<\\/') + html.slice(b);
fs.writeFileSync(P.CONSOLE, html);

// 3. Link check.
const runtimeOnly = Object.keys(JSON.parse((html.match(/const RUNTIME_ONLY = (\{[^;]*\});/) || [, '{}'])[1].replace(/'/g, '"')));
const linked = [
  ...[...html.matchAll(/data-gh="([^"]*)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/\{ path: '([^']+)'/g)].map((m) => m[1]),
  ...files,
].map(clean).filter(isRepoPath);
const missing = [...new Set(linked)].filter((p) => !exists(p) && !runtimeOnly.includes(p)).sort();
for (const f of files) if (!tracked.has(f)) missing.push(`${f} (shown with FILE() but not in git)`);
if (missing.length) { console.error(`console: ${missing.length} link(s) to files that are not in the repository\n${missing.map((m) => `  - ${m}`).join('\n')}`); process.exit(1); }
console.log(`console: ${files.length} real files embedded${converted ? ` (${converted} copies replaced)` : ''}, ${new Set(linked).size} repository links checked`);
