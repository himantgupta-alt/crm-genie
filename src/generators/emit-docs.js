// Design documents from the blueprint: a high-level design (HLD) and a low-level design (LLD), each with
// Mermaid diagrams derived from the org's own metadata. Local files only; no org connection.
//
//   node src/generators/emit-docs.js
//
//   docs/HLD.md, docs/LLD.md        readable documents (diagrams render on GitHub and in Org Compiler)
//   docs/diagrams/*.mmd             one Mermaid source per diagram
//   docs/docs.json                  the same content bundled for the Org Compiler console
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const P = require('../paths');
const ROOT = P.ROOT;
const OUT = P.DESIGN;
const bp = JSON.parse(fs.readFileSync(P.BLUEPRINT, 'utf8'));
const apex = JSON.parse(fs.readFileSync(path.join(P.LOGIC, 'apex.json'), 'utf8'));
const workflow = JSON.parse(fs.readFileSync(path.join(P.AGENTS, 'workflow.json'), 'utf8'));
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return d; } };
const cases = readJson(P.rel(P.PARITY_CASES), { cases: [] });
// fast-xml-parser is a declared dependency of src/verification (installed in CI); locally the Salesforce CLI's copy also works.
const { XMLParser } = require((() => {
  try { return require.resolve('fast-xml-parser', { paths: [path.join(P.SRC, 'verification')] }); } catch {
    return path.join(execSync('npm root -g').toString().trim(), '@salesforce/cli/node_modules/fast-xml-parser');
  }
})());

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
  in_transaction_hook: 'in-transaction hook after save',
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
  const file = path.join(P.FORCE_APP, 'flows', `${f.source.name}.flow-meta.xml`);
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

// ---------------------------------------------------------------- shared lookups
const translated = fs.existsSync(P.TRANSLATIONS) ? fs.readdirSync(P.TRANSLATIONS).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')) : [];

// ---------------------------------------------------------------- C4 and deployment views
const bicep = (() => { try { return fs.readFileSync(path.join(P.GO_LIVE, 'infra', 'main.bicep'), 'utf8'); } catch { return ''; } })();
const azure = [...bicep.matchAll(/^resource (\w+) '([^@']+)@/gm)].map((m) => ({ name: m[1], type: m[2] }));
D.c4Context = ['flowchart LR',
  '  AM(["Account managers<br/><small>[person]</small>"])', '  SA(["Service and operations users<br/><small>[person]</small>"])', '  AD(["Administrators and reviewers<br/><small>[person]</small>"])',
  '  SF[("Salesforce org<br/><small>[existing system] source of metadata and data</small>")]',
  '  MIG["Org Compiler<br/><small>[system] agents that extract, design, build, migrate and validate</small>"]',
  '  TGT["Client-owned CRM<br/><small>[system] PostgreSQL + services + app on Azure</small>"]',
  '  EXT(["Integrated systems<br/><small>[external] callers found in login history</small>"])',
  '  SF -- "metadata and data (CLI, REST, Bulk)" --> MIG', '  MIG -- "generated schema, rules, data" --> TGT', '  AD -- "reviews each gate" --> MIG',
  '  AM -- "sell, renew" --> TGT', '  SA -- "serve" --> TGT', '  EXT -. "Salesforce-compatible API (planned)" .-> TGT',
  '  classDef sys fill:#E6ECFC,stroke:#2450D6,color:#18212F;', '  class MIG,TGT sys;'].join('\n');
D.c4Container = ['flowchart LR', '  subgraph ORG["Org Compiler (build time)"]',
  '    AG["Agents runtime<br/><small>Node.js, src/agents</small>"]', '    GEN["Generators<br/><small>Node.js, src/generators</small>"]', '    CON["Review console<br/><small>HTML, src/console</small>"]',
  '    REPO[("ADLC outputs<br/><small>git, adlc/</small>")]', '  end',
  '  subgraph RUN["Client-owned CRM (run time)"]', '    APP["Web app and API<br/><small>Node.js Express, src/app</small>"]', '    DB[("PostgreSQL<br/><small>schema app, RLS, roles</small>")]', '  end',
  '  CI["CI/CD<br/><small>GitHub Actions</small>"]', '  LLM["Claude<br/><small>Apex translation, repair proposals</small>"]',
  '  AG --> GEN', '  GEN --> REPO', '  AG -. "translate, diagnose" .-> LLM', '  CON -- "approve, edit, return" --> AG',
  '  REPO --> CI', '  CI -- "verify, deploy" --> APP', '  APP -- "SET LOCAL ROLE per user" --> DB',
  '  classDef run fill:#EAFBF5,stroke:#157048,color:#18212F;', '  class APP,DB run;'].join('\n');
D.deployment = ['flowchart TB', '  subgraph AZ["Azure resource group (adlc/6-go-live/infra/main.bicep)"]',
  ...azure.map((r) => `    ${nid(r.name)}["${q(r.name)}<br/><small>${q(r.type.split('/').slice(1).join('/'))}</small>"]`), '  end',
  '  GH["GitHub Actions"] -- "zip deploy" --> ' + (azure.find((r) => /\/sites$/.test(r.type))?.name || 'site'),
  ...(azure.some((r) => /\/sites$/.test(r.type)) && azure.some((r) => /flexibleServers$/.test(r.type)) ? [`  ${azure.find((r) => /\/sites$/.test(r.type)).name} -- "TLS, pg" --> ${azure.find((r) => /flexibleServers$/.test(r.type)).name}`] : []),
  '  DEV["Engineer workstation<br/><small>sf CLI, extraction</small>"] -- "load_db.ps1" --> ' + (azure.find((r) => /flexibleServers$/.test(r.type))?.name || 'pg')].join('\n');

// ---------------------------------------------------------------- architecture decisions (one per strategy in use)
const used = (s) => [...bp.derivations.filter((d) => d.strategy === s && CORE.includes(d.entity)).map((d) => d.field), ...bp.constraints.filter((c) => c.strategy === s && FAMILY.includes(c.entity)).map((c) => `${c.entity}.${c.name}`), ...bp.automations.filter((a) => a.strategy === s && a.scope !== 'out_of_scope').map((a) => a.id)];
const ADRS = [
  { id: 'ADR-001', slug: 'blueprint-contract', title: 'A vendor-neutral blueprint is the contract between extraction and generation', context: 'Extractors speak Salesforce; generators speak PostgreSQL. Coupling them directly makes every new source or target a rewrite.', decision: 'All generators read only the blueprint (JSON, validated against blueprint.schema.json, content-hashed). Extraction never talks to generation.', consequences: 'Re-runs are deterministic and diffable; a new target needs one emitter. The schema must evolve with care (versioned).', applies: ['adlc/2-design/modelling/blueprint/blueprint.json'] },
  { id: 'ADR-002', slug: 'keep-salesforce-ids', title: 'Keep the 18-character Salesforce ID as the primary key', context: 'Integrations, reports and users hold Salesforce IDs; a migration that renumbers records breaks them.', decision: 'Every table keeps the Salesforce ID as its key; new records get IDs in the same format from the runtime.', consequences: 'Links, bookmarks and the compatibility API keep working; keys are text, not integers.', applies: FAMILY.map((s) => `${s}.Id`) },
  { id: 'ADR-003', slug: 'generated-columns', title: 'Row-local formulas become stored generated columns', strategy: 'generated_column', context: 'Formulas that read only their own row are pure functions of the row.', decision: 'Compile them to GENERATED ALWAYS AS … STORED, with blank-as-zero made explicit.', consequences: 'Always correct, indexable, no application code; formulas using TODAY() cannot use this (see ADR-005).' },
  { id: 'ADR-004', slug: 'cross-object-views', title: 'Cross-object formulas become views', strategy: 'view_join', context: 'Generated columns cannot read another table.', decision: 'Expose them through a view that joins the parent records.', consequences: 'Always current; reads go through the view.' },
  { id: 'ADR-005', slug: 'compute-on-read', title: 'Date-dependent formulas are computed when read', strategy: 'compute_on_read', context: 'A stored value using TODAY() would be wrong tomorrow.', decision: 'Compute in the view using app.today(), evaluated in the org’s time zone.', consequences: 'Matches Salesforce, which also evaluates on read.' },
  { id: 'ADR-006', slug: 'trigger-maintained-rollups', title: 'Roll-up summaries are trigger-maintained columns with a recompute job', strategy: 'trigger_maintained', context: 'Roll-ups must be filterable and fast, and correct after bulk loads.', decision: 'Statement-level triggers keep totals current; a recompute function rebuilds them after loads and as a safety net.', consequences: 'Fast reads; load mode defers triggers and recomputes once.' },
  { id: 'ADR-007', slug: 'check-constraints', title: 'Row-local validation rules become CHECK constraints', strategy: 'check', context: 'Rules that read only the row being saved can be enforced by the database itself.', decision: 'Compile to CHECK constraints named after the rule, keeping the Salesforce error message in the mapping.', consequences: 'Enforced for every writer, including integrations and loads.' },
  { id: 'ADR-008', slug: 'guard-triggers', title: 'Rules needing the previous row or a parent record become BEFORE-trigger guards', strategy: 'write_guard', context: 'PRIORVALUE, ISCHANGED and cross-object rules cannot be CHECK constraints.', decision: 'Generate BEFORE INSERT OR UPDATE triggers that raise the Salesforce message.', consequences: 'Same behaviour as Salesforce; order of guards follows Salesforce’s order of execution.' },
  { id: 'ADR-009', slug: 'roles-and-rls', title: 'Profiles and permission sets become roles; sharing becomes row-level security', context: 'Access must be enforced where the data lives, not only in the app.', decision: 'One database role per profile or permission set, column grants for field-level security, RLS policies for sharing; the app sets the role per request.', consequences: 'Any client of the database gets the same access rules; policies are tested by parity cases.', applies: rolesShown.map((r) => r.id) },
  { id: 'ADR-010', slug: 'reviewed-llm-translation', title: 'Apex is translated by an AI agent and merged only after review', strategy: 'trigger_dispatch', context: 'Apex can do anything; deterministic templates cannot cover it.', decision: 'The Logic agent drafts a translation with tests; it is marked reviewed:false until a person approves it at the gate.', consequences: 'Speed of generation with human accountability; nothing generated merges unchecked.' },
  { id: 'ADR-011', slug: 'parity-as-acceptance', title: 'Behaviour is accepted only when it matches Salesforce’s own values', context: 'Reviewing generated code line by line does not scale.', decision: 'The Verification agent recomputes every calculated value against what Salesforce stored and replays rule cases; CI blocks release on any mismatch.', consequences: 'Correctness is measured, not asserted; new behaviours need new cases.', applies: [P.rel(P.PARITY_CASES)] },
];
for (const a of ADRS) a.applies = a.applies || used(a.strategy);
const adrFile = (a) => `${a.id}-${a.slug}.md`;
const adrMd = (a) => [`# ${a.id}: ${a.title}`, '', `Status: Accepted · Owner: Modelling agent · Blueprint \`${bp.contentHash.slice(0, 12)}\``, '',
  '## Context', '', a.context, '', '## Decision', '', a.decision, '', '## Consequences', '', a.consequences, '',
  `## Applies to (${a.applies.length})`, '', ...(a.applies.length ? a.applies.map((x) => `- \`${x}\``) : ['- nothing in the current scope']), ''].join('\n');

// ---------------------------------------------------------------- traceability: Salesforce element -> design -> artifact -> test
const sql = P.sqlFiles().map((f) => ({ file: P.rel(f), text: fs.readFileSync(f, 'utf8') }));
const filesFor = (...needles) => filesIn(sql, ...needles);
const logicFilesFor = (...needles) => filesIn(sql.filter((s) => !/\/security\//.test(s.file)), ...needles);
const filesIn = (list, ...needles) => list.filter((s) => needles.some((n) => n && new RegExp(`\\b${n.toLowerCase()}\\b`).test(s.text.toLowerCase()))).map((s) => `\`${s.file.split('/').slice(-3).join('/')}\``).join(', ') || '—';
const caseList = (cases.cases || []).map((c) => c.id || c.name);
const testsFor = (...needles) => caseList.filter((c) => needles.some((n) => n && c.toLowerCase().includes(n.toLowerCase()))).map((c) => `\`${c}\``).join(', ');
const adrFor = (s) => { const a = ADRS.find((x) => x.strategy === s); return a ? `[${a.id}](adr/${adrFile(a)})` : ''; };
const trace = [
  ...bp.derivations.filter((d) => CORE.includes(d.entity)).map((d) => { const f = ent[d.entity].fields.find((x) => x.id === d.field); return [`${d.kind}: \`${d.field}\``, d.id, `${STRATEGY[d.strategy] || d.strategy} ${adrFor(d.strategy)}`, logicFilesFor(f?.name), testsFor(d.field.split('.')[1].replace(/__c$/, '')) || 'derived-value comparison (all rows)']; }),
  ...bp.constraints.filter((c) => FAMILY.includes(c.entity)).map((c) => [`validation rule: \`${c.entity}.${c.name}\``, c.id, `${STRATEGY[c.strategy] || c.strategy} ${adrFor(c.strategy)}`, logicFilesFor(c.name), testsFor(c.name) || '—']),
  ...bp.automations.filter((a) => a.scope !== 'out_of_scope' && FAMILY.includes(a.trigger?.entity || (a.reads || [])[0])).map((a) => [`${a.source.kind}: \`${a.source.name}\``, a.id, `${STRATEGY[a.strategy] || a.strategy} ${adrFor(a.strategy)}`, translated.some((t) => (a.handlers || []).some((h) => t.includes(h.split('.')[1]))) ? filesFor(...(a.handlers || []).map((h) => h.split('.')[1])) : 'pending', testsFor(a.source.name, ...(a.handlers || []).map((h) => h.split('.')[1])) || '—']),
  ...rolesShown.map((r) => [`${r.kind}: \`${r.name}\``, r.id, `role, column grants, RLS ${'[ADR-009](adr/' + adrFile(ADRS[8]) + ')'}`, filesFor(r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')), testsFor('security') || '—']),
];

// ---------------------------------------------------------------- documents (arc42 structure; no run dates, so CI can check they are current)
const stamp = `Owner: Modelling agent · generated by \`src/generators/emit-docs.js\` from blueprint \`${bp.contentHash.slice(0, 12)}\` · regenerated whenever the org changes`;
const vocab = FAMILY.flatMap((s) => [[label(s), s, ent[s]?.name]]);
const HLD = [
  '# High-level design: Subscription domain', '', stamp, '',
  'Structure follows arc42; context and container views follow C4; decisions are recorded as ADRs.', '',
  '## 1. Introduction and goals', '',
  table(['', ''], [
    ['Source', `Salesforce org, ${bp.entities.length} objects described`],
    ['Domain in scope', CORE.map(label).join(', ')],
    ['Reference objects', FAMILY.filter((s) => !CORE.includes(s)).map(label).join(', ')],
    ['Target', 'PostgreSQL on Azure, services and admin app, released by CI/CD'],
    ['Data', FAMILY.map((s) => `${label(s)} ${ent[s]?.rowCount ?? 0}`).join(' · ')],
  ]), '',
  'Quality goals, in priority order: **behavioural parity** with Salesforce, **security** equal to the org’s, **traceability** from every artifact to its source, **repeatability** of every phase.', '',
  '## 2. Constraints', '',
  '- Salesforce stays the system of record until each domain is cut over.', '- Only Salesforce-supported APIs and the Salesforce CLI are used to read the org; nothing is written back.', '- Generated code is reviewed at a gate before it merges; the model never sits in the runtime path.', '- Items Salesforce does not hand over are handled through the gap register (`adlc/1-discover/extraction/inventory/gap-register.md`).', '',
  '## 3. Context and scope (C4 level 1)', '', fence(D.c4Context), '',
  '## 4. Solution strategy', '',
  table(['Concern', 'Approach', 'Decision'], [
    ['One source of truth', 'Vendor-neutral blueprint between extraction and generation', `[ADR-001](adr/${adrFile(ADRS[0])})`],
    ['Identity of records', 'Salesforce IDs kept as keys', `[ADR-002](adr/${adrFile(ADRS[1])})`],
    ['Calculated fields', 'Generated columns, views, computed on read, trigger-maintained roll-ups', 'ADR-003 to ADR-006'],
    ['Business rules', 'CHECK constraints and BEFORE-trigger guards', 'ADR-007, ADR-008'],
    ['Access', 'Roles, column grants and row-level security', `[ADR-009](adr/${adrFile(ADRS[8])})`],
    ['Custom code', 'AI-translated, reviewed before merge', `[ADR-010](adr/${adrFile(ADRS[9])})`],
    ['Acceptance', 'Parity with Salesforce’s own values', `[ADR-011](adr/${adrFile(ADRS[10])})`],
  ]), '',
  '## 5. Building block view (C4 level 2)', '', fence(D.c4Container), '',
  'How the agents move it, phase by phase:', '', fence(D.architecture), '',
  '## 6. Runtime view: business processes', '',
  '### 6.1 Subscription lifecycle', '', 'Statuses come from the Status picklist; the notes come from the validation rules that guard each status.', '', fence(D.lifecycle), '',
  '### 6.2 Won deal becomes a subscription', '', 'When an opportunity is marked Closed Won, a subscription is created for the account, once per deal.', '', fence(D.opportunityToSubscription), '',
  '### 6.3 Saving a subscription', '', 'What happens, in Salesforce’s order, every time a subscription is saved.', '', fence(D.subscriptionSave), '',
  ...flowDocs.flatMap((d, i) => [`### 6.${4 + i} ${d.label}`, '', d.description || '', '', fence(D[d.key]), '']),
  `### 6.${4 + flowDocs.length} Renewal reminders`, '', 'A scheduled job raises a renewal task before each active subscription ends.', '', fence(D.renewalBatch), '',
  ...(D.caseRouting ? [`### 6.${5 + flowDocs.length} Case routing and escalation`, '', 'Assignment rules route each new case; escalation rules raise cases that miss their target time (outside the subscription domain; listed for completeness).', '', fence(D.caseRouting), ''] : []),
  ...(escalation ? [table(['Escalation rule', 'Applies when'], escalation.entries.map((e, i) => [i + 1, e.criteria.map((c) => c.replace('US,USA,United States,United States of America', 'US').replace(/^(Account|Case)\./, '').replace(/__c\b/g, '').replace(/equals/g, '=').replace(/notEqual/g, '≠')).join('; ')])), ''] : []),
  '## 7. Deployment view', '', `Resources parsed from \`${P.rel(path.join(P.GO_LIVE, 'infra', 'main.bicep'))}\`.`, '', fence(D.deployment), '',
  '## 8. Cross-cutting concepts', '',
  '### 8.1 Data model', '', fence(D.dataModel), '',
  '### 8.2 Security model', '', 'Each profile or permission set becomes a database role; field-level security becomes column grants; subscriptions inherit access from their account.', '', fence(D.security), '',
  '### 8.3 Data migration', '', 'Records load parent first, in dependency order, keeping every Salesforce record ID.', '', fence(D.loadOrder), '',
  '### 8.4 Traceability', '', 'Every generated file names its owning agent and blueprint; the LLD’s traceability matrix links each Salesforce element to its design decision, artifact and test.', '',
  '## 9. Architecture decisions', '', table(['ADR', 'Decision', 'Applies to'], ADRS.map((a) => [`[${a.id}](adr/${adrFile(a)})`, a.title, a.applies.length])), '',
  '## 10. Quality requirements', '',
  table(['Quality', 'Scenario', 'How it is measured'], [
    ['Parity', 'Every calculated value and rule outcome matches Salesforce', 'Verification agent, blocking in CI'],
    ['Security', 'A user sees and edits only what Salesforce allows', 'Security parity cases, RLS and column grants'],
    ['Repeatability', 'Same org in, same outputs out', 'CI regenerates blueprint, SQL and documents and fails on any difference'],
    ['Traceability', 'Any artifact leads back to its Salesforce source', 'Provenance headers and the LLD traceability matrix, checked in CI'],
  ]), '',
  '## 11. Risks and technical debt', '',
  table(['Item', 'Status'], [
    ['Apex translated', translated.length ? translated.join(', ') : 'none yet'],
    ['Automations still to translate', bp.automations.filter((a) => a.translation === 'agent' && a.scope !== 'out_of_scope').map((a) => a.source.name).filter((n) => !translated.some((t) => t.startsWith(n))).join(', ') || 'none'],
    ['Items Salesforce keeps', 'gap register (adlc/1-discover/extraction/inventory/gap-register.md)'],
  ]), '',
  '## 12. Glossary', '', table(['Business term', 'Salesforce object', 'Target table'], vocab), '',
].join('\n');

const fieldRows = (s) => {
  const e = ent[s]; const usedF = new Set(JSON.stringify([bp.derivations, bp.constraints, bp.automations]).match(new RegExp(`${s}\\.[A-Za-z_]+`, 'g')) || []);
  return e.fields.filter((f) => CORE.includes(s) ? !f.system || f.source === 'Id' || f.source === 'Name' : (f.source === 'Id' || f.source === 'Name' || usedF.has(f.id) || f.relation && FAMILY.includes(asArray(f.relation.to)[0])))
    .map((f) => [f.source, f.label, f.sourceType, f.name, f.pg, f.required ? 'yes' : '', [f.picklist ? `values: ${f.picklist.values.join(', ')}` : '', f.relation ? `→ ${asArray(f.relation.to).map(label).join('/')}` : '', f.default != null ? `default ${f.default}` : ''].filter(Boolean).join('; ')]);
};
const LLD = [
  '# Low-level design: Subscription domain', '', stamp, '',
  'Field lists, rules and automations are generated from the org; the target design for each item is the strategy our generator applied, with its ADR.', '',
  '## 1. Tables', '',
  ...FAMILY.flatMap((s) => [`### ${label(s)} (\`${s}\` → \`${ent[s]?.name}\`)`, '', `${ent[s]?.rowCount ?? 0} rows. Sharing: ${ent[s]?.sharing?.internal || 'n/a'}${ent[s]?.sharing?.inheritsFrom ? `, inherited through ${ent[s].sharing.inheritsFrom}` : ''}.`, '', table(['Salesforce field', 'Label', 'Salesforce type', 'Column', 'PostgreSQL type', 'Required', 'Notes'], fieldRows(s)), '']),
  '## 2. Calculated fields', '',
  table(['Field', 'Kind', 'Salesforce definition', 'Target design'], bp.derivations.filter((d) => CORE.includes(d.entity)).map((d) => [d.field, d.kind, d.source || (d.rollup ? `${d.rollup.op} of ${d.rollup.of || d.rollup.from}` : ''), `${STRATEGY[d.strategy] || d.strategy} ${adrFor(d.strategy)}`])), '',
  '## 3. Validation rules', '',
  table(['Rule', 'Rejects when', 'Message', 'Target design'], bp.constraints.filter((c) => FAMILY.includes(c.entity)).map((c) => [`${label(c.entity)}: ${c.name}`, c.source, c.message, `${STRATEGY[c.strategy] || c.strategy} ${adrFor(c.strategy)}`])), '',
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
  ...flowDocs.flatMap((d, i) => [`### 4.${3 + i} Flow: ${d.label}`, '', fence(D[d.key]), '']),
  '## 5. Services', '',
  table(['Class', 'Methods', 'Reads', 'Writes', 'Called by', 'Constants'], bp.services.map((s) => [s.source.name, (s.methods || []).join(', '), (s.reads || []).map(label).join(', '), (s.writes || []).map(label).join(', '), (s.calledBy || []).map((c) => c.split(':')[1]).join(', '), Object.entries(s.constants || {}).map(([k, v]) => `${k} = ${v}`).join(', ')])), '',
  '## 6. Security', '',
  table(['Role (from Salesforce)', ...CORE.map(label)], rolesShown.map((r) => [`${r.kind === 'profile' ? 'Profile' : 'Permission set'}: ${r.name}`, ...CORE.map((o) => (r.objects?.[o] || []).join(', ') || '—')])), '',
  fence(D.security), '',
  '## 7. Data load', '',
  table(['Order', 'Object', 'Rows', 'Depends on'], [...FAMILY].sort((a, b) => level[a] - level[b]).map((s) => [level[s] + 1, label(s), ent[s]?.rowCount ?? 0, [...deps[s]].map(label).join(', ') || '—'])), '',
  fence(D.loadOrder), '',
  '## 8. Migrations', '',
  table(['Order', 'File', 'Owner agent', 'Contents'], sql.map((s, i) => [i + 1, `\`${s.file}\``, s.file.split('/')[2].replace(/^./, (c) => c.toUpperCase()) + ' agent', (s.text.match(/^-- (.+)$/m) || [])[1] || ''])), '',
  'Migrations are numbered, applied in order, and rebuildable from the blueprint; each lives in its owning agent’s folder.', '',
  '## 9. Patterns used', '',
  table(['Pattern', 'Where', 'Why'], [
    ['Contract-first model (blueprint + JSON Schema)', '`adlc/2-design/modelling/blueprint/`', 'Decouples extraction from generation; validated in CI'],
    ['Generated column', 'row-local formulas', 'Always correct without application code'],
    ['Materialised aggregate with recompute backstop', 'roll-up summaries', 'Fast reads, self-healing after loads'],
    ['Guard trigger', 'rules needing the previous row or a parent', 'Same rejection point and message as Salesforce'],
    ['Role-based access + row-level security', '`060_security.sql`', 'Access enforced in the database for every client'],
    ['Idempotent, dependency-ordered load with load mode', '`src/app/scripts/load.js`', 'Repeatable loads; triggers deferred, totals recomputed once'],
    ['Golden-master testing (parity)', '`src/verification/run.js`', 'Salesforce’s own values are the expected results'],
    ['Single source of paths', '`src/paths.js`', 'Layout changes are one-line changes'],
    ['Human-in-the-loop gate', '`src/agents/run.js`', 'Approve, edit or return before anything merges'],
  ]), '',
  '## 10. Verification cases', '',
  table(['Case', 'Comes from'], (cases.cases || []).map((c) => [c.id || c.name, c.origin || ''])), '',
  '## 11. Traceability', '',
  'Each Salesforce element, its blueprint ID, the design decision applied, the generated artifact, and the test that proves it.', '',
  table(['Salesforce element', 'Blueprint ID', 'Design', 'Artifact', 'Verified by'], trace), '',
].join('\n');

fs.rmSync(path.join(OUT, 'adr'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'adr'), { recursive: true });
for (const a of ADRS) fs.writeFileSync(path.join(OUT, 'adr', adrFile(a)), adrMd(a));
fs.writeFileSync(path.join(OUT, 'adr', 'README.md'), ['# Architecture decision records', '', stamp, '', table(['ADR', 'Decision', 'Applies to'], ADRS.map((a) => [`[${a.id}](${adrFile(a)})`, a.title, a.applies.length])), ''].join('\n'));
fs.rmSync(path.join(OUT, 'diagrams'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'diagrams'), { recursive: true });
for (const [k, v] of Object.entries(D)) if (v) fs.writeFileSync(path.join(OUT, 'diagrams', `${k}.mmd`), v + '\n');
fs.writeFileSync(path.join(OUT, 'HLD.md'), HLD);
fs.writeFileSync(path.join(OUT, 'LLD.md'), LLD);
const bundle = { blueprint: bp.contentHash.slice(0, 12), hld: HLD, lld: LLD, adrs: Object.fromEntries(ADRS.map((a) => [a.id, adrMd(a)])), diagrams: D };
fs.writeFileSync(path.join(OUT, 'docs.json'), JSON.stringify(bundle, null, 2));

// Keep the Org Compiler console's embedded copy in step (between the DOCS markers).
const demo = P.CONSOLE;
if (fs.existsSync(demo)) {
  const h = fs.readFileSync(demo, 'utf8');
  const a = h.indexOf('/*DOCS-START*/'), b = h.indexOf('/*DOCS-END*/');
  if (a > -1 && b > a) fs.writeFileSync(demo, h.slice(0, a + 14) + JSON.stringify(bundle).replace(/<\//g, '<\\/') + h.slice(b));
}
console.log(`docs: HLD ${HLD.length} chars, LLD ${LLD.length} chars, ${ADRS.length} ADRs, ${Object.keys(D).filter((k) => D[k]).length} diagrams, ${trace.length} traceability rows -> ${P.rel(OUT)}`);
