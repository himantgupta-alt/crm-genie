// Multi-org assessment: fit-gap, cross-org comparison, report and architecture, from the as-is files.
//
//   node src/generators/emit-assessment.js
//
// Reads  adlc/1-discover/assessment/orgs/<region>.json (assess-org.js, one per org)
//        src/agents/assessment/engagement.json and capabilities.json
// Writes adlc/1-discover/assessment/fit-gap.json, assessment-report.md, architecture.md, and embeds the same data
//        in the Org Compiler console between the ASSESS markers.
// No org connection. Deterministic: the same inputs give the same files.
const fs = require('fs');
const path = require('path');
const P = require('../paths');

const DIR = P.ASSESSMENT;
const SPEC = path.join(P.AGENTS, 'assessment');
const eng = JSON.parse(fs.readFileSync(process.env.ENGAGEMENT_FILE || path.join(SPEC, 'engagement.json'), 'utf8'));
const cat = JSON.parse(fs.readFileSync(path.join(SPEC, 'capabilities.json'), 'utf8'));
const V = cat.verdicts;
const VERDICTS = Object.keys(V);

const orgs = eng.orgs.map((o) => {
  const f = path.join(DIR, 'orgs', `${o.region}.json`);
  return { ...o, asIs: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null };
});
const extracted = orgs.filter((o) => o.asIs);
if (!extracted.length) { console.error('assessment: no as-is files yet; run assess-org.js for at least one org'); process.exit(1); }

/* ---------------------------------------------------------------- classify */

const re = (s) => (s ? new RegExp(s) : null);
const caps = cat.capabilities.map((c) => ({ ...c, re: Object.fromEntries(Object.entries(c.match).map(([k, v]) => [k, re(v)])) }));
const byKey = (kind, name) => caps.find((c) => c.re[kind]?.test(name));
const capOfObject = (name) => byKey('objects', name);

// Process Builder and Workflow Rules: support ended at the end of 2025, so they are rebuilt as flows whatever they do.
const RETIRED_AUTOMATION = 'Process Builder and Workflow Rules are no longer supported: rebuild as a record-triggered flow.';

function classify(o) {
  const a = o.asIs;
  const items = [];
  const push = (kind, name, cap, extra = {}) => {
    let verdict = cap ? cap.verdict : 'review';
    let reason = cap ? cap.standard : 'Not matched to a known capability; confirm owner and purpose in the workshop.';
    if (extra.unused && verdict !== 'retire') {
      if (!cap) { verdict = 'retire'; reason = extra.unused; } else reason = `${reason}. Note: ${extra.unused.toLowerCase()}`;
    }
    // Evidence confidence: matched by the component's own name, through the objects its code touches, or not at all.
    const confidence = !cap ? 'Low' : extra.via === 'objects' ? 'Medium' : 'High';
    items.push({ org: o.region, kind, name, capability: cap?.id || null, verdict, reason, confidence, ...extra.facts });
  };

  for (const ob of a.objects) {
    const unused = cat.rules.retireObjectsWithoutRecords && ob.records === 0 ? 'No records in the org.' : null;
    push('Custom object', ob.name, capOfObject(ob.name), { unused, facts: { records: ob.records, fields: ob.fields.length } });
  }
  for (const so of a.extended) for (const f of so.fields) {
    const name = `${so.name}.${f.name}`;
    const unused = f.fill != null && f.fill < cat.rules.retireWhenFillBelow && so.records > 0 ? `Filled on ${f.fill}% of ${so.records} records.` : null;
    push('Custom field', name, byKey('fields', name), { unused, facts: { fill: f.fill, type: f.type } });
  }
  for (const c of a.automation.classes.filter((x) => !x.test)) {
    const byName = byKey('classes', c.name);
    const cap = byName || (c.objects.length ? capOfObject(c.objects[0]) : null);
    push('Apex class', c.name, cap, { via: byName ? 'name' : 'objects', facts: { lines: c.lines, objects: c.objects } });
    // Code nothing live calls is dead, whatever its capability: remove it rather than move it.
    if (c.unreferenced) Object.assign(items[items.length - 1], { verdict: 'retire', reason: 'No active trigger or class calls it and it is not an entry point (screen, flow, batch, schedule or API).', confidence: 'High' });
  }
  for (const t of a.automation.triggers) {
    const byName = byKey('triggers', t.name);
    const cap = byName || capOfObject(t.object);
    push('Apex trigger', t.name, cap, { via: byName ? 'name' : 'objects', unused: t.active ? null : 'Inactive.', facts: { object: t.object, lines: t.lines } });
  }
  for (const fl of a.automation.flows) {
    const obj = a.objects.find((x) => x.label === fl.object)?.name;
    const cap = obj ? capOfObject(obj) : null;
    // A flow is already configuration: it stays unless its capability moves to a standard feature.
    const base = cap ? { ...cap, verdict: cap.verdict === 'adopt' ? 'adopt' : 'retain' } : { id: null, verdict: 'retain', standard: 'Already configuration (Flow); retain and document.' };
    push('Flow', fl.name, base.id ? base : null, { via: 'objects', unused: fl.active ? null : 'Inactive.', facts: { object: fl.object } });
    if (!base.id) Object.assign(items[items.length - 1], { verdict: fl.active ? 'retain' : 'retire', reason: base.standard, confidence: 'Medium' });
    if (fl.kind === 'Workflow' && fl.active) Object.assign(items[items.length - 1], { verdict: 'configure', reason: RETIRED_AUTOMATION, confidence: 'High' });
  }
  for (const w of a.automation.workflowRules || []) push('Workflow rule', `${w.object}.${w.name}`, capOfObject(w.object), { facts: { object: w.object } });
  for (const i of items.filter((x) => x.kind === 'Workflow rule')) Object.assign(i, { verdict: 'configure', reason: RETIRED_AUTOMATION, confidence: 'High' });
  for (const vr of a.automation.validationRules) {
    const cap = capOfObject(vr.object) || caps.find((c) => c.re.fields && [...(a.extended.find((s) => s.name === vr.object)?.fields || [])].some((f) => c.re.fields.test(`${vr.object}.${f.name}`) && new RegExp(f.name.replace(/__c$/, '').split('_')[0], 'i').test(vr.name)));
    push('Validation rule', `${vr.object}.${vr.name}`, cap, { unused: vr.active ? null : 'Inactive.', facts: { object: vr.object } });
  }
  for (const p of a.packages) push('Installed package', p.name, byKey('packages', p.name), {});
  return items;
}

const items = extracted.flatMap(classify);

// Harmonise: a need that would be retained is built with different custom objects in two or more orgs. The orgs
// stay separate; only the pattern is aligned.
const objectSets = (capId) => new Set(extracted.map((o) => items.filter((i) => i.org === o.region && i.capability === capId && i.kind === 'Custom object').map((i) => i.name).sort().join('+')).filter(Boolean));
const builtDifferently = Object.fromEntries(cat.capabilities.map((c) => [c.id, objectSets(c.id).size > 1]));
const capVerdict = (c) => (c.verdict === 'retain' && builtDifferently[c.id] ? 'harmonise' : c.verdict);
for (const i of items) if (i.verdict === 'retain' && i.capability && builtDifferently[i.capability]) i.verdict = 'harmonise';

// The decision register fields of the proposal: layer, effort, where, priority, impact and decision owner.
const capById = Object.fromEntries(cat.capabilities.map((c) => [c.id, c]));
const effortOf = (i) => {
  if (i.verdict === 'retire' || i.verdict === 'review') return 'Low';
  if (['Custom field', 'Validation rule', 'Flow', 'Workflow rule'].includes(i.kind)) return 'Low';
  if (/Apex/.test(i.kind)) return (i.lines || 0) <= 80 ? 'Low' : (i.lines || 0) <= 300 ? 'Medium' : 'High';
  if (i.kind === 'Custom object') return (i.records || 0) > 1000 || (i.fields || 0) > 15 ? 'High' : 'Medium';
  return 'Medium';
};
const PRIORITY = { retire: 'Quick win', configure: 'Quick win', review: 'Immediate', adopt: 'Medium term', harmonise: 'Medium term', retain: 'Strategic' };
const IMPACT = {
  adopt: 'Less custom build to maintain; new Salesforce and Consumer Goods Cloud features become available.',
  configure: 'The business changes the rule as a setting, without a developer or a release.',
  retain: 'Kept as valuable differentiation; documented and supported.',
  harmonise: 'One pattern for the same need across regions; simpler reporting and support, orgs stay separate.',
  retire: 'Less clutter; nothing unused is maintained or migrated.',
  review: 'Purpose, usage or licensing to confirm before a verdict.',
};
const labelOf = (r) => orgs.find((o) => o.region === r)?.label || r;
const orgList = (rs) => (rs.length > 1 ? `${rs.slice(0, -1).join(', ')} and ${rs[rs.length - 1]} orgs` : `${rs[0]} org`);
for (const i of items) {
  const cap = i.capability ? capById[i.capability] : null;
  i.layer = i.kind === 'Installed package' ? 'Installed package' : 'Custom';
  i.effort = effortOf(i);
  i.priority = PRIORITY[i.verdict];
  i.impact = IMPACT[i.verdict];
  i.where = orgList(i.capability ? [...new Set(items.filter((x) => x.capability === i.capability).map((x) => labelOf(x.org)))] : [labelOf(i.org)]);
  i.decisionOwner = cap ? `${cap.area} owner (to confirm)` : 'Product owner (to confirm)';
}

// Fitment per capability and org, in the proposal's codes. Nothing custom found means the standard is used as is.
const FITMENT = { NS: 'Native standard', CS: 'Configured standard', ES: 'Extended standard', DC: 'Differentiating custom', TD: 'Technical-debt candidate', RV: 'Requires validation' };
function fitmentOf(region, capId) {
  const xs = items.filter((i) => i.org === region && (capId ? i.capability === capId : !i.capability));
  if (!xs.length) return 'NS';
  if (!capId || xs.some((i) => i.verdict === 'review')) return 'RV';
  const v = capVerdict(capById[capId]);
  if (xs.some((i) => i.kind === 'Custom object' || /Apex/.test(i.kind))) return v === 'retain' || v === 'harmonise' ? 'DC' : 'TD';
  if (xs.some((i) => i.kind === 'Custom field')) return 'ES';
  return 'CS';
}

/* ---------------------------------------------------------------- function-level fit-gap (kb/fit-gap-method.md) */

// Each trigger with the handler methods it reaches is one component ("Trigger + handlers"); classes no trigger
// reaches stand alone. Every component is split into the business functions it does, each judged on its own.
const MOVES = new Set(['adopt', 'configure', 'retire']);
const { CHECKS } = require('./apex-functions');
const CHECK_DETAIL = Object.fromEntries(CHECKS.map((c) => [c.id, c.detail]));
const lvl = (n, lo, hi) => (n <= lo ? 'Low' : n <= hi ? 'Medium' : 'High');
const words = (s) => String(s || '').replace(/__c$/, '').replace(/_/g, ' ');

function functionFitGap(o) {
  const a = o.asIs;
  const cls = Object.fromEntries(a.automation.classes.filter((c) => !c.test && c.analysis).map((c) => [c.name, c]));
  if (!Object.keys(cls).length && !a.automation.triggers.some((t) => t.analysis)) return null;
  const itemOf = (kind, name) => items.find((i) => i.org === o.region && i.kind === kind && i.name === name);
  // A rule, calculation or record creation on a capability that a standard feature covers moves with that feature.
  const judge = (fn, item, component) => {
    const cap = item?.capability ? capById[item.capability] : null;
    const out = { ...fn, component };
    if (cap?.verdict === 'adopt' && ['check', 'create', 'calc'].includes(fn.kind)) Object.assign(out, { verdict: 'adopt', confidence: 'Medium', why: `Covered by the standard feature: ${cap.standard}.` });
    return out;
  };
  const reach = (c, start) => { const seen = new Set(); const go = (m) => { if (seen.has(m)) return; seen.add(m); (c.analysis.methodInfo.find((x) => x.name === m)?.local || []).forEach(go); }; start.forEach(go); return seen; };
  const reached = Object.fromEntries(Object.keys(cls).map((n) => [n, new Set()]));
  const triggerOn = Object.fromEntries(a.automation.triggers.filter((t) => t.active).map((t) => [t.object, t.name]));
  const comps = [];

  const L = (r) => (r ? (r[0] === r[1] ? `L${r[0]}` : `L${r[0]}–${r[1]}`) : '');
  const info = (c, m) => cls[c].analysis.methodInfo.find((x) => x.name === m);
  const ref = (c, m) => `${c}.${m} ${L(info(c, m)?.lines)}`.trim();
  // Where moved logic lands in Salesforce's save order (kb/fit-gap-method.md): step numbers of one record save.
  const LAND = { status: 2, calc: 2, rule: 4, check: 4, approval: 11, chatter: 11, email: 11, create: 11, rollup: 12, integration: 15 };
  const STAYS = new Set(['retain', 'review', 'harmonise']);

  for (const t of a.automation.triggers) {
    const tItem = itemOf('Apex trigger', t.name);
    // Each call the trigger makes into a handler is one step; steps run before the save, then after, in code order.
    const seen = new Set();
    const steps = (t.analysis?.calls || []).filter((x) => cls[x.to.split('.')[0]]).map((x) => {
      const [c, m] = x.to.split('.');
      const set = reach(cls[c], [m]);
      set.forEach((mm) => reached[c].add(mm));
      const own = [...set].filter((mm) => !seen.has(`${c}.${mm}`));
      own.forEach((mm) => seen.add(`${c}.${mm}`));
      const fields = { reads: new Set(), writes: new Set() };
      for (const mm of set) { const i = info(c, mm); i?.fields?.reads.forEach((f) => fields.reads.add(f)); i?.fields?.writes.forEach((f) => fields.writes.add(f)); }
      const call = `${t.name} L${x.line}${x.phase ? ` (${x.phase}${x.insert === true ? ' insert' : x.insert === false ? ' update' : ''})` : ''}`;
      const functions = cls[c].analysis.functions.filter((f) => own.includes(f.method))
        .map((f) => ({ ...judge(f, itemOf('Apex class', c), c), ref: `${call} → ${ref(c, f.method)}`, phase: x.phase }));
      return { to: x.to, line: x.line, phase: x.phase, insert: x.insert, set, cls: c, fields, functions, call };
    }).sort((p, q) => ({ before: 0, after: 1 }[p.phase] ?? 0.5) - ({ before: 0, after: 1 }[q.phase] ?? 0.5) || p.line - q.line);
    steps.forEach((s, n) => { s.order = n + 1; s.functions.forEach((f) => { f.step = n + 1; }); });

    // Chains inside the component: a later step reads what an earlier step writes in the same save.
    const links = [];
    for (let p = 0; p < steps.length; p++) for (let q = p + 1; q < steps.length; q++) {
      const A = steps[p], B = steps[q];
      if (A.insert !== undefined && B.insert !== undefined && A.insert !== B.insert) continue;
      const shared = [...A.fields.writes].filter((f) => B.fields.reads.has(f));
      if (shared.length) links.push({ from: A, to: B, fields: shared });
    }
    for (const lk of links) {
      const consumerStays = !lk.to.functions.length || lk.to.functions.some((f) => STAYS.has(f.verdict));
      const consumerStep = lk.to.phase === 'before' ? 3 : 7;
      [...lk.from.functions, ...lk.to.functions].forEach((f) => { f.sequenceSensitive = true; });
      const producers = lk.from.functions.filter((f) => (info(f.component, f.method)?.fields?.writes || []).some((w) => lk.fields.includes(w)));
      for (const f of (producers.length ? producers : lk.from.functions)) {
        if (!MOVES.has(f.verdict) || f.verdict === 'retire' || !consumerStays || (LAND[f.kind] || 11) <= consumerStep) continue;
        f.verdict = 'retain';
        f.cannotMoveAlone = true;
        f.why = `Can't move alone: ${lk.to.to} (Apex that stays, ${lk.to.phase || 'in the trigger'}) uses its result (${lk.fields.map(words).join(', ')}) in the same save, and the moved logic would run after it. Move as a group or keep. Otherwise: ${f.why}`;
      }
    }
    const chainsInside = links.map((lk) => ({
      from: `${lk.from.to} (step ${lk.from.order})`, to: `${lk.to.to} (step ${lk.to.order})`, fields: lk.fields,
      text: `${lk.from.to} writes ${lk.fields.map(words).join(', ')}, which ${lk.to.to} reads later in the same save (${lk.from.call} → ${lk.to.call}).`,
    }));

    const functions = [...(t.analysis?.functions || []).map((f) => ({ ...judge(f, tItem, t.name), ref: `${t.name} ${L(f.lines)}` })), ...steps.flatMap((s) => s.functions)];
    if (!t.active) functions.unshift({ kind: 'dead', what: 'Inactive trigger, still in the code', verdict: 'retire', confidence: 'High', why: 'The trigger is inactive; remove it and any handler only it calls, after confirming its status in the org.', method: '(trigger)', component: t.name, ref: `${t.name} L1–${t.lines}` });
    const handlers = [...new Set(steps.map((s) => s.cls))];
    const writes = [...new Set(steps.flatMap((s) => [...s.set].flatMap((m) => info(s.cls, m)?.writes || [])))].filter((w) => w !== t.object);
    comps.push({ id: `trg-${t.name}`, name: t.name, title: `${words(t.object)} triggers and handlers`, kind: 'Trigger + handlers', object: t.object, members: [t.name, ...handlers],
      versions: [t, ...handlers.map((h) => cls[h])].map((x) => ({ name: x.name, apiVersion: x.apiVersion, modified: x.modified })), events: t.analysis?.events || [],
      steps: steps.map((s) => ({ order: s.order, call: s.call, to: s.to, reads: [...s.fields.reads], writes: [...s.fields.writes], functions: s.functions.length })), chainsInside,
      lines: t.lines + handlers.reduce((n, h) => n + (cls[h].lines || 0), 0), files: 1 + handlers.length, functions, writes, capability: tItem?.capability || null,
      issues: [...(t.analysis?.issues || []), ...handlers.flatMap((h) => cls[h].analysis.issues.map((x) => ({ ...x, in: h })))], active: t.active, callout: handlers.some((h) => cls[h].callout) });
  }
  for (const c of Object.values(cls)) {
    const rest = c.analysis.functions.filter((f) => !reached[c.name].has(f.method));
    const touchedByTrigger = reached[c.name].size > 0;
    if (touchedByTrigger && !rest.length) continue;
    const item = itemOf('Apex class', c.name);
    // Dead code is one decision: remove it. Its inner jobs are not judged.
    const functions = c.unreferenced ? [] : rest.map((f) => ({ ...judge(f, item, c.name), ref: ref(c.name, f.method) }));
    if (c.unreferenced) functions.unshift({ kind: 'dead', what: 'Whole class: no live code calls it', verdict: 'retire', confidence: 'High', why: 'Not called by any active trigger or class and not an entry point (screen, flow, batch, schedule or API). Remove it with its test after confirming in the org.', method: '(class)', component: c.name, ref: `${c.name} L1–${c.lines}` });
    if (!functions.length) continue;
    comps.push({ id: `cls-${c.name}`, name: c.name, title: c.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'), kind: 'Apex class', object: c.objects[0] || null, members: [c.name], lines: c.lines, files: 1,
      versions: [{ name: c.name, apiVersion: c.apiVersion, modified: c.modified }], steps: [], chainsInside: [],
      functions, writes: [...new Set(c.analysis.methodInfo.flatMap((m) => m.writes))], capability: item?.capability || null, issues: c.analysis.issues.map((x) => ({ ...x, in: c.name })), dead: !!c.unreferenced, callout: c.callout });
  }

  for (const k of comps) {
    const n = k.functions.length;
    const moves = k.functions.filter((f) => MOVES.has(f.verdict)).length;
    k.canMove = moves;
    k.overall = k.dead || (k.active === false) ? 'Retire' : moves === n ? 'Can move' : moves === 0 ? (k.functions.some((f) => f.verdict === 'review') ? 'Keep / review' : 'Keep') : 'Partly standard';
    k.effort = k.dead ? 'Low' : n >= 6 ? 'High' : lvl(k.lines, 60, 200);
    if (k.overall === 'Partly standard' && k.effort === 'Low') k.effort = 'Medium'; // a split component is never a small change
    const chained = k.writes.some((w) => triggerOn[w]);
    k.sequenceSensitive = k.functions.some((f) => f.sequenceSensitive);
    k.regression = k.dead ? 'Low' : chained || k.sequenceSensitive || (k.callout && moves) ? 'High' : k.writes.length || k.kind === 'Trigger + handlers' ? 'Medium' : 'Low';
    // What to retest when anything here moves: the whole business flow, not just the one object.
    k.retest = k.dead ? `Nothing runs it: confirm no screen, flow or job calls ${k.name}, then remove it with its test.`
      : [`Save ${words(k.object || k.name)} end to end${k.events?.length ? ` (${k.events.join(', ')})` : ''}`,
        ...k.writes.map((w) => `the ${words(w)} records it updates${triggerOn[w] ? `, and ${triggerOn[w]} that this fires` : ''}`),
        ...(k.functions.some((f) => f.kind === 'email' || f.kind === 'chatter') ? ['notifications and Chatter posts'] : []),
        ...(k.callout ? ['the outbound integration call'] : [])].join('; ') + '.';
    k.value = moves >= 3 ? 'High' : moves >= 1 ? 'Medium' : 'Low';
    const cap = k.capability ? capById[k.capability] : null;
    k.area = cap?.area || 'Other';
    k.summary = `${n} business function${n === 1 ? '' : 's'}${k.members.length > 1 ? ` across ${k.members.join(', ')}` : ''}: ${[...new Set(k.functions.map((f) => f.what.toLowerCase()))].slice(0, 4).join('; ')}${n > 4 ? '; …' : ''}.`;
  }
  comps.sort((x, y) => y.lines - x.lines);

  const fns = comps.flatMap((k) => k.functions);
  const count = (v) => fns.filter((f) => f.verdict === v).length;
  // Quick wins: self-contained jobs (nothing else depends on their order) that move to configuration or a
  // standard setting without a licence, or dead code that can go.
  const SELF_CONTAINED = new Set(['chatter', 'email', 'status', 'rule', 'calc', 'dead']);
  const quickWins = comps.flatMap((k) => k.functions.filter((f) => SELF_CONTAINED.has(f.kind) && !f.sequenceSensitive && (f.verdict === 'configure' || f.verdict === 'retire' || (f.verdict === 'adopt' && f.kind === 'email')))
    .map((f) => ({ what: f.what, component: f.component, verdict: f.verdict, replaceWith: f.why, effort: 'Low', regression: f.kind === 'status' || k.regression === 'Low' ? 'Low' : 'Medium' })));
  // Cross-cutting findings: the same risky pattern wherever it appears.
  const xc = {};
  for (const k of comps) for (const i of k.issues) { const e = (xc[i.id] = xc[i.id] || { id: i.id, title: i.title, severity: i.severity, detail: CHECK_DETAIL[i.id] || '', where: [] }); e.where.push(i.in || k.name); if (i.where) e.detail = `${e.detail || 'Methods over 150 lines are hard to test and change safely.'} ${i.where.join(', ')}.`.trim(); }
  const dead = comps.filter((k) => k.overall === 'Retire');
  if (dead.length) xc.dead = { id: 'dead', title: 'Dead code that looks live', severity: 'Medium', detail: 'Code no live trigger or class calls is still deployed; readers and tools can mistake it for live logic.', where: dead.map((k) => k.name) };
  const crossCutting = Object.values(xc).map((x) => ({ ...x, where: [...new Set(x.where)] })).sort((p, q) => ['High', 'Medium', 'Low'].indexOf(p.severity) - ['High', 'Medium', 'Low'].indexOf(q.severity));
  // Order of execution: a save that writes another object fires that object's trigger; such steps move together.
  const chains = comps.filter((k) => k.kind === 'Trigger + handlers').flatMap((k) => k.writes.filter((w) => triggerOn[w]).map((w) => ({
    from: k.object, to: w, via: k.name, fires: triggerOn[w],
    text: `Saving ${words(k.object)} updates ${words(w)} (${k.functions.filter((f) => f.kind === 'rollup' || f.kind === 'create').map((f) => f.what.toLowerCase()).join('; ') || 'through its handlers'}), which fires ${triggerOn[w]}. Move these steps together, or keep them together.`,
  })));
  const integrations = fns.filter((f) => f.kind === 'integration').map((f) => f.component);
  const messages = [
    `${count('adopt') + count('configure')} of ${fns.length} functions could move to standard features or configuration; ${count('retain')} stay custom${count('retire') ? `, ${count('retire')} can be retired` : ''}.`,
    integrations.length ? `Integrations stay custom: ${[...new Set(integrations)].join(', ')}. They can still be simplified (named credential, retries through a queue or platform event).` : null,
    quickWins.length ? `${quickWins.length} quick win${quickWins.length === 1 ? '' : 's'} with low effort and contained regression: ${[...new Set(quickWins.map((q) => q.what.toLowerCase()))].slice(0, 3).join('; ')}.` : null,
    chains.length ? `Order of execution matters in ${chains.length} place${chains.length === 1 ? '' : 's'}: ${chains.map((c) => `${words(c.from)} → ${words(c.to)}`).join(', ')}. Steps that depend on each other move together.` : null,
    comps.some((k) => k.chainsInside.length) ? `Sequence-sensitive inside ${comps.filter((k) => k.chainsInside.length).map((k) => k.title).join(', ')}: later steps use results of earlier ones in the same save${fns.some((f) => f.cannotMoveAlone) ? `; ${fns.filter((f) => f.cannotMoveAlone).length} function(s) cannot move alone` : ''}.` : null,
    crossCutting.length ? `Structural risks: ${crossCutting.slice(0, 3).map((c) => c.title.toLowerCase()).join('; ')}.` : null,
  ].filter(Boolean);
  return {
    region: o.region,
    totals: { components: comps.length, classes: comps.filter((k) => k.kind === 'Apex class').length, triggerGroups: comps.filter((k) => k.kind === 'Trigger + handlers').length,
      lines: comps.reduce((n, k) => n + k.lines, 0), files: comps.reduce((n, k) => n + k.files, 0), functions: fns.length, canMove: count('adopt') + count('configure') + count('retire'),
      verdicts: Object.fromEntries(VERDICTS.map((v) => [v, count(v)])), confidence: Object.fromEntries(['High', 'Medium', 'Low'].map((c) => [c, fns.filter((f) => f.confidence === c).length])) },
    messages, quickWins, crossCutting, chains, components: comps,
  };
}

/* ---------------------------------------------------------------- summarise */

const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);
const orgSummary = orgs.map((o) => {
  if (!o.asIs) return { region: o.region, label: o.label, extracted: false };
  const a = o.asIs;
  const mine = items.filter((i) => i.org === o.region);
  return {
    region: o.region, label: o.label, extracted: true, edition: a.org.edition,
    markets: a.markets,
    counts: {
      customObjects: a.objects.length,
      customFields: sum(a.objects, (x) => x.fields.length) + sum(a.extended, (x) => x.fields.length),
      fieldsOnStandard: sum(a.extended, (x) => x.fields.length),
      apexClasses: a.automation.classes.filter((c) => !c.test).length,
      apexTests: a.automation.classes.filter((c) => c.test).length,
      apexLines: sum(a.automation.classes.filter((c) => !c.test), (c) => c.lines) + sum(a.automation.triggers, (t) => t.lines),
      triggers: a.automation.triggers.length,
      flows: a.automation.flows.length,
      validationRules: a.automation.validationRules.length,
      packages: a.packages.length,
      customRecords: sum(a.objects, (x) => x.records),
      activeUsers: a.usage.activeUsers,
      reports: a.usage.reports,
    },
    integrations: a.integrations,
    objects: a.objects.map((x) => ({ name: x.name, label: x.label, records: x.records, fields: x.fields.length })),
    verdicts: Object.fromEntries(VERDICTS.map((v) => [v, mine.filter((i) => i.verdict === v).length])),
  };
});

const capabilityMatrix = cat.capabilities.map((c) => {
  const perOrg = Object.fromEntries(extracted.map((o) => [o.region, items.filter((i) => i.org === o.region && i.capability === c.id).map((i) => i.name)]));
  const objectsPerOrg = extracted.map((o) => items.filter((i) => i.org === o.region && i.capability === c.id && i.kind === 'Custom object').map((i) => i.name).sort().join('+')).filter(Boolean);
  const inOrgs = Object.values(perOrg).filter((x) => x.length).length;
  return { id: c.id, area: c.area, capability: c.capability, verdict: capVerdict(c), standard: c.standard, licence: c.licence, reference: c.reference, perOrg, inOrgs, builtDifferently: new Set(objectsPerOrg).size > 1,
    fitment: Object.fromEntries(extracted.map((o) => [o.region, fitmentOf(o.region, c.id)])) };
}).filter((c) => c.inOrgs > 0);
// Components that match no capability form one row of their own: they need validation.
const unmatched = { area: 'Other', capability: 'Not matched to a capability', fitment: Object.fromEntries(extracted.map((o) => [o.region, fitmentOf(o.region, null)])) };

/* ---------------------------------------------------------------- roll-up to sub-processes */

// Low-level findings (custom objects, fields, validation rules, the functions in the Apex code) roll up to the
// sub-process they serve, so the heatmap reads area → process → sub-process. A finding goes to the first
// sub-process whose pattern it matches; otherwise to the first sub-process of its own capability (fields only
// when named explicitly, so a sub-process is not filled with every field of an object).
const ffgByRegion = Object.fromEntries(extracted.map((o) => [o.region, functionFitGap(o)]).filter(([, x]) => x));
const SPS = cat.capabilities.flatMap((c) => (c.subprocesses || []).map((sp) => ({ ...sp, cap: c.id, re: Object.fromEntries(Object.entries(sp.match).map(([k, v]) => [k, new RegExp(v)])) })));
for (const row of capabilityMatrix) {
  const c = capById[row.id];
  if (c.subprocesses) row.subprocesses = c.subprocesses.map((sp) => ({ id: sp.id, name: sp.name, fitment: {}, evidence: {} }));
}
// Fitment of a sub-process, in the proposal's codes, from what was found in it.
function spCode(us) {
  if (!us.length) return 'NS';
  if (us.some((u) => u.verdict === 'review')) return 'RV';
  const built = us.filter((u) => u.kind === 'Custom object' || u.kind === 'Function');
  if (built.some((u) => ['adopt', 'configure', 'retire'].includes(u.verdict))) return 'TD';
  if (built.length) return 'DC';
  if (us.some((u) => u.kind === 'Custom field')) return 'ES';
  return 'CS';
}
for (const o of extracted) {
  const a = o.asIs;
  const mine = items.filter((i) => i.org === o.region);
  const unit = (i, keys, extra = {}) => ({ kind: i.kind, name: i.name, keys, verdict: i.verdict, why: i.reason, cap: i.capability, effort: i.effort, layer: i.layer, ref: i.name, ...extra });
  const units = [
    ...mine.filter((i) => i.kind === 'Custom object').map((i) => unit(i, { objects: [i.name] })),
    ...mine.filter((i) => i.kind === 'Validation rule').map((i) => unit(i, { rules: [i.name] })),
    ...mine.filter((i) => i.kind === 'Custom field').map((i) => unit(i, { fields: [i.name] }, { explicitOnly: true })),
  ];
  for (const ob of a.objects) {
    const oi = mine.find((i) => i.kind === 'Custom object' && i.name === ob.name);
    for (const f of ob.fields) units.push({ kind: 'Custom field', name: `${ob.name}.${f.name}`, keys: { fields: [`${ob.name}.${f.name}`] }, verdict: oi?.verdict || 'review',
      why: `Field added to ${words(ob.name)}${f.fill != null ? `, filled on ${f.fill}% of records` : ''}.`, cap: oi?.capability || null, effort: 'Low', layer: 'Custom', ref: `${ob.name}.${f.name}`, explicitOnly: true });
  }
  const clsInfo = Object.fromEntries(a.automation.classes.map((c) => [c.name, c]));
  for (const k of ffgByRegion[o.region]?.components || []) for (const f of k.functions) {
    const whole = f.method.startsWith('(');
    const methods = whole ? (clsInfo[f.component]?.analysis?.methodInfo || []).map((m) => `${f.component}.${m.name}`) : [`${f.component}.${f.method}`];
    const ci = mine.find((i) => /Apex/.test(i.kind) && i.name === f.component);
    units.push({ kind: 'Function', name: f.what, keys: { methods, classes: [f.component] }, verdict: f.verdict, why: f.why, cap: ci?.capability || k.capability, effort: k.effort, layer: 'Custom',
      ref: f.ref || `${f.component}.${f.method}`, component: k.title, componentId: k.id, sequenceSensitive: !!f.sequenceSensitive });
  }
  const hit = (sp, u) => Object.entries(u.keys).some(([k, vs]) => sp.re[k] && vs.some((v) => sp.re[k].test(v)));
  for (const u of units) {
    const sp = SPS.find((s) => hit(s, u)) || (!u.explicitOnly && u.cap ? SPS.find((s) => s.cap === u.cap) : null);
    const row = sp && capabilityMatrix.find((r) => r.id === sp.cap)?.subprocesses?.find((x) => x.id === sp.id);
    if (!row) continue;
    const { keys, explicitOnly, cap, ...shown } = u;
    (row.evidence[o.region] = row.evidence[o.region] || []).push(shown);
  }
  for (const r of capabilityMatrix) for (const s of r.subprocesses || []) s.fitment[o.region] = spCode(s.evidence[o.region] || []);
}

const total = items.length;
const share = (v) => (total ? Math.round((items.filter((i) => i.verdict === v).length / total) * 100) : 0);
const marketsFound = sum(orgSummary.filter((o) => o.extracted), (o) => o.markets.length);
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
const differently = capabilityMatrix.filter((c) => c.builtDifferently);
const findings = [
  `${extracted.length} of ${orgs.length} orgs extracted; ${marketsFound} of ${eng.marketsExpected} markets found in the extracted orgs.`,
  `${n(total, 'custom component', 'custom components')} classified: ${VERDICTS.map((v) => `${share(v)}% ${V[v].toLowerCase()}`).join(', ')}.`,
  extracted.length > 1
    ? `${n(differently.length, 'business capability is', 'business capabilities are')} built in more than one org with different custom objects${differently.length ? ` (${differently.map((c) => c.capability.toLowerCase()).join(', ')})` : ''}.`
    : 'Cross-org comparison starts once a second org is extracted.',
  `${n(items.filter((i) => i.verdict === 'retire').length, 'component is', 'components are')} unused and can be retired before any move.`,
  `${n(items.filter((i) => i.verdict === 'review').length, 'component is', 'components are')} not matched to a known capability and ${items.filter((i) => i.verdict === 'review').length === 1 ? 'goes' : 'go'} on the workshop agenda.`,
];

const fitGap = {
  owner: 'Assessment agent', generatedBy: 'src/generators/emit-assessment.js',
  client: eng.client, sampleData: eng.sampleData, note: eng.note, marketsExpected: eng.marketsExpected,
  verdicts: V, fitmentCodes: FITMENT, findings, orgs: orgSummary, capabilities: capabilityMatrix, unmatched,
  functionFitGap: ffgByRegion,
  items: items.sort((a, b) => a.org.localeCompare(b.org) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
};

/* ---------------------------------------------------------------- report */

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const row = (cells) => `| ${cells.map(esc).join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const lbl = (r) => orgs.find((o) => o.region === r).label;
const ex = orgSummary.filter((o) => o.extracted);

const report = [
  `# ${eng.client}: Salesforce org assessment`, '',
  'Owner: Assessment agent · generated by `src/generators/emit-assessment.js` from the as-is extraction of each org. Do not edit; re-run the agent.', '',
  eng.sampleData ? `> ${eng.note}` : '', '',
  '## Summary', '', ...findings.map((f) => `- ${f}`), '',
  '## Orgs and markets', '',
  table(['Org', 'Status', 'Edition', 'Markets', 'Customers with a market'], orgSummary.map((o) => o.extracted
    ? [o.label, 'Extracted', o.edition, `${o.markets.length}: ${o.markets.map((m) => m.name).join(', ')}`, sum(o.markets, (m) => m.customers)]
    : [o.label, 'Not yet extracted', '', '', ''])), '',
  '## As-is: what each org has built', '',
  table(['Measure', ...ex.map((o) => o.label)], [
    ['Custom objects', ...ex.map((o) => o.counts.customObjects)],
    ['Custom fields (all objects)', ...ex.map((o) => o.counts.customFields)],
    ['Custom fields on standard objects', ...ex.map((o) => o.counts.fieldsOnStandard)],
    ['Apex classes (excluding tests)', ...ex.map((o) => o.counts.apexClasses)],
    ['Apex triggers', ...ex.map((o) => o.counts.triggers)],
    ['Lines of Apex (classes and triggers)', ...ex.map((o) => o.counts.apexLines)],
    ['Flows', ...ex.map((o) => o.counts.flows)],
    ['Validation rules', ...ex.map((o) => o.counts.validationRules)],
    ['Installed packages', ...ex.map((o) => o.counts.packages)],
    ['Records in custom objects', ...ex.map((o) => o.counts.customRecords)],
    ['Outbound integrations (Apex callouts)', ...ex.map((o) => o.integrations.calloutClasses.length)],
  ]), '',
  '## The same capability, built per org', '',
  'Each row is a business capability; each cell lists the components that implement it in that org. "Built differently" means two or more orgs use different custom objects for the same need.', '',
  table(['Area', 'Capability', ...ex.map((o) => o.label), 'Built differently', 'Standard feature', 'Verdict'], capabilityMatrix.map((c) => [
    c.area, c.capability, ...ex.map((o) => (c.perOrg[o.region] || []).join(', ') || '—'), c.builtDifferently ? 'Yes' : 'No', c.standard, V[c.verdict]])), '',
  '## Fitment heatmap', '',
  `Each org is assessed in its own implementation context. Codes: ${Object.entries(FITMENT).map(([k, v]) => `${k} ${v.toLowerCase()}`).join(', ')}. Customisation is not automatically technical debt; it becomes a concern when cost, complexity or risk is out of proportion to the business value.`, '',
  table(['Area', 'Capability / process', ...ex.map((o) => o.label)], [...capabilityMatrix, unmatched].map((c) => [c.area, c.capability, ...ex.map((o) => `${c.fitment[o.region]} ${FITMENT[c.fitment[o.region]].toLowerCase()}`)])), '',
  '## Fit-gap by org', '',
  table(['Disposition', ...ex.map((o) => o.label), 'All orgs'], VERDICTS.map((v) => [V[v], ...ex.map((o) => o.verdicts[v]), items.filter((i) => i.verdict === v).length])), '',
  ...VERDICTS.flatMap((v) => {
    const xs = items.filter((i) => i.verdict === v);
    if (!xs.length) return [];
    return [`### ${V[v]} (${xs.length})`, '', table(['Org', 'Type', 'Component', 'Why', 'Effort', 'Priority', 'Evidence confidence'], xs.map((i) => [lbl(i.org), i.kind, i.name, i.reason, i.effort, i.priority, i.confidence])), ''];
  }),
  '## Method and limits', '',
  '- Read-only: describe, SOQL counts and the Tooling API, with the permissions of one integration user per org. No record contents leave the org; the as-is files hold component names, counts and fill rates only.',
  '- Each component is matched to a capability by name, then by the objects its code reads or writes (`src/agents/assessment/capabilities.json`). The verdict is the capability\'s default, overridden to Retire when a component is unused (no records, field filled on under 1% of records, or inactive).',
  '- Not yet covered: page layouts and Lightning pages, reports and dashboards by usage, profiles and sharing, email templates. These are listed in the gap register of the Extraction agent for the migration and are added here in the next iteration.',
  '- Verdicts are proposals for the workshop. Licence fit (Consumer Goods Cloud, Trade Promotion Management, Revenue Cloud) is confirmed before any verdict becomes a decision.', '',
].join('\n');

/* ---------------------------------------------------------------- architecture */

const architecture = [
  `# ${eng.client}: assessment architecture and target direction`, '',
  'Owner: Assessment agent · generated by `src/generators/emit-assessment.js`. Do not edit; re-run the agent.', '',
  '## Principles', '',
  '1. **Standard before custom.** Each capability is first matched to a standard Salesforce or Consumer Goods Cloud feature; custom build stays only where no standard feature fits.',
  '2. **Configuration before code.** Approvals, roll-ups and thresholds move from Apex to configuration that the business can change without a release.',
  '3. **Harmonise patterns, keep the orgs.** Each org is assessed in its own context. Where regions solve the same need differently, the pattern is aligned while the orgs stay separate; consolidation is not an objective of Discovery.',
  '4. **Retire before you move.** Unused objects, fields and automation are removed first; nothing unused is rebuilt.',
  '5. **Integrations through one layer.** Outbound calls use named credentials through the integration layer; no endpoints or secrets in code.',
  '6. **Minimum data, read-only.** One least-privilege integration user per org, on a full-copy sandbox; outputs hold configuration, names and counts, never record contents.',
  '7. **Reviewed and repeatable.** Every output is generated from the extraction, versioned, and approved at a review gate before it is used.', '',
  '## How the assessment runs', '',
  '```mermaid',
  'flowchart TB',
  '  subgraph Client["Full-copy sandboxes"]',
  ...orgs.map((o) => `    ${o.region}[("${o.label} org")]`),
  '  end',
  '  subgraph Boundary["Ascendion access-controlled environment"]',
  '    O["Discovery orchestrator"] --> X["Extraction"]',
  '    X --> BP["Business process"] & CC["Capability classification"] & DP["Dependency"] & TD["Technical debt"]',
  '    BP & CC & DP & TD --> FG["Fit-gap and recommendation"]',
  '    FG --> R{{"Architect review"}} --> H["Discovery Explorer<br/>and report"]',
  '    H --> E[("Engagement repository<br/>versioned")]',
  '  end',
  ...orgs.map((o) => `  ${o.region} -- "integration user<br/>read-only" --> X`),
  '  E --> W["Focused validation<br/>with process owners"]',
  '  W --> Hd["Handover,<br/>repository cleaned up"]',
  '```', '',
  '## How a verdict is reached', '',
  '```mermaid',
  'flowchart TD',
  '  A["Custom component"] --> U{"Used?<br/>records, fill rate, active"}',
  `  U -- "no" --> RT["${V.retire}"]`,
  '  U -- "yes" --> M{"Matches a known<br/>capability?"}',
  `  M -- "no" --> RV["${V.review}"]`,
  '  M -- "yes" --> S{"Standard feature<br/>covers it?"}',
  `  S -- "yes" --> AD["${V.adopt}"]`,
  '  S -- "partly" --> CF{"Logic expressible<br/>as configuration?"}',
  `  CF -- "yes" --> CO["${V.configure}"]`,
  '  CF -- "no" --> DF{"Built differently<br/>in other orgs?"}',
  `  DF -- "yes" --> HA["${V.harmonise}"]`,
  `  DF -- "no" --> KP["${V.retain}"]`,
  '```', '',
  'Every disposition is weighed on business value, standard fit, technical risk, change impact and evidence confidence, and confirmed by the decision owner.', '',
  '## Target direction', '',
  'Each regional org stays a separate org, assessed in its own implementation context. Discovery points each org towards standard Salesforce and Consumer Goods Cloud capability, moves rules from code to configuration, and aligns patterns that regions built differently. Cross-org patterns are surfaced as insights; consolidation of the orgs is not an objective.', '',
  '```mermaid',
  'flowchart TB',
  '  subgraph Orgs["Regional orgs, kept separate"]',
  ...orgs.map((o) => `    T${o.region}["${o.label}"]`),
  '  end',
  '  STD["Standard Salesforce and<br/>Consumer Goods Cloud capability"] -- "adopt" --> Orgs',
  '  CFG["Configuration the business owns:<br/>approvals, roll-ups, value sets"] -- "replace code" --> Orgs',
  '  PAT["Shared patterns and naming<br/>for the same need"] -. "harmonise" .-> Orgs',
  '  Orgs <--> API["Integration layer<br/>named credentials"]',
  '  API <--> ERP[("ERP:<br/>orders, credit")]',
  '  API <--> DIST[("Distributor feeds:<br/>stock, claims")]',
  '```', '',
  '## What happens to each disposition', '',
  table(['Disposition', 'What follows', 'Components'], VERDICTS.map((v) => [V[v], { adopt: 'Use the native Salesforce or Consumer Goods Cloud capability', configure: 'Remove custom code; use supported configuration', retain: 'Keep as valuable, supportable differentiation', harmonise: 'Align the pattern across orgs while retaining separate orgs', retire: 'Remove unused, duplicated or obsolete components', review: 'Validate intent, regulatory context, usage or licensing' }[v], items.filter((i) => i.verdict === v).length])), '',
].join('\n');

/* ---------------------------------------------------------------- write */

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'fit-gap.json'), `${JSON.stringify(fitGap, null, 2)}\n`);
fs.writeFileSync(path.join(DIR, 'assessment-report.md'), report);
fs.writeFileSync(path.join(DIR, 'architecture.md'), architecture);

const bundle = { ...fitGap, report, architecture };
// On the Org Compiler server the bundle is a file served to the console; in the repository it is embedded in it.
if (process.env.BUNDLE_DIR) fs.writeFileSync(path.join(process.env.BUNDLE_DIR, 'assessment-bundle.json'), JSON.stringify(bundle));
else if (fs.existsSync(P.CONSOLE)) {
  let html = fs.readFileSync(P.CONSOLE, 'utf8');
  const a = html.indexOf('/*ASSESS-START*/'), b = html.indexOf('/*ASSESS-END*/');
  if (a >= 0 && b > a) {
    html = html.slice(0, a + 16) + JSON.stringify(bundle).replace(/<\//g, '<\\/') + html.slice(b);
    fs.writeFileSync(P.CONSOLE, html);
  }
}
console.log(`assessment: ${extracted.length}/${orgs.length} orgs, ${total} components classified (${VERDICTS.map((v) => `${v} ${items.filter((i) => i.verdict === v).length}`).join(', ')}), ${capabilityMatrix.length} capabilities -> ${P.rel(DIR)}`);
