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
  lines.push('  P5 --> AZ[("Azure<br/>CRM platform")]', '  P4 -. "fails" .-> R["Repair agent"] -. "fix, after approval" .-> P2');
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
// Target-state views: the system the client runs on Azure after cutover. How the migration itself is produced is
// not part of the solution architecture and is not shown here.
D.c4Context = ['flowchart TB',
  '  AM(["Account managers<br/><small>[person] sell and renew</small>"])', '  SA(["Service and operations users<br/><small>[person] serve customers</small>"])', '  AD(["Administrators<br/><small>[person] users, roles, reference data</small>"])',
  '  TGT["Subscription Management<br/><small>[software system] web app, API and database on Azure</small>"]',
  '  IDP["Microsoft Entra ID<br/><small>[external system] single sign-on</small>"]',
  '  EXT(["Integrated systems<br/><small>[external systems] finance, billing, reporting</small>"])',
  '  SF[("Salesforce<br/><small>[existing system] until cutover only</small>")]',
  '  AM -- "HTTPS" --> TGT', '  SA -- "HTTPS" --> TGT', '  AD -- "HTTPS" --> TGT',
  '  TGT -- "OpenID Connect" --> IDP', '  EXT -- "REST API, OAuth 2.0" --> TGT',
  '  SF -. "change feed until cutover" .-> TGT',
  '  classDef sys fill:#E6ECFC,stroke:#2450D6,stroke-width:3px,color:#18212F;', '  class TGT sys;'].join('\n');
// ---------------------------------------------------------------- platform domains: every Salesforce module, not only this one
// The target is one platform that receives the org module by module. Objects are grouped into domains (bounded
// contexts) around a shared core; the grouping and the dependencies between domains come from this org's metadata.
const allEnt = Object.fromEntries(bp.entities.map((e) => [e.source, e]));
const DOMAINS = [
  { id: 'core', name: 'Core customer', cloud: 'shared by every cloud', objects: ['Account', 'Contact', 'User', 'Product2', 'Pricebook2', 'PricebookEntry'] },
  { id: 'sales', name: 'Sales', cloud: 'Sales Cloud', objects: ['Lead', 'Opportunity', 'OpportunityLineItem', 'OpportunityContactRole', 'Campaign', 'CampaignMember', 'Quote', 'QuoteLineItem', 'Order', 'OrderItem', 'Contract'] },
  { id: 'service', name: 'Service', cloud: 'Service Cloud', objects: ['Case', 'CaseComment', 'Entitlement', 'ServiceContract', 'ContractLineItem', 'Knowledge__kav'] },
  { id: 'subs', name: 'Subscriptions', cloud: 'custom module', objects: CORE },
  { id: 'activity', name: 'Activities', cloud: 'shared by Sales and Service', objects: ['Task', 'Event'] },
  { id: 'field', name: 'Field service', cloud: 'Field Service', objects: ['WorkOrder', 'WorkOrderLineItem', 'ServiceAppointment', 'Asset'] },
].map((d) => { const objs = d.objects.filter((o) => allEnt[o]); const rows = objs.reduce((a, o) => a + (allEnt[o].rowCount || 0), 0); return { ...d, objs, rows, inUse: rows > 0 }; });
const domainOf = Object.fromEntries(DOMAINS.flatMap((d) => d.objs.map((o) => [o, d.id])));
const domainLinks = {};
for (const r of bp.relations) {
  const a = domainOf[r.from?.entity]; if (!a) continue;
  for (const t of asArray(r.to)) { const b = domainOf[t]; if (b && b !== a) domainLinks[`${a}>${b}`] = (domainLinks[`${a}>${b}`] || 0) + 1; }
}
const LIVE = DOMAINS.filter((d) => d.inUse);
const dname = (id) => DOMAINS.find((d) => d.id === id).name;
const dependsOn = (id) => Object.keys(domainLinks).filter((k) => k.startsWith(id + '>') && LIVE.some((d) => d.id === k.split('>')[1])).map((k) => k.split('>')[1]);
// Platform services are in the container view; the domain map shows only domains, so it stays legible on A4.
D.domainMap = ['flowchart TB',
  ...LIVE.map((d) => `  ${d.id}["<b>${q(d.name)}</b><br/><small>${q(d.cloud)} · ${((k) => `${k} object${k === 1 ? '' : 's'}`)(d.objs.filter((o) => allEnt[o].rowCount).length)} in use</small>"]`),
  ...Object.entries(domainLinks).filter(([k]) => k.split('>').every((x) => LIVE.some((d) => d.id === x))).map(([k, c]) => `  ${k.split('>')[0]} -->|"${c} link${c === 1 ? '' : 's'}"| ${k.split('>')[1]}`),
  '  classDef pilot fill:#EAFBF5,stroke:#157048,stroke-width:3px;', '  class subs pilot;'].join('\n');
D.domainTemplate = ['flowchart LR',
  '  API["Domain API<br/><small>OpenAPI 3, versioned</small>"] --> LOGIC["Domain logic<br/><small>services, translated automations</small>"]',
  '  JOBS["Domain jobs<br/><small>schedules, event handlers</small>"] --> LOGIC',
  '  LOGIC --> SCHEMA[("Domain schema<br/><small>tables, rules, calculations, row-level security</small>")]',
  '  LOGIC --> OUT["Outbox<br/><small>same transaction</small>"] --> BUS["Event bus<br/><small>CloudEvents</small>"]',
  '  SCHEMA --> VIEWS["Published read views<br/><small>the only way other domains read it</small>"]',
  '  TESTS["Parity and security tests"] -.-> SCHEMA'].join('\n');
D.c4Container = ['flowchart TB',
  '  U(["Users<br/><small>browser</small>"])', '  EXT(["Integrated systems"])', '  SF[("Salesforce<br/><small>until each domain cuts over</small>")]',
  '  subgraph SYS["CRM platform on Azure"]',
  '    EDGE["Edge<br/><small>Azure Front Door + WAF</small>"]',
  '    GW["Integration gateway<br/><small>Azure API Management</small>"]',
  '    APP["Domain services<br/><small>one deployable, one module per domain; Azure Container Apps</small>"]',
  '    JOBS["Jobs and event handlers<br/><small>Container Apps jobs</small>"]',
  '    SYNC["Salesforce sync<br/><small>Container Apps</small>"]',
  '    BUS["Event bus<br/><small>Service Bus (domain events), Event Hubs (change feed)</small>"]',
  '    DB[("Operational database<br/><small>Azure Database for PostgreSQL: one schema per domain, shared access schema</small>")]',
  '    KV["Secrets<br/><small>Azure Key Vault</small>"]',
  '    MON["Monitoring<br/><small>Application Insights + Log Analytics</small>"]',
  '  end',
  '  IDP["Microsoft Entra ID<br/><small>staff; External ID for portal users</small>"]',
  '  U -- "HTTPS" --> EDGE --> APP', '  EXT -- "REST, OAuth 2.0" --> GW --> APP',
  '  SF -- "Pub/Sub API change events" --> BUS --> SYNC --> DB', '  SYNC -. "write-back while needed" .-> SF',
  '  APP -- "SQL over TLS, role per user" --> DB', '  APP -- "outbox" --> BUS --> JOBS --> DB',
  '  APP -. "managed identity" .-> KV', '  APP -. "sign-in" .-> IDP', '  APP --> MON',
  '  classDef run fill:#EAFBF5,stroke:#157048,color:#18212F;', '  class APP,JOBS,DB run;'].join('\n');
D.deployment = ['flowchart TB',
  // Identity and the release pipeline are in sections 7.2 and 7.3; leaving them out keeps the diagram legible on A4.
  '  U(["Users and integrated systems"]) --> FD["Azure Front Door Premium + WAF<br/><small>global</small>"]',
  '  subgraph REG["Primary Azure region, three availability zones"]',
  '    APIM["API Management<br/><small>Salesforce-compatible API</small>"]',
  '    subgraph VNET["Virtual network (spoke)"]',
  '      subgraph SN1["Container Apps subnet"]',
  '        ACA["Container Apps environment<br/><small>zone redundant: domain services, jobs, Salesforce sync</small>"]',
  '      end',
  '      subgraph SN2["Private endpoint subnet"]',
  '        PG[("PostgreSQL Flexible Server<br/><small>zone-redundant HA, schema per domain</small>")]',
  '        SB["Service Bus Premium<br/>+ Event Hubs"]',
  '        KV["Key Vault"]',
  '      end',
  '    end',
  '    LA["Application Insights + Log Analytics"]',
  '  end',
  '  subgraph PAIR["Paired region"]', '    BK[("Geo-redundant backups")]', '  end',
  '  FD --> ACA', '  FD --> APIM --> ACA', '  ACA --> PG', '  ACA --> SB', '  ACA -.-> KV', '  ACA --> LA', '  PG --> BK'].join('\n');
D.coexistence = ['sequenceDiagram', '  autonumber',
  '  actor SU as Sales user', '  participant SF as Salesforce', '  participant EH as Event Hubs', '  participant SY as Sync', '  participant DB as PostgreSQL', '  participant APP as Domain services', '  actor AU as Subscriptions user',
  '  SU->>SF: edit opportunity', '  SF-->>EH: change event', '  EH->>SY: in order per record', '  SY->>DB: update read copy',
  '  AU->>APP: edit subscription', '  APP->>DB: save + outbox row', '  APP-->>SY: domain event', '  SY-->>SF: write back if still read'].join('\n');
D.accessModel = ['flowchart LR',
  '  STAFF(["Staff"]) --> ENTRA["Entra ID<br/><small>app roles, groups, MFA</small>"]', '  PORTAL(["Portal users"]) --> EXTID["Entra External ID"]',
  '  ENTRA --> APP["Domain services<br/><small>set role and user per request</small>"]', '  EXTID --> APP',
  '  APP --> RLS["Row-level security policies<br/><small>in every domain schema</small>"]',
  '  RLS --> ACC[("Access schema<br/><small>role hierarchy, groups, teams, territories, share tables</small>")]',
  '  APP --> COL["Column grants<br/><small>field-level security</small>"]',
  '  SFSEC["Salesforce profiles, permission sets, roles, sharing rules"] -. "migrated once, then managed here" .-> ACC'].join('\n');
// Wave plan: Core reference data first as read copies, the pilot next, then domains in dependency order; Core's
// master moves last, when nothing left in Salesforce writes to it.
const ordered = ['subs', 'sales', 'service'].filter((id) => LIVE.some((d) => d.id === id));
const WAVES = [
  { name: 'Wave 0: foundation', moves: [], does: 'Landing zone, platform services, identity; Core customer and every in-use domain as read copies fed by the Salesforce change feed' },
  ...ordered.map((id, i) => ({ name: `Wave ${i + 1}: ${dname(id)}${id === 'subs' ? ' (pilot)' : ''}`, moves: [id], does: `${dname(id)} becomes master in Azure; its users and integrations switch; Salesforce keeps a read-only copy` })),
  { name: `Wave ${ordered.length + 1}: core and activities`, moves: ['core', 'activity'].filter((id) => LIVE.some((d) => d.id === id)), does: 'Core customer and activities become master in Azure; Salesforce is read-only' },
  { name: `Wave ${ordered.length + 2}: decommission`, moves: [], does: 'Final archive taken; licences reduced at renewal' },
];
const sorMatrix = LIVE.map((d) => { let moved = false; return [d.name, ...WAVES.slice(1, -1).map((w) => { moved = moved || w.moves.includes(d.id); return moved ? 'Azure' : 'Salesforce'; })]; });
const OTHER_PRODUCTS = [
  ['Marketing Cloud Engagement', 'separate platform', 'replace with a marketing product, or retain and integrate through the gateway'],
  ['Commerce Cloud (B2C)', 'separate platform', 'retain and integrate, or replace with a commerce platform'],
  ['Data Cloud, Tableau', 'separate platforms', 'replace with Microsoft Fabric and Power BI on the new database'],
  ['MuleSoft', 'integration platform', 'its flows move to API Management, Service Bus and Logic Apps'],
  ['Managed packages (for example CPQ)', 'on the core org', 'settings and data taken; behaviour rebuilt, replaced or retained per package'],
];
// What is deployed today (parsed from main.bicep), shown next to the target state.
const bicepSku = (re) => (bicep.match(re) || [])[1];

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
  { id: 'ADR-012', slug: 'azure-paas-hosting', title: 'Host on Azure Container Apps and Azure Database for PostgreSQL', context: 'The platform will grow to many domains, with web traffic, scheduled jobs and event handlers; the client wants no servers to run and zone-level resilience.', decision: 'Run domain services, jobs and the Salesforce sync on a zone-redundant Azure Container Apps environment, and data on PostgreSQL Flexible Server with zone-redundant high availability.', consequences: 'One hosting model for every domain, with scale-to-demand and event-driven jobs; containers keep the option to move to Kubernetes or another cloud.', applies: ['Azure Container Apps', 'Azure Database for PostgreSQL'] },
  { id: 'ADR-013', slug: 'entra-id-sso', title: 'Staff sign in with Entra ID, portal users with Entra External ID; services use managed identities', context: 'Salesforce passwords cannot be exported, and stored service credentials are a leading cause of breaches.', decision: 'OpenID Connect sign-in through Entra ID for staff (matched by Federation ID) and Entra External ID for customer and partner portal users; services reach Key Vault, the database and the event bus with managed identities; integrations use OAuth 2.0 through API Management.', consequences: 'No passwords to migrate or rotate; conditional access and MFA come from the client tenant.', applies: ['Microsoft Entra ID', 'Entra External ID', 'Key Vault', 'API Management'] },
  { id: 'ADR-014', slug: 'private-networking', area: 'target', title: 'Data services are reachable only on private endpoints; the edge is Front Door with WAF', context: 'Customer and revenue data must not be reachable from the internet.', decision: 'PostgreSQL and Key Vault have private endpoints in a spoke virtual network; the app uses VNet integration; public traffic enters only through Front Door with the Web Application Firewall.', consequences: 'One controlled entry point; deployments and administration go through the pipeline or a bastion.', applies: ['Front Door', 'Virtual network', 'Private endpoints'] },
  { id: 'ADR-015', slug: 'domains-with-shared-core', title: 'The platform is split into business domains around a shared core customer domain', context: 'Every Salesforce cloud hangs off the same accounts, contacts, users and products, and the org moves module by module.', decision: 'Group objects into domains (core customer, sales, service, subscriptions, activities and later modules), each owning its objects. Any domain may reference the core; other domains are reached only through their published read views and events.', consequences: 'Modules move and change independently; new Salesforce clouds become new domains without touching existing ones.', applies: DOMAINS.filter((d) => d.inUse).map((d) => d.name) },
  { id: 'ADR-016', slug: 'modular-monolith', title: 'Start as a modular monolith: one deployable and one database, one schema per domain', context: 'Salesforce saves related records in one transaction; splitting every domain into its own service and database from day one would lose that and add operational cost.', decision: 'Deploy all domains as modules of one service on one PostgreSQL server, one schema per domain; enforce boundaries with schema permissions and contract tests. Split a domain into its own service or server only when its scale or release cadence requires it.', consequences: 'Integrity inside a domain stays transactional; boundaries are real, so a later split needs no redesign.', applies: ['Domain services', 'PostgreSQL'] },
  { id: 'ADR-017', slug: 'outbox-events', title: 'Domains talk through events written with a transactional outbox', context: 'A change in one domain often triggers work in another, for example a won opportunity creating a subscription.', decision: 'A domain writes its change and an outbox row in one transaction; a relay publishes it to Service Bus as a CloudEvent; consumers are idempotent. Cases where Salesforce did both in one save are listed and covered by parity tests.', consequences: 'No lost or duplicate side effects; cross-domain effects are eventually consistent within seconds.', applies: ['Service Bus', 'outbox tables'] },
  { id: 'ADR-018', slug: 'single-master-coexistence', title: 'Each object has exactly one master at any time; Salesforce and Azure coexist through the change feed', context: 'Domains move over months while the rest of the org stays on Salesforce; two systems writing the same record would diverge.', decision: 'A system-of-record matrix names the master of every object per wave. Salesforce changes stream through the Pub/Sub API into Event Hubs and update read copies; Azure writes back only fields that remaining Salesforce features still read. The gateway routes each API call to the current master.', consequences: 'No conflicting writes; each wave is reversible; integrations follow the master without code changes.', applies: ['Event Hubs', 'Salesforce sync', 'API Management'] },
  { id: 'ADR-019', slug: 'central-access-model', title: 'One access model for every domain, enforced by row-level security', context: 'Salesforce sharing (role hierarchy, sharing rules, teams, territories) is org-wide; rebuilding it per module would drift.', decision: 'A shared access schema holds groups, the role hierarchy, teams, territories and share tables; every domain’s row-level security policies call the same functions; profiles and permission sets become Entra app roles and database roles.', consequences: 'Users see the same records in every module, through every client of the data; new domains inherit the model.', applies: ['access schema', 'row-level security'] },
  { id: 'ADR-020', slug: 'open-standards', title: 'Build on open standards so the platform is portable', context: 'The client wants to avoid trading one vendor lock-in for another.', decision: 'PostgreSQL for data, OCI containers for compute, OpenAPI 3 for APIs, CloudEvents for events, OpenID Connect and OAuth 2.0 for identity; only infrastructure templates and managed-service wiring are Azure-specific.', consequences: 'The platform can move to another cloud by rewriting infrastructure templates, not the application.', applies: ['PostgreSQL', 'containers', 'OpenAPI', 'CloudEvents'] },
  { id: 'ADR-011', slug: 'parity-as-acceptance', title: 'Behaviour is accepted only when it matches Salesforce’s own values', context: 'Reviewing generated code line by line does not scale.', decision: 'The Verification agent recomputes every calculated value against what Salesforce stored and replays rule cases; CI blocks release on any mismatch.', consequences: 'Correctness is measured, not asserted; new behaviours need new cases.', applies: [P.rel(P.PARITY_CASES)] },
];
ADRS.sort((a, b) => a.id.localeCompare(b.id));
// How the migration is produced (blueprint, AI translation, parity acceptance) is method, not target architecture;
// those records stay in adr/ but the HLD lists only the decisions that shape the target system.
const METHOD = ['ADR-001', 'ADR-010', 'ADR-011'];
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
const n0 = (x) => Number(x).toLocaleString('en-GB');
const adrLink = (id) => `[${id}](adr/${adrFile(ADRS.find((a) => a.id === id))})`;
const runtimeNext = 5 + flowDocs.length + (D.caseRouting ? 1 : 0);
const HLD = [
  '# High-level design: CRM platform on Azure, Subscription domain', '', stamp, '',
  'Structure follows arc42; context and container views follow C4; decisions are recorded as ADRs. The platform is designed to receive every module of the Salesforce org; Subscription Management is its first domain.', '',
  '## 1. Introduction and goals', '',
  table(['', ''], [
    ['Source', `Salesforce org, ${bp.entities.length} objects described`],
    ['Platform scope', `Every module of the org, domain by domain: ${LIVE.map((d) => d.name).join(', ')}`],
    ['First domain', `${CORE.map(label).join(', ')} (pilot)`],
    ['Reference objects', FAMILY.filter((s) => !CORE.includes(s)).map(label).join(', ')],
    ['Target', 'Microsoft Azure: Container Apps, Azure Database for PostgreSQL, Service Bus, Event Hubs, API Management, Front Door, Entra ID, Key Vault, Azure Monitor'],
    ['Data in the first domain', FAMILY.map((s) => `${label(s)} ${ent[s]?.rowCount ?? 0}`).join(' · ')],
  ]), '',
  'Quality goals, in priority order: **behavioural parity** with Salesforce, **security** at least equal to the org’s, **modularity** so any module can be added or moved on its own, **availability** through a zone failure, **operability** with everything as code.', '',
  '## 2. Constraints', '',
  '- Each object has exactly one master at any time: Salesforce until its domain cuts over, Azure after.', '- After the last wave the platform has no dependency on Salesforce.', '- Salesforce record IDs are kept, so integrations, links and reports keep working.', '- Platform services only (no virtual machines), in the client’s own tenant and subscription; data stays in the chosen region.', '- Open standards throughout (PostgreSQL, containers, OpenAPI, CloudEvents, OpenID Connect), so the platform is portable.', '',
  '## 3. Context and scope (C4 level 1)', '', fence(D.c4Context), '',
  'Users and integrated systems use the platform directly. Salesforce feeds changes to it only until each domain is cut over.', '',
  '## 4. Solution strategy', '',
  table(['Concern', 'Approach', 'Decision'], [
    ['Modules', 'Business domains around a shared core customer domain', adrLink('ADR-015')],
    ['Structure', 'Modular monolith: one deployable, one database, one schema per domain', adrLink('ADR-016')],
    ['Dependencies between domains', 'Published read views and events with a transactional outbox', adrLink('ADR-017')],
    ['Coexistence with Salesforce', 'One master per object; change feed and gateway routing', adrLink('ADR-018')],
    ['Security', 'One access model for every domain, enforced by row-level security', `${adrLink('ADR-019')}, ${adrLink('ADR-009')}`],
    ['Identity', 'Entra ID for staff, External ID for portal users, managed identities for services', adrLink('ADR-013')],
    ['Hosting and network', 'Container Apps and PostgreSQL; private endpoints; Front Door with WAF', `${adrLink('ADR-012')}, ${adrLink('ADR-014')}`],
    ['Portability', 'Open standards; only infrastructure templates are Azure-specific', adrLink('ADR-020')],
    ['Records, calculations and rules', 'Salesforce IDs as keys; calculations and rules in the database', 'ADR-002 to ADR-008'],
  ]), '',
  '## 5. Building block view', '',
  '### 5.1 Domain map', '',
  'Domains and the links between them, counted from the relationships in this org. Every domain may use the core customer domain; other links go through read views and events.', '',
  fence(D.domainMap), '',
  table(['Domain', 'Salesforce cloud', 'Objects in this org', 'Records', 'Depends on'], DOMAINS.map((d) => [d.name, d.cloud, d.objs.filter((o) => allEnt[o].rowCount).map((o) => allEnt[o].label || o).join(', ') || '—', n0(d.rows), d.inUse ? dependsOn(d.id).map(dname).join(', ') || '—' : 'not in use in this org'])), '',
  '### 5.2 Containers (C4 level 2)', '', fence(D.c4Container), '',
  table(['Container', 'Technology', 'Responsibility'], [
    ['Edge', 'Azure Front Door Premium with WAF', 'Single public entry point, TLS, protection against common web attacks'],
    ['Integration gateway', 'Azure API Management', 'Salesforce-compatible REST API for integrated systems; routes each object to its current master; OAuth 2.0, throttling, versioning'],
    ['Domain services', 'Node.js on Azure Container Apps', 'Screens and APIs of every domain, one module per domain; sets the database role of the signed-in user on every request'],
    ['Jobs and event handlers', 'Container Apps jobs', 'Scheduled work such as renewal reminders; consumers of domain events'],
    ['Salesforce sync', 'Container Apps', 'Applies the Salesforce change feed to read copies; writes back while Salesforce features still need it'],
    ['Event bus', 'Service Bus Premium, Event Hubs', 'Domain events between domains; the Salesforce change feed'],
    ['Operational database', 'Azure Database for PostgreSQL, Flexible Server', 'One schema per domain plus the shared access schema; rules, calculations and access enforced for every client'],
    ['Secrets and monitoring', 'Key Vault; Application Insights and Log Analytics', 'Credentials read with managed identities; traces, metrics, logs, alerts and audit'],
  ]), '',
  '### 5.3 Inside a domain', '',
  'Every domain is built from the same template, so adding a module repeats a known pattern.', '',
  fence(D.domainTemplate), '',
  '## 6. Runtime view: business processes', '',
  '### 6.1 Subscription lifecycle', '', 'Statuses come from the Status picklist; the notes come from the validation rules that guard each status.', '', fence(D.lifecycle), '',
  '### 6.2 Won deal becomes a subscription', '', 'When an opportunity is marked Closed Won, a subscription is created for the account, once per deal. In the target, Sales publishes an "opportunity won" event and Subscriptions creates the subscription (section 6.' + runtimeNext + ').', '', fence(D.opportunityToSubscription), '',
  '### 6.3 Saving a subscription', '', 'What happens, in Salesforce’s order, every time a subscription is saved.', '', fence(D.subscriptionSave), '',
  ...flowDocs.flatMap((d, i) => [`### 6.${4 + i} ${d.label}`, '', d.description || '', '', fence(D[d.key]), '']),
  `### 6.${4 + flowDocs.length} Renewal reminders`, '', 'A scheduled job raises a renewal task before each active subscription ends.', '', fence(D.renewalBatch), '',
  ...(D.caseRouting ? [`### 6.${5 + flowDocs.length} Case routing and escalation`, '', 'Assignment rules route each new case; escalation rules raise cases that miss their target time. These belong to the Service domain.', '', fence(D.caseRouting), ''] : []),
  ...(escalation ? [table(['Escalation rule', 'Applies when'], escalation.entries.map((e, i) => [i + 1, e.criteria.map((c) => c.replace('US,USA,United States,United States of America', 'US').replace(/^(Account|Case)\./, '').replace(/__c\b/g, '').replace(/equals/g, '=').replace(/notEqual/g, '≠')).join('; ')])), ''] : []),
  `### 6.${runtimeNext} Working alongside Salesforce`, '', 'While Sales is still on Salesforce, its changes reach the platform through the change feed; once Subscriptions has moved, its changes go back to Salesforce only where Salesforce features still read them.', '', fence(D.coexistence), '',
  '## 7. Deployment view', '',
  '### 7.1 Target deployment on Azure', '',
  'One region with three availability zones, a paired region for backups, and private networking in a spoke virtual network connected to the client’s landing zone. Every domain runs in the same Container Apps environment.', '',
  fence(D.deployment), '',
  '### 7.2 Services and sizing', '',
  table(['Component', 'Azure service', 'Production', 'Proof of concept today'], [
    ['Edge', 'Front Door Premium + WAF', 'Managed rule set, bot protection', 'not deployed'],
    ['Domain services, jobs, sync', 'Container Apps', 'Dedicated workload profile, zone redundant, 2+ replicas, scale rules per app', `App Service ${bicepSku(/appSku string = '([^']+)'/) || 'B1'}, single instance`],
    ['Database', 'Azure Database for PostgreSQL, Flexible Server', 'General Purpose, zone-redundant HA, geo-redundant backups', `${bicepSku(/name: '(Standard_[^']+)'/) || 'Burstable'} (Burstable), 7-day backups`],
    ['Event bus', 'Service Bus Premium, Event Hubs Standard', 'Private endpoints, geo-disaster recovery pairing', 'not deployed'],
    ['Integration gateway', 'API Management', 'Standard v2, VNet integrated', 'not deployed'],
    ['Secrets', 'Key Vault', 'Private endpoint, RBAC, purge protection', 'secrets set at deploy time'],
    ['Identity', 'Entra ID, Entra External ID', 'Single sign-on, conditional access, managed identities', 'in-app sign-in'],
    ['Monitoring', 'Application Insights + Log Analytics', 'Alerts, dashboards, 90-day retention; Microsoft Sentinel', 'health check'],
    ['Infrastructure', 'Bicep, GitHub Actions', 'One template per environment: development, test, production', 'one Bicep template'],
  ]), '',
  '### 7.3 Environments and release', '',
  table(['Environment', 'Purpose', 'Data'], [['Development', 'Build and unit tests', 'Synthetic'], ['Test', 'Parity, security and user acceptance tests', 'Masked copy of production'], ['Production', 'Live service', 'Live']]), '',
  'Each release is built once as a container image, deployed as a new revision with no traffic, smoke tested, then given the traffic; moving traffic back is the rollback. Domains release together while they share one deployable.', '',
  '### 7.4 Availability and recovery', '',
  table(['Event', 'What happens', 'Target'], [
    ['Replica failure', 'Container Apps replaces the replica; others keep serving', 'no downtime'],
    ['Zone failure', 'Replicas in other zones serve; the database fails over to its standby zone', 'about 2 minutes, no data loss'],
    ['Region failure', 'Restore from geo-redundant backup in the paired region', 'RTO hours, RPO under 1 hour'],
    ['Bad release', 'Move traffic back to the previous revision', 'minutes'],
  ]), '',
  '## 8. Cross-cutting concepts', '',
  '### 8.1 Data model of the first domain', '', fence(D.dataModel), '',
  '### 8.2 Security across domains', '',
  'Identity, roles and sharing are one shared model. Every domain schema enforces it with row-level security that calls the same access functions, so a user sees the same records in every module and through every client of the data.', '',
  fence(D.accessModel), '',
  table(['Salesforce concept', 'Target'], [
    ['Users, single sign-on', 'Entra ID (staff), Entra External ID (customer and partner portals)'],
    ['Profiles and permission sets', 'Entra app roles and database roles'],
    ['Field-level security', 'Column grants per role'],
    ['Org-wide defaults, role hierarchy, sharing rules, teams, territories', 'Access schema (groups, hierarchy closure, share tables) used by row-level security'],
    ['Shield Platform Encryption', 'Encryption at rest with customer-managed keys in Key Vault'],
    ['Field Audit Trail, setup audit', 'Audit tables and Log Analytics, kept as long as policy requires'],
    ['Personal data in sandboxes', 'Microsoft Purview classification; masked copies in test'],
  ]), '',
  '#### Roles in the first domain', '', 'Each profile or permission set becomes a database role; field-level security becomes column grants; subscriptions inherit access from their account.', '', fence(D.security), '',
  '### 8.3 Migration waves and system of record', '',
  'Domains move one at a time. Core customer data and every in-use domain start as read copies fed by the change feed; a domain becomes master in Azure in its wave; the core moves last, when nothing left in Salesforce writes to it.', '',
  table(['Wave', 'What happens'], WAVES.map((w) => [w.name, w.does])), '',
  table(['Domain', ...WAVES.slice(1, -1).map((w) => w.name.split(':')[0])], sorMatrix), '',
  '#### Load order in the first domain', '', 'Records load parent first, in dependency order, keeping every Salesforce record ID.', '', fence(D.loadOrder), '',
  '### 8.4 Integration and events', '',
  table(['Concern', 'Standard'], [
    ['External APIs', 'REST with OpenAPI 3, versioned, through API Management; a Salesforce-compatible facade so callers keep working during the move'],
    ['Events between domains', 'CloudEvents on Service Bus, written through a transactional outbox; consumers are idempotent'],
    ['Salesforce change feed', 'Pub/Sub API (Change Data Capture) into Event Hubs, applied in order per record'],
    ['Reads across domains', 'Published read views only; no domain writes into another domain’s schema'],
  ]), '',
  '### 8.5 Adding the next module', '',
  '1. Discover and design it as a domain; place it on the domain map and the system-of-record matrix.', '2. Generate its schema, rules, access policies and API from the same template; publish its read views and events.', '3. Start it as a read copy fed by the change feed; run the parity and security tests.', '4. Switch its users and integrations in its wave; Salesforce keeps a read-only copy until decommission.', '',
  '### 8.6 Salesforce products outside the core org', '',
  table(['Product', 'Kind', 'Route'], OTHER_PRODUCTS), '',
  '### 8.7 Observability', '', 'Services and jobs send traces, metrics and logs to Application Insights; Azure resources send diagnostics to Log Analytics; Microsoft Sentinel watches security events. Alerts cover availability, error rate, response time, event backlog, sync lag, database CPU and storage, and failed sign-ins.', '',
  '### 8.8 Traceability', '', 'The LLD’s traceability matrix links each Salesforce element to its target design, database object and test.', '',
  '## 9. Architecture decisions', '', table(['ADR', 'Decision'], ADRS.filter((a) => !METHOD.includes(a.id)).map((a) => [`[${a.id}](adr/${adrFile(a)})`, a.title])), '',
  '## 10. Quality requirements', '',
  table(['Quality', 'Scenario', 'How it is measured'], [
    ['Parity', 'Every calculated value and rule outcome matches Salesforce', 'Automated parity tests, blocking in the release pipeline'],
    ['Security', 'A user sees and edits only what Salesforce allows, in every domain', 'Security tests per role and domain; row-level security and column grants'],
    ['Modularity', 'A new module is added without changing existing domains', 'Contract tests on read views and events; schema permissions between domains'],
    ['Availability', 'The service keeps running through the loss of a zone', 'Zone-redundant services and database; failover drill each quarter'],
    ['Performance', 'Screens respond in under 2 seconds at peak load; sync lag under 1 minute', 'Application Insights and event-backlog alerts; load test before each wave'],
    ['Operability', 'Any environment can be rebuilt from source', 'Bicep templates and the pipeline; no manual changes'],
  ]), '',
  '## 11. Risks and technical debt', '',
  table(['Item', 'Status'], [
    ['Cross-domain saves that Salesforce made in one transaction', 'Listed per wave and covered by parity tests (ADR-017)'],
    ['Activities refer to records in every domain', 'Activities move with the core in the last wave'],
    ['Custom code translated', translated.length ? translated.join(', ') : 'none yet'],
    ['Automations still to translate', bp.automations.filter((a) => a.translation === 'agent' && a.scope !== 'out_of_scope').map((a) => a.source.name).filter((n) => !translated.some((t) => t.startsWith(n))).join(', ') || 'none'],
    ['Production services not yet deployed', 'Front Door, API Management, Container Apps, event bus, private networking (section 7.2)'],
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
  'Field lists, rules and automations are read from the org; each item shows its target design on Azure Database for PostgreSQL and the decision record behind it.', '',
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
  // Diagrams already in the HLD are referenced, not repeated: each diagram lives in one document.
  '### 4.1 Order of execution: subscription', '', 'Shown in HLD section 6.3, Saving a subscription.', '',
  '### 4.2 Order of execution: subscription line', '', fence(D.lineSave), '',
  ...flowDocs.flatMap((d, i) => [`### 4.${3 + i} Flow: ${d.label}`, '', `Shown in HLD section 6.${4 + i}, ${d.label}.`, '']),
  '## 5. Services', '',
  table(['Class', 'Methods', 'Reads', 'Writes', 'Called by', 'Constants'], bp.services.map((s) => [s.source.name, (s.methods || []).join(', '), (s.reads || []).map(label).join(', '), (s.writes || []).map(label).join(', '), (s.calledBy || []).map((c) => c.split(':')[1]).join(', '), Object.entries(s.constants || {}).map(([k, v]) => `${k} = ${v}`).join(', ')])), '',
  '## 6. Security', '',
  table(['Role (from Salesforce)', ...CORE.map(label)], rolesShown.map((r) => [`${r.kind === 'profile' ? 'Profile' : 'Permission set'}: ${r.name}`, ...CORE.map((o) => (r.objects?.[o] || []).join(', ') || '—')])), '',
  'How roles, column grants and row-level security fit together is shown in HLD section 8.2, Security across domains.', '',
  '## 7. Data load', '',
  table(['Order', 'Object', 'Rows', 'Depends on'], [...FAMILY].sort((a, b) => level[a] - level[b]).map((s) => [level[s] + 1, label(s), ent[s]?.rowCount ?? 0, [...deps[s]].map(label).join(', ') || '—'])), '',
  'The load levels, and the migration waves this domain belongs to, are shown in HLD section 8.3.', '',
  '## 8. Migrations', '',
  table(['Order', 'Script', 'Contents'], sql.map((s, i) => { const f = path.basename(s.file); return [i + 1, `\`${f}\``, { '000': 'runtime helpers (time zone, load mode)', '010': 'tables, keys, constraints and generated columns', '020': 'views for cross-object and date-dependent fields', '030': 'roll-up totals and their recompute function', '040': 'rule guards that need the previous row or a parent', '050': 'translated business logic', '060': 'roles, column grants and row-level security' }[f.slice(0, 3)] || '']; })), '',
  'Scripts are numbered and applied in order by the release pipeline; each is idempotent, so any environment can be rebuilt.', '',
  '## 9. Patterns used', '',
  table(['Pattern', 'Where', 'Why'], [
    ['Generated column', 'row-local formulas', 'Always correct without application code'],
    ['Materialised aggregate with recompute backstop', 'roll-up summaries', 'Fast reads, self-healing after loads'],
    ['Guard trigger', 'rules needing the previous row or a parent', 'Same rejection point and message as Salesforce'],
    ['Role-based access + row-level security', '`060_security.sql`', 'Access enforced in the database for every client'],
    ['Idempotent, dependency-ordered load', 'data migration', 'Repeatable loads; triggers deferred, totals recomputed once'],
    ['Golden-master testing (parity)', 'parity tests', 'Salesforce’s own values are the expected results'],
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
