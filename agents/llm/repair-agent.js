// Repair agent: runs only when verification fails. Sends the failed checks, the generated SQL and the
// generator source to Claude with agents/prompts/repair-agent.md, and saves the proposed patch for a
// reviewer. The runner applies it only after approval.
const fs = require('fs');
const path = require('path');
const { MODEL, loadPrompt, ask, dryRun, fenced } = require('./claude');

function failures(report) {
  const derived = (report.derived ?? []).filter((d) => d.note || (d.rows !== undefined && d.matched !== d.rows));
  const cases = (report.cases ?? []).filter((c) => c.status === 'fail')
    .map((c) => ({ id: c.id, origin: c.origin, failedSteps: c.steps.filter((s) => s.outcome === 'mismatch') }));
  return { derived, cases };
}

async function run({ root, runDir, live, log }) {
  const sfx = path.join(root, 'sf-extract');
  const report = JSON.parse(fs.readFileSync(path.join(sfx, 'target', 'parity', 'report.json'), 'utf8'));
  const f = failures(report);
  if (!f.derived.length && !f.cases.length) { log('nothing to repair'); return null; }
  const db = path.join(sfx, 'target', 'db');
  const generated = fs.readdirSync(db).filter((x) => x.endsWith('.sql')).sort()
    .map((x) => `-- ===== ${x}\n${fs.readFileSync(path.join(db, x), 'utf8')}`).join('\n');
  const prompt = loadPrompt(path.join(__dirname, '..', 'prompts', 'repair-agent.md'), {
    failures: JSON.stringify(f, null, 2),
    generated,
    generator: fs.readFileSync(path.join(sfx, 'scripts', 'emit-postgres.js'), 'utf8'),
  });
  const saveAs = path.join(runDir, 'repair', 'repair');
  if (!live) {
    dryRun({ ...prompt, saveAs });
    log(`repair prompt saved (dry run): ${path.relative(root, saveAs)}.prompt.md`);
    return { live: false };
  }
  log(`diagnosing ${f.cases.length} failed case(s) and ${f.derived.length} derived-value issue(s) with ${MODEL}`);
  const res = await ask({ ...prompt, saveAs });
  const meta = JSON.parse(fenced(res.text, 'json') ?? '{}');
  const diff = fenced(res.text, 'diff');
  const patch = diff ? path.join(runDir, 'repair.patch') : null;
  if (patch) fs.writeFileSync(patch, diff.endsWith('\n') ? diff : `${diff}\n`);
  fs.writeFileSync(path.join(runDir, 'repair.md'), `# Repair proposal\n\n${res.text}\n`);
  return { live: true, meta, patch };
}

module.exports = { run, failures };
