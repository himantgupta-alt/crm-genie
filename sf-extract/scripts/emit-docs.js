// Design documents from the blueprint: a high-level design (HLD) and a low-level design (LLD), each with
// Mermaid diagrams derived from the org's own metadata. Local files only; no org connection.
//
//   node scripts/emit-docs.js
//
//   docs/HLD.md, docs/LLD.md        readable documents (diagrams render on GitHub and in Org Compiler)
//   docs/diagrams/*.mmd             one Mermaid source per diagram
//   docs/docs.json                  the same content bundled for the Org Compiler console
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const bp = JSON.parse(fs.readFileSync(path.join(ROOT, 'blueprint', 'blueprint.json'), 'utf8'));
const apex = JSON.parse(fs.readFileSync(path.join(ROOT, 'output', 'logic', 'apex.json'), 'utf8'));
const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'agents', 'workflow.json'), 'utf8'));
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return d; } };
const cases = readJson('target/parity/cases.json', { cases: [] });
const globalRoot = execSync('npm root -g').toString().trim();
const { XMLParser } = require(path.join(globalRoot, '@salesforce/cli/node_modules/fast-xml-parser'));

const FAMILY = ['Account', 'Contact', 'Opportunity', 'Product2', 'Subscription__c', 'Subscription_Line__c'];
const CORE = ['Subscription__c', 'Subscription_Line__c'];
const ent = Object.fromEntries(bp.entities.filter((e) => FAMILY.includes(e.source)).map((e) => [e.source, e]));
const label = (s) => ent[s]?.label || s.replace(/__c$/, '').replace(/_/g, ' ');
const pascal = (s) => label(s).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
const q = (s) => String(s).replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
const nid = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_');
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const fence = (m) => ['```mermaid', m.trim(), '```'].join('\n');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)].join('\n');
const masked = (who) => (/@/.test(who || '') ? 'assigned user' : who || 'queue');

const STRATEGY = {
  check: 'CHECK constraint on the table',
  write_guard: 'BEFORE trigger guard (needs the previous row)',
  generated_column: 'generated column, stored',
  view_join: 'view that joins the parent records',
  compute_on_read: 'computed when read (depends on today’s date)',
  trigger_maintained: 'column kept current by triggers, with a recompute job',
  trigger_dispatch: 'service hook in the same transaction',
  cron_worker: 'scheduled worker job',
  service_hook: 'rule engine hook in the service layer',
};

const D = {}; // diagram name -> mermaid source

// ---------------------------------------------------------------- architecture (from agents/workflow.json)
{
  const lines = ['flowchart LR', '  SF[("Salesforce org<br/>metadata and data")]'];
  let prev = 'SF';
  workflow.phases.forEach((p, i) => {
    const agents = p.agents.length ? p.agents.map((a) => q(a.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()))).join('<br/>') : 'CI/CD pipeline';
    lines.push(`  P${i}["${q(`${i + 1} ${p.title}`)}<br/><small>${agents}</small>"]`);
    lines.push(`  ${prev} --> P${i}`);
    prev = `P${i}`;
  });
  lines.push('  P5 --> AZ[("Azure<br/>PostgreSQL + App Service")]', '  P4 -. "fails" .-> R["Repair agent"] -. "fix, after approval" .-> P2');
  lines.push('  classDef phase fill:#F3F1FC,stroke:#6666CC,color:#1F1F2E;', `  class ${workflow.phases.map((_, i) => `P${i}`).join(',')} phase;`);
  D.architecture = lines.join('\n');
}

// ---------------------------------------------------------------- data model
{
  const lines = ['erDiagram'];
  const used = new Set(JSON.stringify([bp.derivations, bp.constraints, bp.automations]).match(/[A-Za-z0-9_]+\.[A-Za-z0-9_]+/g) || []);
  const inFamily = (f) => f.relation && asArray(f.relation.to).length === 1 && FAMILY.includes(asArray(f.relation.to)[0]) && !/^(MasterRecordId|ParentId|ReportsToId)$/.test(f.source);
  const keep = (e) => e.fields.filter((f) => f.source === 'Id' || f.source === 'Name' || inFamily(f) || (f.source.endsWith('__c') && !f.system && !f.relation) || used.has(f.id)).slice(0, 10);
  for (const s of FAMILY) {
    const e = ent[s]; if (!e) continue;
    lines.push(`  ${pascal(s)} {`);
    for (const f of keep(e)) {
      const type = String(f.pg || f.type).replace(/\(.*\)/, '').replace(/[^A-Za-z0-9_]/g, '_');
      const k = f.source === 'Id' ? ' PK' : f.relation ? ' FK' : '';
      lines.push(`    ${type} ${f.name}${k}`);
    }
    lines.push('  }');
  }
  for (const r of bp.relations) {
    const from = r.from.entity, to = asArray(r.to);
    if (!FAMILY.includes(from) || to.length !== 1 || !FAMILY.includes(to[0]) || from === to[0]) continue;
    const md = r.kind === 'MasterDetail' || r.kind === 'master_detail' || r.cascade === 'cascade' || r.onDelete === 'cascade';
    const fl = (ent[from].fields.find((f) => f.id === r.from.field) || {}).label || r.from.field.split('.')[1];
    lines.push(`  ${pascal(to[0])} ${md ? '||--|{' : '|o--o{'} ${pascal(from)} : "${q(fl)}"`);
  }
  D.dataModel = lines.join('\n');
}

// ---------------------------------------------------------------- subscription lifecycle (picklist + rules)
{
  const st = ent.Subscription__c.fields.find((f) => f.source === 'Status__c');
  const values = st.picklist.values;
  const cons = bp.constraints.filter((c) => c.entity === 'Subscription__c');
  const lines = ['stateDiagram-v2', `  [*] --> ${nid(st.default || values[0])}`];
  const terminal = cons.some((c) => c.name === 'No_Reactivation_After_Cancel') ? 'Cancelled' : null;
  values.forEach((v, i) => { if (v !== terminal && values[i + 1] && values[i + 1] !== terminal) lines.push(`  ${nid(v)} --> ${nid(values[i + 1])}`); });
  if (values.includes('Suspended') && values.includes('Active')) lines.push('  Suspended --> Active');
  const reached = new Set([st.default || values[0], ...lines.map((l) => (l.match(/--> (\w+)$/) || [])[1]).filter(Boolean)]);
  values.filter((v) => v !== terminal && !reached.has(v)).forEach((v) => lines.push(`  ${nid(values[1] || values[0])} --> ${nid(v)}`, `  ${nid(v)} --> [*]`));
  if (terminal) { values.filter((v) => v !== terminal && v !== 'Renewed').forEach((v) => lines.push(`  ${nid(v)} --> ${terminal}`)); lines.push(`  ${terminal} --> [*]`); }
  const notes = {
    Active: cons.find((c) => c.name === 'Active_Requires_MRR') && 'needs MRR above zero',
    Cancelled: [cons.find((c) => c.name === 'Cancellation_Reason_Required') && 'needs a cancellation reason', terminal && 'cannot be reactivated'].filter(Boolean).join('<br/>'),
  };
  for (const [s, n] of Object.entries(notes)) if (n) lines.push(`  note right of ${s}`, `    ${n}`, '  end note');
  D.lifecycle = lines.join('\n');
}

// ---------------------------------------------------------------- processes from triggers, services and flows
const svc = Object.fromEntries(bp.services.map((s) => [s.source.name, s]));
const flows = bp.automations.filter((a) => a.source.kind === 'flow' && a.scope !== 'out_of_scope');
const triggers = bp.automations.filter((a) => a.source.kind === 'apexTrigger');
const constraintsOf = (e) => bp.constraints.filter((c) => c.entity === e && c.active !== false);
const rollupsInto = (e) => bp.derivations.filter((d) => d.kind === 'rollup' && d.entity === e);
const rollupsFrom = (e) => bp.derivations.filter((d) => d.kind === 'rollup' && JSON.stringify(d).includes(`"${e}`) && d.entity !== e);

function saveSequence(entity, title) {
  const T = triggers.filter((t) => t.trigger.entity === entity);
  const before = T.flatMap((t) => t.handlers.filter((h) => /applyDefaults|before/i.test(h) || t.trigger.events.every((e) => e.timing === 'before')));
  const after = T.flatMap((t) => t.handlers.filter((h) => !before.includes(h)));
  const F = flows.filter((f) => f.trigger?.entity === entity);
  const lines = ['sequenceDiagram', '  autonumber', '  actor U as User or integration', `  participant SF as ${label(entity)}`];
  const parts = new Set();
  const part = (n) => { if (!parts.has(n)) { parts.add(n); lines.push(`  participant ${nid(n)} as ${n}`); } };
  [...before, ...after].forEach((h) => part(h.split('.')[0]));
  lines.push(`  U->>SF: ${title}`);
  before.forEach((h) => lines.push(`  SF->>${nid(h.split('.')[0])}: before save: ${h.split('.')[1]}()`));
  const C = constraintsOf(entity);
  if (C.length) lines.push(`  SF->>SF: validation rules (${C.length})`, `  Note right of SF: ${C.map((c) => c.name.replace(/_/g, ' ')).join('<br/>')}`);
  after.forEach((h) => {
    const s = svc[h.split('.')[0]];
    lines.push(`  SF->>${nid(h.split('.')[0])}: after save: ${h.split('.')[1]}()`);
    if (s?.writes?.length) lines.push(`  ${nid(h.split('.')[0])}-->>SF: ${s.dml?.[0] || 'write'} ${s.writes.map(label).join(', ')}`);
  });
  F.forEach((f) => {
    part('Flow');
    lines.push(`  SF->>Flow: ${f.source.label}`, `  Note right of Flow: when ${q(f.trigger.conditionText.replace(/\{!\$Record\.([A-Za-z_]+)\}/g, '$1').replace(/ISPICKVAL\(([^,]+),\s*"([^"]+)"\)/g, '$1 = $2'))}`);
    (f.actions || []).forEach((a) => lines.push(`  Flow-->>SF: ${a.kind} ${label(a.entity)}`));
  });
  const R = rollupsFrom(entity);
  if (R.length) lines.push(`  SF->>SF: recalculate ${R.map((d) => d.field.split('.')[1].replace(/__c$/, '').replace(/_/g, ' ')).join(', ')} on ${label(R[0].entity)}`);
  lines.push('  SF-->>U: saved, or the first failing rule’s message');
  return lines.join('\n');
}
D.subscriptionSave = saveSequence('Subscription__c', 'create or update a subscription');
D.lineSave = saveSequence('Subscription_Line__c', 'add or change a subscription line');

{ // Opportunity won -> subscription
  const t = triggers.find((x) => x.trigger.entity === 'Opportunity');
  const s = svc.OpportunityService;
  const body = (apex.find((a) => a.name === 'OpportunityService') || {}).body || '';
  const idem = /Opportunity__c\s+IN|existing|already/i.test(body);
  D.opportunityToSubscription = ['sequenceDiagram', '  autonumber', '  actor Rep as Sales rep', '  participant O as Opportunity', '  participant S as OpportunityService', '  participant Sub as Subscription',
    '  Rep->>O: set stage to Closed Won', `  O->>S: ${t ? t.trigger.events.map((e) => `${e.timing} ${e.on}`).join(', ') : 'after update'}: ${s?.methods?.[0] || 'handle'}()`,
    ...(idem ? ['  S->>Sub: any subscription already created for this deal?', '  alt none yet'] : []),
    `  S->>Sub: insert subscription (term ${s?.constants?.DEFAULT_TERM_MONTHS || '?'} months)`, ...(idem ? ['  else already exists', '    S-->>O: skip (no duplicates)', '  end'] : []),
    '  Sub-->>Rep: subscription visible on the account'].join('\n');
}

{ // Renewal batch
  const j = bp.automations.find((a) => a.id === 'apex-job:SubscriptionRenewalBatch');
  const days = j?.constants?.NOTICE_WINDOW_DAYS || '?';
  D.renewalBatch = ['flowchart TD', '  A(["Nightly schedule"]) --> B["Find active subscriptions<br/>ending within ' + days + ' days"]', '  B --> C{"Any found?"}', '  C -- "yes" --> D["Create a renewal task<br/>for each owner"]', '  C -- "no" --> E(["Done"])', '  D --> E',
    '  classDef job fill:#EAFBF5,stroke:#2CDCAA,color:#1F1F2E;', '  class A,B,D job;'].join('\n');
}

function routing(id, title) {
  const a = bp.automations.find((x) => x.id === id);
  if (!a) return null;
  const lines = ['flowchart TD', `  S(["${q(title)}"])`];
  let prev = 'S';
  a.entries.forEach((e, i) => {
    const cond = e.criteria.map((c) => q(c.replace('US,USA,United States,United States of America', 'US').replace(/^(Account|Case|Lead)\./, '').replace(/__c\b/g, '').replace(/_/g, ' ').replace(/,(?=\S)/g, ', ').replace(/\b(equals|notEqual|contains)\b/g, (w) => ({ equals: '=', notEqual: '≠', contains: 'contains' }[w])))).join('<br/>');
    lines.push(`  C${i}{{"${cond}"}}`, `  ${prev} --> C${i}`);
    lines.push(`  C${i} -- "yes" --> R${i}["${q(e.assignedTo ? `assign to ${masked(e.assignedTo)}` : `escalate (rule ${i + 1})`)}"]`);
    prev = `C${i}`;
    if (i === a.entries.length - 1) lines.push(`  C${i} -- "no" --> N(["no change"])`);
  });
  return lines.join('\n').replace(/(C\d+) --> (C\d+)/g, '$1 -- "no" --> $2');
}
D.caseRouting = routing('assignmentRule:Case.Standard', 'New case');
const escalation = bp.automations.find((x) => x.id === 'escalationRule:Case.Standard');
D.leadRouting = routing('assignmentRule:Lead.Standard', 'New lead');

// Record-triggered flows, element by element from the flow XML
const flowDocs = [];
for (const f of flows) {
  const file = path.join(ROOT, 'force-app', 'main', 'default', 'flows', `${f.source.name}.flow-meta.xml`);
  if (!fs.existsSync(file)) continue;
  const x = new XMLParser({ ignoreAttributes: true }).parse(fs.readFileSync(file, 'utf8')).Flow;
  const lines = ['flowchart TD'];
  const st = x.start || {};
  lines.push(`  START(["${q(`${label(st.object)} ${st.recordTriggerType === 'CreateAndUpdate' ? 'created or updated' : (st.recordTriggerType || '').toLowerCase()}`)}<br/>${q(st.triggerType === 'RecordBeforeSave' ? 'before save' : 'after save')}"])`);
  let first = st.connector?.targetReference;
  if (st.filterFormula) { lines.push(`  FILTER{{"${q(String(st.filterFormula).replace(/\{!\$Record\.([A-Za-z_]+)\}/g, '$1').replace(/ISPICKVAL\(([^,]+),\s*"([^"]+)"\)/g, '$1 = $2').replace(/__c\b/g, '').replace(/_/g, ' '))}"}}`, '  START --> FILTER', '  FILTER -- "no" --> SKIP(["no action"])'); }
  const entry = st.filterFormula ? 'FILTER' : 'START';
  const kinds = { recordCreates: 'create', recordUpdates: 'update', recordLookups: 'get', recordDeletes: 'delete', assignments: 'set', actionCalls: 'action', subflows: 'subflow', screens: 'screen' };
  for (const [k, verb] of Object.entries(kinds)) for (const el of asArray(x[k])) {
    lines.push(`  ${nid(el.name)}["${q(`${verb} ${el.object ? label(el.object) : ''}`.trim())}<br/><small>${q(el.label)}</small>"]`);
    if (el.connector?.targetReference) lines.push(`  ${nid(el.name)} --> ${nid(el.connector.targetReference)}`);
  }
  for (const el of asArray(x.decisions)) {
    lines.push(`  ${nid(el.name)}{"${q(el.label)}"}`);
    for (const r of asArray(el.rules)) if (r.connector?.targetReference) lines.push(`  ${nid(el.name)} -- "${q(r.label)}" --> ${nid(r.connector.targetReference)}`);
    if (el.defaultConnector?.targetReference) lines.push(`  ${nid(el.name)} -- "${q(el.defaultConnectorLabel || 'otherwise')}" --> ${nid(el.defaultConnector.targetReference)}`);
  }
  if (first) lines.push(`  ${entry} ${st.filterFormula ? '-- "yes" ' : ''}--> ${nid(first)}`);
  lines.push('  classDef el fill:#F3F1FC,stroke:#6666CC,color:#1F1F2E;');
  D[`flow_${f.source.name}`] = lines.join('\n');
  flowDocs.push({ key: `flow_${f.source.name}`, label: f.source.label, description: f.description, f });
}

// ---------------------------------------------------------------- security
const famObjects = FAMILY;
const roles = bp.security.filter((s) => famObjects.some((o) => (s.objects?.[o] || []).length) && (s.kind === 'permissionSet' ? !/^sfdc|^X00e|^force__/.test(s.name) : true));
const rolesShown = roles.filter((r) => CORE.some((o) => (r.objects?.[o] || []).length));
{
  const lines = ['flowchart LR', '  subgraph SFS["Salesforce"]'];
  rolesShown.forEach((r) => lines.push(`    ${nid(r.id)}["${q(`${r.kind === 'profile' ? 'Profile' : 'Permission set'}: ${r.name}`)}"]`));
  lines.push('    OWD["Account sharing<br/>(org-wide default)"]', '  end', '  subgraph PG["PostgreSQL"]');
  rolesShown.forEach((r) => lines.push(`    PG_${nid(r.id)}["role ${q(r.name.toLowerCase())}"]`));
  lines.push('    RLS["row-level security<br/>can_access_account()"]', '    COL["column grants<br/>(field-level security)"]', '  end');
  rolesShown.forEach((r) => lines.push(`  ${nid(r.id)} --> PG_${nid(r.id)}`, `  PG_${nid(r.id)} --> COL`));
  lines.push('  OWD --> RLS', '  SUB["Subscription and lines<br/>inherit access from the account"] --> RLS');
  D.security = lines.join('\n');
}

// ---------------------------------------------------------------- data load order (dependency levels)
const deps = Object.fromEntries(FAMILY.map((s) => [s, new Set()]));
for (const r of bp.relations) { const t = asArray(r.to); if (FAMILY.includes(r.from.entity) && t.length === 1 && FAMILY.includes(t[0]) && t[0] !== r.from.entity) deps[r.from.entity].add(t[0]); }
const level = {};
const lv = (s, seen = new Set()) => { if (level[s] != null) return level[s]; if (seen.has(s)) return 0; seen.add(s); level[s] = Math.max(0, ...[...deps[s]].map((d) => lv(d, seen) + 1)); return level[s]; };
FAMILY.forEach((s) => lv(s));
const levels = [...new Set(Object.values(level))].sort();
D.loadOrder = ['flowchart LR', ...levels.map((l) => `  subgraph L${l}["Level ${l + 1}"]\n${FAMILY.filter((s) => level[s] === l).map((s) => `    ${nid(s)}["${q(label(s))}<br/><small>${ent[s]?.rowCount ?? 0} rows</small>"]`).join('\n')}\n  end`), ...levels.slice(1).map((l) => `  L${l - 1} --> L${l}`)].join('\n');

// ---------------------------------------------------------------- documents
const today = new Date().toISOString().slice(0, 10);
const pending = bp.automations.filter((a) => a.scope !== 'out_of_scope' && a.translation === 'agent' && !fs.existsSync(path.join(ROOT, 'blueprint', 'translations')) );
const translated = fs.existsSync(path.join(ROOT, 'blueprint', 'translations')) ? fs.readdirSync(path.join(ROOT, 'blueprint', 'translations')).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')) : [];

const HLD = [
  '# High-level design: Subscription domain', '',
  `Prepared ${today} from blueprint \`${bp.contentHash.slice(0, 12)}\`. Every diagram below is generated from the org’s own metadata; when the org changes, we regenerate this document.`, '',
  '## 1. Scope', '',
  table(['', ''], [
    ['Source', `Salesforce org, ${bp.entities.length} objects described`],
    ['Domain in scope', CORE.map(label).join(', ')],
    ['Reference objects', FAMILY.filter((s) => !CORE.includes(s)).map(label).join(', ')],
    ['Target', 'PostgreSQL on Azure, services and admin app, released by CI/CD'],
    ['Data', FAMILY.map((s) => `${label(s)} ${ent[s]?.rowCount ?? 0}`).join(' · ')],
  ]), '',
  '## 2. How we move it', '',
  'Six phases, one or more agents per phase, a review gate after each phase. A failed check goes to the Repair agent, whose fix is applied only after approval.', '',
  fence(D.architecture), '',
  '## 3. Business processes', '',
  '### 3.1 Subscription lifecycle', '',
  'Statuses come from the Status picklist; the notes come from the validation rules that guard each status.', '',
  fence(D.lifecycle), '',
  '### 3.2 Won deal becomes a subscription', '',
  'When an opportunity is marked Closed Won, a subscription is created for the account, once per deal.', '',
  fence(D.opportunityToSubscription), '',
  '### 3.3 Saving a subscription', '',
  'What happens, in Salesforce’s order, every time a subscription is saved: defaults, validation, status handling, the at-risk alert, and totals on the parent.', '',
  fence(D.subscriptionSave), '',
  ...flowDocs.flatMap((d) => [`### 3.${4 + flowDocs.indexOf(d)} ${d.label}`, '', d.description || '', '', fence(D[d.key]), '']),
  `### 3.${4 + flowDocs.length} Renewal reminders`, '',
  'A scheduled job raises a renewal task before each active subscription ends.', '',
  fence(D.renewalBatch), '',
  ...(D.caseRouting ? [`### 3.${5 + flowDocs.length} Case routing and escalation`, '', 'Assignment rules route each new case by country, service level and account type; escalation rules raise cases that miss their target time (outside the subscription domain; listed for completeness).', '', fence(D.caseRouting), ''] : []),
  ...(escalation ? [table(['Escalation rule', 'Applies when'], escalation.entries.map((e, i) => [i + 1, e.criteria.map((c) => c.replace('US,USA,United States,United States of America', 'US').replace(/^(Account|Case)\./, '').replace(/__c\b/g, '').replace(/equals/g, '=').replace(/notEqual/g, '\u2260')).join('; ')])), ''] : []),
  '## 4. Data model', '',
  fence(D.dataModel), '',
  '## 5. Security', '',
  'Each Salesforce profile or permission set becomes a database role. Field-level security becomes column grants. Subscriptions inherit access from their account, as in Salesforce.', '',
  fence(D.security), '',
  '## 6. Data migration', '',
  'Records load parent first, in dependency order, keeping every Salesforce record ID.', '',
  fence(D.loadOrder), '',
  '## 7. Status and open items', '',
  table(['Item', 'Status'], [
    ['Formulas and roll-ups', `${bp.derivations.filter((d) => CORE.includes(d.entity)).length} generated and checked against Salesforce values`],
    ['Validation rules', `${bp.constraints.filter((c) => CORE.includes(c.entity)).length} compiled (checks and guards)`],
    ['Apex translated', translated.length ? translated.join(', ') : 'none yet'],
    ['Automations still to translate', bp.automations.filter((a) => a.translation === 'agent' && a.scope !== 'out_of_scope').map((a) => a.source.name).filter((n) => !translated.some((t) => t.startsWith(n))).join(', ') || 'none'],
    ['Items Salesforce keeps', 'see the gap register (output/inventory/gap-register.md)'],
  ]), '',
].join('\n');

const fieldRows = (s) => {
  const e = ent[s]; const used = new Set(JSON.stringify([bp.derivations, bp.constraints, bp.automations]).match(new RegExp(`${s}\\.[A-Za-z_]+`, 'g')) || []);
  return e.fields.filter((f) => CORE.includes(s) ? !f.system || f.source === 'Id' || f.source === 'Name' : (f.source === 'Id' || f.source === 'Name' || used.has(f.id) || f.relation && FAMILY.includes(asArray(f.relation.to)[0])))
    .map((f) => [f.source, f.label, f.sourceType, f.name, f.pg, f.required ? 'yes' : '', [f.picklist ? `values: ${f.picklist.values.join(', ')}` : '', f.relation ? `→ ${asArray(f.relation.to).map(label).join('/')}` : '', f.default != null ? `default ${f.default}` : ''].filter(Boolean).join('; ')]);
};
const LLD = [
  '# Low-level design: Subscription domain', '',
  `Prepared ${today} from blueprint \`${bp.contentHash.slice(0, 12)}\`. Field lists, rules and automations are generated from the org; the target design for each item is the strategy our generator applied.`, '',
  '## 1. Tables', '',
  ...FAMILY.flatMap((s) => [`### ${label(s)} (\`${s}\` → \`${ent[s]?.name}\`)`, '', `${ent[s]?.rowCount ?? 0} rows. Sharing: ${ent[s]?.sharing?.internal || 'n/a'}${ent[s]?.sharing?.inheritsFrom ? `, inherited through ${ent[s].sharing.inheritsFrom}` : ''}.`, '', table(['Salesforce field', 'Label', 'Salesforce type', 'Column', 'PostgreSQL type', 'Required', 'Notes'], fieldRows(s)), '']),
  '## 2. Calculated fields', '',
  table(['Field', 'Kind', 'Salesforce definition', 'Target design'], bp.derivations.filter((d) => CORE.includes(d.entity)).map((d) => [d.field, d.kind, d.source || (d.rollup ? `${d.rollup.op} of ${d.rollup.of || d.rollup.from}` : ''), STRATEGY[d.strategy] || d.strategy])), '',
  '## 3. Validation rules', '',
  table(['Rule', 'Rejects when', 'Message', 'Target design'], bp.constraints.filter((c) => FAMILY.includes(c.entity)).map((c) => [`${label(c.entity)}: ${c.name}`, c.source, c.message, STRATEGY[c.strategy] || c.strategy])), '',
  '## 4. Automations', '',
  table(['Automation', 'Runs when', 'Does', 'Target design', 'Status'], bp.automations.filter((a) => a.scope !== 'out_of_scope' && FAMILY.includes(a.trigger?.entity || (a.reads || [])[0])).map((a) => [
    `${a.source.kind}: ${a.source.label || a.source.name}`,
    a.trigger ? `${a.trigger.timing || (a.trigger.events || []).map((e) => e.timing).join('/')} ${asArray(a.trigger.on || (a.trigger.events || []).map((e) => e.on)).join('/')} of ${label(a.trigger.entity)}` : (a.schedulable ? 'on a schedule' : ''),
    a.handlers ? a.handlers.join(', ') : (a.actions || []).map((x) => `${x.kind} ${label(x.entity)}`).join(', ') || (a.writes ? `writes ${a.writes.map(label).join(', ')}` : ''),
    STRATEGY[a.strategy] || a.strategy || 'in-transaction hook',
    translated.some((t) => (a.handlers || []).some((h) => t.endsWith(h.split('.')[1]) || t.includes(h.split('.')[1]))) ? 'partly translated' : 'pending',
  ])), '',
  '### 4.1 Order of execution: subscription', '', fence(D.subscriptionSave), '',
  '### 4.2 Order of execution: subscription line', '', fence(D.lineSave), '',
  ...flowDocs.flatMap((d) => [`### 4.${3 + flowDocs.indexOf(d)} Flow: ${d.label}`, '', fence(D[d.key]), '']),
  '## 5. Services', '',
  table(['Class', 'Methods', 'Reads', 'Writes', 'Called by', 'Constants'], bp.services.map((s) => [s.source.name, (s.methods || []).join(', '), (s.reads || []).map(label).join(', '), (s.writes || []).map(label).join(', '), (s.calledBy || []).map((c) => c.split(':')[1]).join(', '), Object.entries(s.constants || {}).map(([k, v]) => `${k} = ${v}`).join(', ')])), '',
  '## 6. Security', '',
  table(['Role (from Salesforce)', ...CORE.map(label)], rolesShown.map((r) => [`${r.kind === 'profile' ? 'Profile' : 'Permission set'}: ${r.name}`, ...CORE.map((o) => (r.objects?.[o] || []).join(', ') || '—')])), '',
  fence(D.security), '',
  '## 7. Data load', '',
  table(['Order', 'Object', 'Rows', 'Depends on'], [...FAMILY].sort((a, b) => level[a] - level[b]).map((s) => [level[s] + 1, label(s), ent[s]?.rowCount ?? 0, [...deps[s]].map(label).join(', ') || '—'])), '',
  fence(D.loadOrder), '',
  '## 8. Verification cases', '',
  table(['Case', 'Comes from'], (cases.cases || []).map((c) => [c.id || c.name, c.origin || ''])), '',
].join('\n');

fs.mkdirSync(path.join(OUT, 'diagrams'), { recursive: true });
for (const [k, v] of Object.entries(D)) if (v) fs.writeFileSync(path.join(OUT, 'diagrams', `${k}.mmd`), v + '\n');
fs.writeFileSync(path.join(OUT, 'HLD.md'), HLD);
fs.writeFileSync(path.join(OUT, 'LLD.md'), LLD);
const bundle = { generated: today, blueprint: bp.contentHash.slice(0, 12), hld: HLD, lld: LLD, diagrams: D };
fs.writeFileSync(path.join(OUT, 'docs.json'), JSON.stringify(bundle, null, 2));

// Keep the Org Compiler console's embedded copy in step (between the DOCS markers).
const demo = path.join(ROOT, 'demo', 'org-compiler.html');
if (fs.existsSync(demo)) {
  const h = fs.readFileSync(demo, 'utf8');
  const a = h.indexOf('/*DOCS-START*/'), b = h.indexOf('/*DOCS-END*/');
  if (a > -1 && b > a) fs.writeFileSync(demo, h.slice(0, a + 14) + JSON.stringify(bundle).replace(/<\//g, '<\\/') + h.slice(b));
}
console.log(`docs: HLD ${HLD.length} chars, LLD ${LLD.length} chars, ${Object.keys(D).filter((k) => D[k]).length} diagrams -> docs/`);
