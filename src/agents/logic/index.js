// Logic agent. Two parts:
//  1. Apex: translates the Apex methods that triggers on the object family call into PostgreSQL with
//     Claude, using agents/logic/prompt.md. Output goes to blueprint/translations/ with
//     "reviewed": false. Methods it cannot translate yet (for example, they write to an object outside
//     the family) are recorded in blueprint/translations/blocked.json with the reason.
//  2. Rules: compiles validation rules into guards and includes the translations
//     (emit-postgres.js --parts guards,translations). Row-local rules are CHECK constraints emitted
//     with the tables by the Schema agent.
const fs = require('fs');
const path = require('path');
const { MODEL, loadPrompt, ask, dryRun, fenced } = require('../lib/claude');

const readJson = (f, dflt) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : dflt);

function pendingMethods(bp, family, index, blocked) {
  const done = new Set(index.flatMap((t) => t.implements));
  const skip = new Set(blocked.map((b) => b.implements));
  const fam = new Set(family);
  const out = [];
  for (const a of bp.automations.filter((x) => x.source?.kind === 'apexTrigger')) {
    for (const h of a.handlers ?? []) {
      const [cls, method] = h.split('.');
      const svc = bp.services.find((s) => s.source.name === cls);
      if (!svc) continue;
      const touches = fam.has(a.trigger?.entity) || [...(svc.reads ?? []), ...(svc.writes ?? [])].some((e) => fam.has(e));
      const id = `apex-class:${cls}#${method}`;
      if (touches && !done.has(id) && !skip.has(id) && !out.some((o) => o.id === id)) out.push({ id, cls, method });
    }
  }
  return out;
}

function fieldMapping(bp, family) {
  const ents = new Map(bp.entities.map((e) => [e.id, e]));
  const rels = new Map(bp.relations.map((r) => [r.id, r]));
  const lines = [];
  const refs = new Set();
  for (const id of family) {
    const e = ents.get(id);
    lines.push(`${id} -> app.${e.name}`);
    for (const f of e.fields.filter((x) => x.pg)) {
      lines.push(`  ${f.source.padEnd(26)} -> ${f.name.padEnd(28)} ${f.type}${f.required ? ', required' : ''}${f.derivation ? ', calculated' : ''}`);
      if (f.relation) for (const t of rels.get(f.relation)?.to ?? []) if (!family.includes(t) && ents.has(t) && !['User', 'Group'].includes(t)) refs.add(t);
    }
  }
  for (const id of refs) lines.push(`${id} -> app.${ents.get(id).name} (reference table: id, name only)`);
  return lines.join('\n');
}

async function translateApex({ root, runDir, family, live, log }) {
  const P = require('../../paths');
  const bp = readJson(P.BLUEPRINT);
  const apex = readJson(path.join(P.LOGIC, 'apex.json'), []);
  const tdir = P.TRANSLATIONS;
  const index = readJson(path.join(tdir, 'index.json'), []);
  const blocked = readJson(path.join(tdir, 'blocked.json'), []);
  const todo = pendingMethods(bp, family, index, blocked);
  if (!todo.length) { log('no pending Apex methods for this family'); return { translated: [], blocked: [], pending: [] }; }

  const example = index[0] ? fs.readFileSync(path.join(tdir, index[0].file), 'utf8') : '-- none yet';
  const mapping = fieldMapping(bp, family);
  const result = { translated: [], blocked: [], pending: [] };

  for (const t of todo) {
    const cls = apex.find((a) => a.kind === 'class' && a.name === t.cls);
    const triggers = apex.filter((a) => a.kind === 'trigger' && a.body.includes(`${t.cls}.${t.method}`)).map((a) => a.body).join('\n\n');
    const svc = bp.services.find((s) => s.source.name === t.cls);
    const kbText = (require('./agent.json').kb || []).map((k) => fs.readFileSync(path.join(require('../../paths').ROOT, k), 'utf8')).join('\n\n---\n\n');
    const prompt = loadPrompt(path.join(__dirname, 'prompt.md'), {
      standards: kbText,
      class: t.cls, method: t.method, apex: cls?.body ?? '', triggers: triggers || '(none)', mapping,
      constants: JSON.stringify(svc?.constants ?? {}), example,
    });
    const saveAs = path.join(runDir, 'logic', `${t.cls}.${t.method}`);
    if (!live) {
      dryRun({ ...prompt, saveAs });
      log(`prompt saved for ${t.id} (dry run): ${path.relative(root, saveAs)}.prompt.md`);
      result.pending.push(t.id);
      continue;
    }
    log(`translating ${t.id} with ${MODEL}`);
    const res = await ask({ ...prompt, saveAs });
    const meta = JSON.parse(fenced(res.text, 'json') ?? '{}');
    if (meta.status === 'translated') {
      const sql = fenced(res.text, 'sql');
      if (!sql) throw new Error(`${t.id}: response marked translated but has no sql block`);
      const file = `${t.cls}.${t.method}.sql`;
      fs.writeFileSync(path.join(tdir, file), `-- Translated from ${t.id} by the Logic agent (${res.model}). Pending review.\n${sql}\n`);
      index.push({ file, implements: meta.implements ?? [t.id], entities: meta.entities ?? [], translatedBy: `Logic agent (${res.model}), ${new Date().toISOString().slice(0, 10)}`, reviewed: false });
      result.translated.push(t.id);
      log(`translated ${t.id} -> blueprint/translations/${file}`);
    } else {
      blocked.push({ implements: t.id, reason: meta.reason ?? 'no reason given', at: new Date().toISOString() });
      result.blocked.push({ id: t.id, reason: meta.reason });
      log(`blocked ${t.id}: ${meta.reason}`);
    }
  }
  if (live) {
    fs.writeFileSync(path.join(tdir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    fs.writeFileSync(path.join(tdir, 'blocked.json'), JSON.stringify(blocked, null, 2) + '\n');
  }
  return result;
}

async function run(ctx) {
  const apex = await translateApex(ctx);
  const cmd = `node src/generators/emit-postgres.js ${ctx.family.join(',')} --parts guards,translations`;
  ctx.log(`$ ${cmd}`);
  if (ctx.sh(cmd) !== 0) return { status: 'failed', summary: 'rule compilation failed', details: apex };
  const parts = [
    apex.translated.length && `${apex.translated.length} Apex method(s) translated`,
    apex.blocked.length && `${apex.blocked.length} blocked`,
    apex.pending.length && `${apex.pending.length} prompt(s) saved (dry run)`,
  ].filter(Boolean);
  return { status: 'ok', summary: `${parts.join(' · ') || 'no pending Apex'} · rules compiled to guards`, details: apex };
}

module.exports = { spec: require('./agent.json'), run, pendingMethods };
