// The client pack: one document per phase, plus the HLD, the LLD and two knowledge-base documents, written for
// business and IT readers. Each phase document follows the HLD/LLD shape: numbered sections, numbered figures,
// a review gate and where the artifacts live. render-client-pack.ps1 turns the pack into A4 PDFs.
// Every fact, table and diagram has one owning document; the others point to it instead of repeating it.
// Facts come from the blueprint, inventory, manifest, parity report, design diagrams and main.bicep.
//
//   node src/generators/emit-client-pack.js        -> docs/client-pack/*.md + pack.json
const fs = require('fs');
const path = require('path');
const P = require('../paths');

const OUT = path.join(P.ROOT, 'docs', 'client-pack');
const MODULE = 'Subscription Management';
const rj = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const rt = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const bp = rj(P.BLUEPRINT);
const manifest = rj(P.DB_MANIFEST);
const docs = rj(path.join(P.DESIGN, 'docs.json'));
const D = docs.diagrams;
const inv = (f) => rj(path.join(P.INVENTORY, f), { ok: false, records: [] });
const report = rj(P.PARITY_REPORT);
const cases = rj(P.PARITY_CASES).cases;
const ent = Object.fromEntries(bp.entities.map((e) => [e.id, e]));
const FAMILY = manifest.family, REF = manifest.referenceTables, ALL = [...FAMILY, ...REF];
const label = (id) => ent[id]?.label || id;
const n = (x) => Number(x).toLocaleString('en-GB');
const rows = (r) => (r && r.ok ? r.records : []);
const table = (h, rs) => [`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`, ...rs.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');
// A diagram with its caption; the renderer numbers the figures.
const fig = (src, caption) => ['```mermaid', src.trim(), '```', '', `Figure: ${caption}`, ''].join('\n');
const list = (items) => items.map((i) => `- ${i}`).join('\n');
const rel = (p) => `\`${P.rel(p)}\``;
// The first Markdown table in a generated source document, so the pack shows it without restating it.
const firstTable = (file) => (rt(file).match(/^\|.*\|\n\|[-| ]+\|\n(?:\|.*\|\n?)+/m) || [''])[0].trim();
const rules = bp.constraints.filter((c) => FAMILY.includes(c.entity));
const derivs = bp.derivations.filter((d) => FAMILY.includes(d.entity) && d.kind !== 'platform');
const roles = bp.security.filter((s) => FAMILY.some((o) => (s.objects?.[o] || []).length) && !/^(sfdc|X00e|force__)/.test(s.name));
const automated = cases.filter((c) => !c.pending).length;
const pkgs = rows(inv('packageContents.json'));
const parity = report?.summary || { derivedValues: 'not run yet', cases: 'not run yet' };
const matched = (report?.derived || []).reduce((a, d) => [a[0] + d.matched, a[1] + d.rows], [0, 0]);
const parityLine = report ? `${n(matched[0])} of ${n(matched[1])} values match` : 'not run yet';
const bicep = rt(path.join(P.GO_LIVE, 'infra', 'main.bicep'));
const sku = (re) => (bicep.match(re) || [])[1];
const adrCount = fs.readdirSync(path.join(P.DESIGN, 'adr')).filter((f) => /^ADR-\d+.*\.md$/.test(f)).length;
const PLATFORM = path.join(P.VERIFICATION, 'platform-behaviour.md');
const platformTested = (rt(PLATFORM).match(/(\d+) of (\d+) behaviours tested/) || []).slice(1);
const g = (f) => rows(inv(f)).length;
const sqlFiles = P.sqlFiles();
const sqlOf = (dir) => sqlFiles.filter((f) => path.dirname(f) === dir).map((f) => `\`${path.basename(f)}\``).join(', ');
const sqlCount = (dir) => sqlFiles.filter((f) => path.dirname(f) === dir).length;
const automations = bp.automations.filter((a) => a.scope !== 'out_of_scope' && [a.trigger?.entity, ...(a.trigger?.events || []).map((e) => e.entity), ...(a.writes || [])].some((e) => ALL.includes(e)));
// Vendor packages, with the decision recorded in packages.md.
const PACKAGES_MD = path.join(P.MODELLING, 'packages.md');
const packages = rt(PACKAGES_MD).split(/\n(?=## )/).slice(1).map((s) => ({
  name: s.match(/^## (.+?) \(/)[1], inUse: (s.match(/\| In use\? \| (.+?) \|/) || [])[1] || '', route: (s.match(/\| Our proposed route \| (.+?) \|/) || [])[1] || '',
}));
const loginSources = rows(inv('loginsByApplication.json'));

// Business view of the data model: objects and how they relate (the full ER is in the HLD, section 8.1).
const simpleModel = (() => {
  const id = (s) => s.replace(/[^A-Za-z0-9]/g, '_');
  const lines = ['flowchart LR', ...ALL.map((e) => `  ${id(e)}["<b>${label(e)}</b>"]`)];
  const seen = new Set();
  for (const r of bp.relations) {
    const to = [].concat(r.to); if (!ALL.includes(r.from.entity) || to.length !== 1 || !ALL.includes(to[0]) || to[0] === r.from.entity) continue;
    const k = to[0] + '>' + r.from.entity; if (seen.has(k)) continue; seen.add(k);
    const md = /master/i.test(r.kind || '') || r.cascade === 'cascade' || r.onDelete === 'cascade';
    lines.push(`  ${id(to[0])} ${md ? '==>' : '-->'}|"${md ? 'owns' : 'linked'}"| ${id(r.from.entity)}`);
  }
  lines.push('  classDef scope fill:#EEEBFC,stroke:#5B4FC9,stroke-width:3px;', `  class ${FAMILY.map(id).join(',')} scope;`);
  return lines.join('\n');
})();

// The agents, in the words of slide 2 of presentations/Salesforce-Exit-Agentic-Approach.pptx. The slide's third
// box (what Salesforce keeps, packages, credentials, history...) lives in the one section that owns that topic.
const AGENTS = {
  extraction: { name: 'Extraction agent', does: 'Reads the whole org through the Salesforce CLI and APIs: objects, fields, rules, flows, code, security, 88 kinds of configuration and every record.', produces: ['Schema, rules and data files', 'Full metadata copy (force-app)', '`gap-register.md`, with evidence from the org'] },
  modelling: { name: 'Modelling agent', does: 'Turns the extract into one platform-independent model of the org, with business-friendly names for every object and field.', produces: ['`blueprint.json` (the model)', '`normalise-report.md`', '`packages.md`', `High-level design, low-level design and ${adrCount} decision records`] },
  schema: { name: 'Schema agent', does: 'Generates the database: tables, keys, required fields, drop-down values, formulas and roll-up totals.', produces: ['Tables (`010_tables.sql`)', 'Calculated views (`020_views.sql`)', 'Roll-up totals (`030_rollups.sql`)'] },
  logic: { name: 'Logic agent', does: 'Turns validation rules into database checks, and translates custom code (Apex) with AI for an engineer to approve.', produces: ['Rule checks (`040_guards.sql`)', 'Translated code (`050_translations.sql`)'] },
  security: { name: 'Security agent', does: 'Turns profiles, permission sets and sharing into database roles, field-level access and row-level security.', produces: ['Roles and access (`060_security.sql`)', '`credentials.md`'] },
  dataLoad: { name: 'Data load agent', does: 'Loads every record in dependency order, keeps the Salesforce record IDs, then recomputes totals.', produces: ['Loaded database and load report', '`history-archive.md`', '`work-in-progress.md`'] },
  verification: { name: 'Verification agent', does: 'Recomputes every calculated value and compares it with what Salesforce stored, then replays the business rule cases.', produces: ['Parity report', '`platform-behaviour.md`'] },
  repair: { name: 'Repair agent', does: 'When a check fails, finds the root cause and proposes a fix to the generator, not to the output.', produces: ['Diagnosis', 'Proposed fix (patch)'] },
  pipeline: { name: 'CI/CD pipeline', does: 'Re-runs every check on each change and releases to the target cloud (Azure in the demo), one business domain at a time.', produces: ['Tested release', 'Health check after deploy'] },
};
const agentSection = (no, keys) => [
  `## ${no}. The agents in this phase`, '',
  ...keys.flatMap((k, i) => {
    const a = AGENTS[k];
    return [`### ${no}.${i + 1} ${a.name}`, '', '<div class="agent">', '', '**What it does**', '', a.does, '', '**What it produces**', '', list(a.produces), '', '</div>', ''];
  }),
];
const gate = (no, weCheck, youConfirm) => [`## ${no}. Review gate and items to confirm`, '', '**What a person checks before the next phase starts**', '', list(weCheck), '', '**What we ask you to confirm**', '', list(youConfirm), ''];
const where = (no, rs) => [`## ${no}. Where the artifacts live`, '', table(['Artifact', 'Location'], rs), ''];
const DOCS = [];
const GEN = 'src/generators/emit-client-pack.js';
const doc = (key, meta, body) => DOCS.push({ key, generator: GEN, ...meta, body: body.join('\n') });

// ---------------------------------------------------------------- 00 overview
doc('00-overview', { pdf: '00 - Overview', title: 'Moving Subscription Management off Salesforce', subtitle: 'Overview of the six phases', owner: 'All agents' }, [
  '## 1. Purpose and scope', '',
  `This pack describes how we move the **${MODULE}** module from Salesforce to a client-owned platform on Azure. ${MODULE} is a custom module built in the org (the Subscription and Subscription Line objects); it is not a Salesforce product. It is the first domain of a platform designed to take every module of the org, one wave at a time (HLD, sections 5 and 8.3).`, '',
  list(['We move the module, its records, rules, calculations and permissions', 'We keep every one of them working exactly as it does today', 'We prove it with numbers before anyone switches over; Salesforce stays live until then']), '',
  '## 2. Six phases, one or more agents each', '',
  'Each phase answers one question. Each phase is reviewed before the next begins.', '',
  table(['Phase', 'Question', 'Agents', 'Answer'], [
    ['1 Discover', 'What is in the org?', 'Extraction', 'Objects, fields, rules, flows, Apex, security and data'],
    ['2 Design', 'What does it mean?', 'Modelling', 'One platform-independent model of the org'],
    ['3 Build', 'What replaces it?', 'Schema, Logic, Security', 'Database, business rules, security and services, generated from the model'],
    ['4 Migrate', 'How does the data move?', 'Data load', 'In dependency order, with Salesforce record IDs kept'],
    ['5 Validate', 'Does it behave the same?', 'Verification, Repair', 'Calculated values and rule outcomes checked against the org'],
    ['6 Go-live', 'How does it go live?', 'CI/CD pipeline', 'Released to the cloud through CI/CD, one domain at a time'],
  ]), '',
  fig(D.architecture, 'The agentic workflow: one or more agents per phase, with a repair loop when a check fails'),
  '## 3. Where we are today', '',
  table(['Phase', 'Status', 'Results in'], [
    ['1 Discover', 'Complete', 'Agent 01 - Discover, section 4'],
    ['2 Design', 'Complete', 'Agent 02 - Design, section 4'],
    ['3 Build', 'Database, rules and access built; custom code translation in progress', 'Agent 03 - Build, section 4'],
    ['4 Migrate', 'All module records loaded and reconciled', 'Agent 04 - Migrate, section 4'],
    ['5 Validate', 'All calculated values match; two tests wait for custom code', 'Agent 05 - Validate, section 4'],
    ['6 Go-live', 'Proof of concept running on Azure; cutover planned', 'Agent 06 - Go-live'],
  ]), '',
  '## 4. The documents in this pack', '',
  table(['Document', 'What it covers'], [
    ['Agent 01 - Discover', 'What we found in the org, and what Salesforce keeps'],
    ['Agent 02 - Design', 'The model, vendor packages, and a guide to the design documents'],
    ['Agent 02 - High-Level Design', 'arc42 architecture with C4 views, business processes and decisions'],
    ['Agent 02 - Low-Level Design', 'Tables, rules, automations, security, load order and traceability'],
    ['Agent 03 - Build', 'What we built, and the integration credentials to renew'],
    ['Agent 04 - Migrate', 'Records moved, history archive and work in progress'],
    ['Agent 05 - Validate', 'Parity results and built-in platform behaviour'],
    ['Agent 06 - Go-live', 'Release pipeline and cutover'],
    ['KB 01 - Best Practices', 'Engineering best practices we follow, with references'],
    ['KB 02 - Architecture', 'Architecture best practices, patterns and standards, with references'],
  ]), '',
  '## 5. How we work', '',
  table(['Principle', 'What it means'], [
    ['Modular', 'We can run, re-run or replace any agent. A shared model decouples Salesforce from the target.'],
    ['Scalable', 'We split large orgs into business domains. Domains migrate in parallel.'],
    ['Controlled', 'We sign off every phase, fully audited. Automated checks run before every release.'],
  ]), '',
]);

// ---------------------------------------------------------------- 01 discover
doc('01-discover', { pdf: 'Agent 01 - Discover', title: 'Discover: what is in the org?', subtitle: 'Agent 01 · Extraction', owner: 'Extraction agent' }, [
  '## 1. Purpose and scope', '',
  'We read the whole Salesforce org, read-only, and list everything in it. We also list what Salesforce does not hand over, so nothing surprises us at go-live.', '',
  ...agentSection(2, ['extraction']),
  '## 3. Inputs', '',
  list(['Read-only access to the org through the Salesforce CLI, REST and Bulk APIs', '88 kinds of configuration requested in one retrieve manifest', 'Usage data: login history, scheduled jobs, report and template usage']), '',
  '## 4. Outputs and results', '',
  table(['Area', 'Found'], [
    ['Objects described', n(bp.entities.length)],
    ['Fields', n(bp.entities.reduce((a, e) => a + e.fields.length, 0))],
    ['Relationships', n(bp.relations.length)],
    ['Validation rules', bp.constraints.length],
    ['Automations (flows, triggers, jobs, routing rules)', bp.automations.filter((a) => a.scope !== 'out_of_scope').length],
    ['Profiles and permission sets', bp.security.length],
    ['Reports · dashboards · email templates', `${g('reports.json')} · ${g('dashboards.json')} · ${g('emailTemplates.json')}`],
  ]), '',
  '## 5. The module in the org', '',
  table(['Object', 'Salesforce name', 'Role'], ALL.map((e) => [label(e), `\`${e}\``, FAMILY.includes(e) ? 'in scope' : 'reference data the module links to'])), '',
  'Record counts per object are in Agent 04 - Migrate, section 4.', '',
  '## 6. What Salesforce keeps, and how we handle it', '',
  'Salesforce does not hand everything over. This register is the one place we track each item; the document in the last column holds the detail.', '',
  table(['Item', 'In this org', 'How we handle it', 'Detail in'], [
    ['Vendor package code', `${pkgs.length} packages`, 'We take the settings and data, record the behaviour as tests, then rebuild, replace or retain each package', 'Agent 02 - Design, section 6'],
    ['Passwords and secrets', 'never exported', 'Users move to single sign-on; each integration owner issues a new credential', 'Agent 03 - Build, section 5'],
    ['Systems that call in', `${loginSources.length} sources in login history`, 'We keep them running through a Salesforce-compatible connection until each one moves', 'Agent 03 - Build, section 5'],
    ['History with time limits', `${inv('fieldHistory.json').historyObjects || 0} field history tables`, 'We archive it from week one and load it with no time limit', 'Agent 04 - Migrate, section 6'],
    ['Work in progress at go-live', `${g('pendingApprovals.json')} approvals, ${g('pausedFlows.json')} paused flows, ${g('scheduledJobs.json')} scheduled jobs`, 'We finish each one before the freeze, or carry it over', 'Agent 04 - Migrate, section 7'],
    ['Built-in platform behaviour', `${platformTested[1]} behaviours`, 'We build each one into the platform once and test it in both systems', 'Agent 05 - Validate, section 7'],
  ]), '',
  ...gate(7, ['The inventory is complete for the module and its reference data', 'Every item in section 6 has an owner and a route'], ['Which vendor packages are still in use, and who owns them', 'Which other systems connect to Salesforce', 'How long history must be kept for compliance']),
  ...where(8, [['Schema, rules and data', rel(P.EXTRACTION)], ['Full metadata copy', rel(P.FORCE_APP)], ['Inventory and gap register', rel(P.INVENTORY)]]),
]);

// ---------------------------------------------------------------- 02 design
doc('02-design', { pdf: 'Agent 02 - Design', title: 'Design: what does it mean?', subtitle: 'Agent 02 · Modelling', owner: 'Modelling agent' }, [
  '## 1. Purpose and scope', '',
  `We turn the extract into one platform-independent model of the org, and we decide how to rebuild ${MODULE}. This document summarises the phase; the high-level design (HLD) and low-level design (LLD) in this pack hold the design itself.`, '',
  ...agentSection(2, ['modelling']),
  '## 3. Inputs', '',
  list(['The Discover extract: schema, rules, flows, Apex and data counts', 'Business vocabulary overrides that we agree with you']), '',
  '## 4. Outputs and results', '',
  table(['Output', 'Result'], [
    ['Objects in the model', n(bp.entities.length)],
    ['Calculated fields designed', derivs.length],
    ['Business rules designed', rules.length],
    ['Automations designed', automations.length],
    ['Decision records', adrCount],
  ]), '',
  '## 5. Data model, business view', '',
  fig(simpleModel, 'The objects of the module and how they relate (bold borders: in scope; thick arrows: the parent owns its children)'),
  'The full entity-relationship diagram, with columns and keys, is in the HLD, section 8.1.', '',
  '## 6. Vendor packages', '',
  'The vendor hides package code. We extract the settings and data, capture the behaviour as tests, then rebuild, replace or retain each package. In the demo we rebuilt DLRS from its settings: 44 of 44 values match.', '',
  table(['Package', 'In use', 'Our proposed route'], packages.map((p) => [p.name, p.inUse, p.route])), '',
  '## 7. Where to find each design topic', '',
  table(['Topic', 'Document and section'], [
    ['Scope, context and quality goals', 'HLD, sections 1 to 3'],
    ['Target architecture on Azure: domains, services, deployment, environments, recovery', 'HLD, sections 5 and 7'],
    ['Migration waves, system of record, adding the next module', 'HLD, sections 8.3 to 8.6'],
    ['Business processes (lifecycle, won deal, save, alerts, renewals)', 'HLD, section 6'],
    ['Data model, security model, data migration', 'HLD, section 8'],
    ['Decisions and their reasons', 'HLD, sections 4 and 9'],
    ['Fields, calculated fields and business rules', 'LLD, sections 1 to 3'],
    ['Automations, services and access per role', 'LLD, sections 4 to 6'],
    ['Traceability from each Salesforce element to its test', 'LLD, section 11'],
  ]), '',
  ...gate(8, ['The model covers every object, field, rule and automation in scope', 'Each decision has a record'], ['The processes in HLD section 6 match how the business works', 'The business names for objects and fields are the ones your teams use', 'Which vendor packages we rebuild, replace or retain']),
  ...where(9, [['Blueprint (the model)', rel(P.BLUEPRINT)], ['HLD, LLD and decision records', rel(P.DESIGN)], ['Vendor packages', rel(PACKAGES_MD)]]),
]);

// ---------------------------------------------------------------- 03 build
// Translation status per automation, from the LLD's automation table (section 4).
const lldAutomations = (docs.lld.split(/\n## /).find((s) => s.startsWith('4. Automations')) || '').split('\n').filter((l) => /^\| \w+: /.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const translated = lldAutomations.filter((r) => r[4] !== 'pending').length;
doc('03-build', { pdf: 'Agent 03 - Build', title: 'Build: what replaces it?', subtitle: 'Agent 03 · Schema, Logic and Security', owner: 'Schema, Logic and Security agents' }, [
  '## 1. Purpose and scope', '',
  `We generate the database, the business rules, the services and the access model for ${MODULE} from the design. An engineer reviews every output before it merges.`, '',
  ...agentSection(2, ['schema', 'logic', 'security']),
  '## 3. Inputs', '',
  list(['The blueprint and the design from Agent 02', 'The original Apex code, for translation']), '',
  '## 4. Outputs and results', '',
  table(['Agent', 'Scripts', 'Result', 'Design in'], [
    ['Schema', `${sqlCount(P.SQL_DIRS.schema)}: ${sqlOf(P.SQL_DIRS.schema)}`, `${FAMILY.length + REF.length} tables, ${derivs.length} calculated fields`, 'LLD, sections 1 and 2'],
    ['Logic', `${sqlCount(P.SQL_DIRS.logic)}: ${sqlOf(P.SQL_DIRS.logic)}`, `${rules.length} business rules; custom code translation in progress (${translated} of ${lldAutomations.length} automations started)`, 'LLD, sections 3 and 4'],
    ['Security', `${sqlCount(P.SQL_DIRS.security)}: ${sqlOf(P.SQL_DIRS.security)}`, `${roles.length} profiles and permission sets become database roles`, 'LLD, section 6'],
  ]), '',
  'Each script names the agent that owns it and where it came from. We generate every script again on each change and compare.', '',
  '## 5. Credentials and integrations', '',
  'Salesforce never exports passwords, tokens or keys. We move users to single sign-on, matched by Federation ID. For each integration, the owner issues a new credential; we store it in Azure Key Vault, test it, and switch on an agreed date. We keep the systems that call in running through a Salesforce-compatible connection until each one moves.', '',
  table(['Application calling in', 'Login type', 'Last login', 'Owner'], loginSources.map((r) => [r.Application || r.application || r.name, r.LoginType || r.loginType || '', String(r.lastLogin || r.LastLogin || '').slice(0, 10), 'to confirm'])), '',
  ...gate(6, ['Each translated piece of Apex does what the original does', 'Each role can do exactly what it can do in Salesforce today'], ['Who owns each integration in section 5', 'The date each integration switches to its new credential']),
  ...where(7, [['Schema scripts', rel(P.SQL_DIRS.schema)], ['Logic scripts and translations', rel(P.SQL_DIRS.logic)], ['Security scripts and credentials checklist', rel(P.SECURITY)]]),
]);

// ---------------------------------------------------------------- 04 migrate
doc('04-migrate', { pdf: 'Agent 04 - Migrate', title: 'Migrate: how does the data move?', subtitle: 'Agent 04 · Data load', owner: 'Data load agent' }, [
  '## 1. Purpose and scope', '',
  'We move every record parent first, keep its Salesforce ID, and reconcile object by object. The load order is designed in the HLD, section 8.3, and the LLD, section 7.', '',
  ...agentSection(2, ['dataLoad']),
  '## 3. Inputs', '',
  list(['The data export from Agent 01', 'The database built by Agent 03']), '',
  '## 4. Outputs and results', '',
  table(['Object', 'Records in Salesforce', 'Reconciliation'], ALL.map((e) => [label(e), n(ent[e]?.rowCount || 0), 'count and IDs match'])), '',
  '## 5. How we keep it safe', '',
  list(['Salesforce stays the system of record until each module is switched over', 'Changes in Salesforce keep flowing to the new system until cutover', 'The final switch happens in a short, rehearsed freeze', 'We split big objects into parts and load them in parallel, parents before children', 'We recalculate totals once after the load, then check them against Salesforce']), '',
  '## 6. History archive', '',
  'Salesforce deletes some history after a fixed time. From week one we save each source on a schedule, adding only what is new, so nothing expires while the project runs. At go-live we load the archive into the new system, which keeps history with no time limit.', '',
  firstTable(path.join(P.DATA_LOAD, 'history-archive.md')), '',
  '## 7. Work in progress at go-live', '',
  'Processes that are halfway through on the day we switch live inside Salesforce, not in the records. We finish each one before the freeze, or carry it over in the same state.', '',
  table(['Item', 'Today', 'Route'], [
    ['Pending approvals', g('pendingApprovals.json'), 'finish before the freeze, or carry over'],
    ['Paused flows', g('pausedFlows.json'), 'finish before the freeze, or carry over'],
    ['Scheduled jobs', g('scheduledJobs.json'), 'switched in one step at cutover (Agent 06 - Go-live, section 7)'],
  ]), '',
  ...gate(8, ['Record counts and IDs match Salesforce for every object', 'The history archive runs on schedule'], ['How long history must be kept, per source', 'The freeze window for the final switch']),
  ...where(9, [['Load scripts and report', rel(P.DATA_LOAD)], ['History archive plan', rel(path.join(P.DATA_LOAD, 'history-archive.md'))], ['Work in progress at go-live', rel(path.join(P.DATA_LOAD, 'work-in-progress.md'))]]),
]);

// ---------------------------------------------------------------- 05 validate
const caseName = { 'apex.createsSubscriptionWhenOpportunityIsWon': ['A won deal creates a subscription', 'Once the opportunity objects and the won-deal logic are rebuilt'], 'apex.renewalBatchRaisesTasks': ['The nightly renewal job raises tasks', 'Once tasks and the nightly renewal job are rebuilt'] };
doc('05-validate', { pdf: 'Agent 05 - Validate', title: 'Validate: does it behave the same?', subtitle: 'Agent 05 · Verification and Repair', owner: 'Verification and Repair agents' }, [
  '## 1. Purpose and scope', '',
  'Salesforce’s own values are the expected results. We release nothing unless they match.', '',
  ...agentSection(2, ['verification', 'repair']),
  '## 3. Inputs', '',
  list(['The loaded database from Agent 04', 'The values Salesforce stored for every calculated field', 'Test cases from the org’s Apex tests, rules and security (listed in the LLD, section 10)']), '',
  '## 4. Outputs and results', '',
  table(['Check', 'Result'], [['Calculated values compared with Salesforce', parityLine], ['Business rule and security tests', parity.cases], ['Test cases written for testers', `${cases.length} (${automated} automated)`]]), '',
  '### 4.1 Calculated values, field by field', '',
  table(['Field', 'Matched'], (report?.derived || []).map((d) => [d.derivation.split('.')[1].replace(/__c$/, '').replace(/_/g, ' '), `${n(d.matched)} of ${n(d.rows)}`])), '',
  '## 5. How a check runs', '',
  fig(`flowchart TB
  SF[("Salesforce<br/>stored values")] --> CMP{"Same?"}
  PG[("New system<br/>recalculated values")] --> CMP
  CMP -- "yes" --> OK(["Passed"])
  CMP -- "no" --> R["Repair agent<br/>finds the cause"]
  R --> RV{"Reviewer<br/>approves?"}
  RV -- "yes" --> GEN["Fix the generator<br/>run every check again"]
  RV -- "no" --> R
  GEN --> CMP`, 'Every check compares the two systems; a failure goes through the repair loop'),
  'We apply a fix only after a reviewer approves it, then run every check again. The fix goes into the generator, never into the output.', '',
  '## 6. What we test', '',
  table(['Level', 'What it proves'], [['Functional', 'Each rule and automation gives Salesforce’s outcome'], ['Data', 'Every record and calculated value matches'], ['Security', 'Each role can do exactly what it can do today'], ['User acceptance', 'Business users sign off business scenarios'], ['Agents', 'The AI agents’ work meets our quality bar']]), '',
  '## 7. Built-in platform behaviour', '',
  'These behaviours are how Salesforce itself works, so no configuration describes them. We build each one into the platform once, and test it by running the same operation in both systems.', '',
  firstTable(PLATFORM), '',
  '## 8. Still to come', '',
  table(['Test', 'When'], cases.filter((c) => c.pending).map((c) => caseName[c.id] || [c.id, c.pending])), '',
  ...gate(9, ['Every calculated value matches, field by field', 'No test fails; pending tests have a date'], ['The business scenarios for user acceptance', 'Which planned platform behaviours matter most to you']),
  ...where(10, [['Test cases and parity report', rel(P.VERIFICATION)], ['Built-in platform behaviour', rel(PLATFORM)], ['Repair proposals', rel(P.REPAIR)]]),
]);

// ---------------------------------------------------------------- 06 go-live
doc('06-go-live', { pdf: 'Agent 06 - Go-live', title: 'Go-live: how does it go live?', subtitle: 'Agent 06 · CI/CD pipeline', owner: 'CI/CD pipeline' }, [
  '## 1. Purpose and scope', '',
  'We release the module to the cloud through CI/CD, one business domain at a time, with a way back at every step. The target deployment on Azure, its environments and its recovery targets are in the HLD, section 7.', '',
  ...agentSection(2, ['pipeline']),
  '## 3. Inputs', '',
  list(['An approved change, with every check passing', 'The infrastructure definition (Bicep) for the target']), '',
  '## 4. Outputs and results', '',
  list(['A tested release on Azure', 'A health check after every deploy']), '',
  '## 5. Release pipeline', '',
  fig('flowchart TB\n  A["Change approved"] --> B["Tests and regeneration checks"] --> C["Compare with Salesforce"] --> D["App smoke test"] --> E["Deploy to Azure"] --> F["Health check"]', 'Every change passes every check before it reaches Azure'),
  '## 6. Cutover steps', '',
  'Each domain goes through these steps in its wave; the waves and which system masters each domain are in the HLD, section 8.3.', '',
  table(['Step', 'What happens'], [['1 Shadow', 'Both systems run; we turn differences into new tests'], ['2 Reporting first', 'Reports move first, so the numbers are trusted'], ['3 Module switch', 'Writes move in a short freeze; Salesforce stays read-only'], ['4 Integrations', 'Other systems move one by one'], ['5 Decommission', 'Licences reduce at renewal']]), '',
  '## 7. Cutover checklist', '',
  'We sign this off at go-live, for each domain.', '',
  table(['Item', 'Done when', 'Prepared in'], [
    ['Integration credentials', 'Every new credential is live and tested', 'Agent 03 - Build, section 5'],
    ['Scheduled jobs', 'Off in Salesforce and on in Azure, in one step', 'Agent 04 - Migrate, section 7'],
    ['Open approvals and paused flows', 'Finished or carried over', 'Agent 04 - Migrate, section 7'],
    ['History', 'Archive loaded', 'Agent 04 - Migrate, section 6'],
    ['Salesforce', 'Kept read-only until the domain has moved', 'This document, section 6'],
  ]), '',
  ...gate(8, ['Every check passes on the release candidate', 'The rollback has been rehearsed'], ['The cutover date and freeze window for each domain', 'Who signs off the cutover checklist', 'The licence renewal date']),
  ...where(9, [['Infrastructure and deploy scripts', '`adlc/6-go-live/infra/`'], ['Pipeline definition', '`.github/workflows/crm-genie.yml`']]),
]);

// ---------------------------------------------------------------- references for the knowledge base
const ref = (title, by, url) => [title, by, url];
const refs = (no, rs) => [`## ${no}. References`, '', table(['Reference', 'Publisher', 'Link'], rs), ''];

// ---------------------------------------------------------------- KB 01 best practices
doc('07-best-practices', { pdf: 'KB 01 - Best Practices', title: 'Engineering best practices', subtitle: 'Knowledge base 01 · Standards and guardrails we follow', owner: 'Engineering team' }, [
  '## 1. Purpose and scope', '',
  'The engineering practices every engineer and agent follows on a Salesforce exit, and the industry references behind them. We check them automatically on every change. How we apply them to this module is in the HLD and LLD.', '',
  '## 2. Principles', '',
  table(['Principle', 'Practice'], [
    ['Single responsibility', 'One agent, one job, one output folder'],
    ['One source of truth', 'A versioned model drives everything we generate; nobody edits generated output by hand'],
    ['Deterministic and repeatable', 'The same input always gives the same output; CI regenerates and fails on any difference'],
    ['Least privilege', 'Read-only access to the source; the narrowest role for every user, service and pipeline'],
    ['Evidence over assertion', 'Every claim (a count, a match, a pass) comes from a report that anyone can re-run'],
  ]), '',
  '## 3. Secure development', '',
  table(['Risk area', 'Practice'], [
    ['Broken access control', 'Enforce access where the data lives, not only in screens; test each role'],
    ['Injection', 'Parameterised queries only; no SQL built from user input'],
    ['Secrets', 'Never in source; held in a vault, referenced by managed identity, scanned on every change'],
    ['Software supply chain', 'Pinned dependency versions, lock files committed, pipeline actions pinned, audit on every build'],
    ['Integrity', 'Protected main branch; nothing merges without review and passing checks'],
    ['Logging and monitoring', 'Every agent run, approval and deployment is recorded with who and when'],
  ]), '',
  '## 4. Database engineering', '',
  list(['Schema changes are numbered scripts, applied in order, each with one owner, rebuildable from the model', 'Business rules as constraints, so every client of the data gets the same rule', 'Names come from the business vocabulary, in one consistent case style', 'Every change is backward compatible during a migration window (expand, then contract)']), '',
  '## 5. Testing', '',
  list(['The source system is the reference: expected values come from it (golden-master testing)', 'Every behaviour has a test; nothing is released with a failing test', 'Tests are code, versioned with what they test, and run in CI on every change', 'Security has its own tests: each role tries what it may and may not do']), '',
  '## 6. AI-assisted engineering', '',
  table(['Guardrail', 'How we enforce it'], [
    ['AI output is a proposal', 'An engineer reviews and approves it before it merges'],
    ['The model is never in the runtime path', 'AI writes code at build time; the running system has no AI dependency'],
    ['Each agent stays in its lane', 'Each agent may only write to its own folder'],
    ['Human approval at every phase', 'Approve, edit or return at each gate, fully audited'],
    ['No secrets or personal data in prompts', 'Inputs are masked and scanned automatically'],
  ]), '',
  '## 7. Source control and delivery', '',
  list(['Trunk-based development with short-lived branches and pull-request review', 'Infrastructure as code for every environment; no manual changes in the portal', 'The pipeline deploys with a federated identity, not a stored password', 'Every release is traceable to a commit, a review and a test report']), '',
  '## 8. Documentation', '',
  list(['Architecture documents follow arc42, with C4 diagrams for context and containers', 'Every significant decision has an architecture decision record (ADR)', 'Documents are generated from the source, so they never go out of date']), '',
  ...refs(9, [
    ref('OWASP Top 10', 'OWASP Foundation', 'https://owasp.org/Top10/'),
    ref('Application Security Verification Standard (ASVS)', 'OWASP Foundation', 'https://owasp.org/www-project-application-security-verification-standard/'),
    ref('Secure Software Development Framework, SP 800-218', 'NIST', 'https://csrc.nist.gov/pubs/sp/800/218/final'),
    ref('Security hardening for GitHub Actions', 'GitHub', 'https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions'),
    ref('The Twelve-Factor App', 'Heroku / community', 'https://12factor.net/'),
    ref('arc42 architecture template', 'arc42', 'https://arc42.org/'),
    ref('The C4 model for visualising software architecture', 'Simon Brown', 'https://c4model.com/'),
    ref('Architecture decision records', 'ADR GitHub organisation', 'https://adr.github.io/'),
    ref('PostgreSQL: row security policies', 'PostgreSQL Global Development Group', 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html'),
    ref('PostgreSQL: constraints', 'PostgreSQL Global Development Group', 'https://www.postgresql.org/docs/current/ddl-constraints.html'),
    ref('Triggers and order of execution', 'Salesforce', 'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm'),
  ]),
]);

// ---------------------------------------------------------------- KB 02 architecture
doc('08-architecture', { pdf: 'KB 02 - Architecture', title: 'Architecture best practices', subtitle: 'Knowledge base 02 · Practices, patterns and standards', owner: 'Engineering team' }, [
  '## 1. Purpose and scope', '',
  'The architecture practices and standards we follow when we move a Salesforce module to Azure: the Well-Architected pillars, the migration patterns, the reference architectures we build on, and the standards for identity, integration and data. The target architecture of this module is in the HLD.', '',
  '## 2. Well-Architected pillars', '',
  table(['Pillar', 'Best practice', 'How we apply it'], [
    ['Reliability', 'Design for failure; set recovery targets (RPO, RTO) per workload', 'Zone-redundant database with automatic failover, geo-redundant backups, at least two app instances'],
    ['Security', 'Zero trust: verify explicitly, least privilege, assume breach', 'Entra ID sign-in, private endpoints, managed identities, Key Vault, access enforced in the database'],
    ['Cost optimisation', 'Pay for what you use; measure before you size', 'Start small, right-size from measured load, reserved capacity for steady workloads, budgets and alerts'],
    ['Operational excellence', 'Everything as code; observe everything', 'Bicep for infrastructure, CI/CD for every change, Application Insights, alerts and runbooks'],
    ['Performance efficiency', 'Scale out, not up; keep reads close to the data', 'Container Apps scale rules per domain, read replicas for reporting, calculations stored in the database'],
  ]), '',
  '## 3. Migration patterns', '',
  table(['Pattern', 'What it is', 'Why we use it'], [
    ['Bounded contexts with a shared kernel', 'Split the system into business domains; share only the core customer data', 'Each Salesforce cloud or module becomes a domain that changes on its own'],
    ['Modular monolith', 'One deployable and one database, with strict module boundaries', 'Transactions where Salesforce had them; split a domain out later without redesign'],
    ['Transactional outbox', 'Write a change and its event in one transaction, then publish', 'No lost or duplicate side effects between domains'],
    ['Strangler fig', 'Move one business domain at a time while the old system keeps running', 'No big-bang cutover; each step is small and reversible'],
    ['Parallel run (shadow)', 'Run both systems on the same inputs and compare the results', 'Differences become tests before anyone relies on the new system'],
    ['Anti-corruption layer', 'A Salesforce-compatible interface in front of the new system', 'Integrations keep working while they move one by one'],
    ['Change data capture', 'Changes in the source flow to the target until cutover', 'The final freeze is short'],
    ['Expand and contract', 'Add the new structure, migrate, then remove the old', 'Schema changes never break a running release'],
    ['Blue-green release', 'Deploy to a staging slot, check, then swap', 'Zero-downtime releases with an instant way back'],
  ]), '',
  '## 4. Reference architectures we build on', '',
  'We start from Microsoft’s published reference architectures and adapt them, rather than inventing a design per client. The target design for this module, with its diagrams and sizing, is in the HLD, sections 3, 5 and 7.', '',
  table(['Reference architecture', 'What we take from it'], [
    ['Baseline zone-redundant web application (Azure Architecture Center)', 'Front Door with WAF, zone redundancy, private endpoints, managed identities'],
    ['Microservices with Azure Container Apps (Azure Architecture Center)', 'One environment for many domain services, jobs and event handlers'],
    ['Azure landing zones (Cloud Adoption Framework)', 'Subscriptions per environment, hub-and-spoke networking, policy and governance'],
    ['Well-Architected service guides for App Service and PostgreSQL', 'Service-level settings for reliability, security and cost'],
  ]), '',
  '## 5. Landing zone and governance', '',
  list(['Separate subscriptions (or resource groups) for development, test and production', 'Azure Policy for allowed regions, SKUs, tags and mandatory diagnostics', 'Role-based access with Privileged Identity Management for administrators', 'Hub-and-spoke networking; private endpoints for data services; no public database access', 'Microsoft Defender for Cloud and the Microsoft cloud security benchmark as the security baseline']), '',
  '## 6. Identity, integration and data standards', '',
  table(['Area', 'Standard'], [
    ['User sign-in', 'OpenID Connect with Microsoft Entra ID; MFA and conditional access from the client tenant'],
    ['Service-to-service', 'Managed identities; OAuth 2.0 client credentials for external systems'],
    ['APIs', 'REST with OpenAPI 3 descriptions, versioned, published through API Management'],
    ['Events', 'CloudEvents on Service Bus, written through a transactional outbox; idempotent consumers'],
    ['Transport', 'TLS 1.2 or later everywhere; HTTPS only'],
    ['Data protection', 'Encryption at rest with platform keys (customer-managed keys if policy requires); data kept in the chosen region'],
  ]), '',
  ...refs(7, [
    ref('Azure Well-Architected Framework', 'Microsoft', 'https://learn.microsoft.com/azure/well-architected/'),
    ref('Azure Architecture Center', 'Microsoft', 'https://learn.microsoft.com/azure/architecture/'),
    ref('Baseline highly available zone-redundant web application', 'Microsoft', 'https://learn.microsoft.com/azure/architecture/web-apps/app-service/architectures/baseline-zone-redundant'),
    ref('Cloud Adoption Framework: landing zones', 'Microsoft', 'https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/'),
    ref('Strangler Fig pattern', 'Microsoft', 'https://learn.microsoft.com/azure/architecture/patterns/strangler-fig'),
    ref('Anti-corruption Layer pattern', 'Microsoft', 'https://learn.microsoft.com/azure/architecture/patterns/anti-corruption-layer'),
    ref('Well-Architected service guide: App Service', 'Microsoft', 'https://learn.microsoft.com/azure/well-architected/service-guides/app-service-web-apps'),
    ref('High availability in Azure Database for PostgreSQL', 'Microsoft', 'https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-high-availability'),
    ref('Azure Key Vault best practices', 'Microsoft', 'https://learn.microsoft.com/azure/key-vault/general/best-practices'),
    ref('Microsoft cloud security benchmark', 'Microsoft', 'https://learn.microsoft.com/security/benchmark/azure/overview'),
    ref('Bicep documentation', 'Microsoft', 'https://learn.microsoft.com/azure/azure-resource-manager/bicep/overview'),
    ref('StranglerFigApplication', 'Martin Fowler', 'https://martinfowler.com/bliki/StranglerFigApplication.html'),
    ref('BoundedContext', 'Martin Fowler', 'https://martinfowler.com/bliki/BoundedContext.html'),
    ref('Pattern: Transactional outbox', 'microservices.io', 'https://microservices.io/patterns/data/transactional-outbox.html'),
    ref('CloudEvents specification', 'CNCF', 'https://cloudevents.io/'),
    ref('Azure Container Apps overview', 'Microsoft', 'https://learn.microsoft.com/azure/container-apps/overview'),
    ref('Microservices with Azure Container Apps', 'Microsoft', 'https://learn.microsoft.com/azure/architecture/example-scenario/serverless/microservices-with-container-apps'),
    ref('Pub/Sub API', 'Salesforce', 'https://developer.salesforce.com/docs/platform/pub-sub-api/overview'),
  ]),
]);

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT).filter((f) => /^\d\d-.*\.md$/.test(f))) fs.unlinkSync(path.join(OUT, f));
for (const d of DOCS) fs.writeFileSync(path.join(OUT, `${d.key}.md`), `# ${d.title}\n\n${d.body}`);
// The pack in reading order. The HLD and LLD are rendered from their own source, so they never drift.
const stamp = (f) => ({ source: P.rel(path.join(P.DESIGN, f)), owner: 'Modelling agent', generator: 'src/generators/emit-docs.js' });
const PACK = [
  ...DOCS.slice(0, 3).map(({ body, ...m }) => ({ ...m, source: `docs/client-pack/${m.key}.md` })),
  { key: '02a-hld', pdf: 'Agent 02 - High-Level Design', title: 'High-level design', subtitle: 'Agent 02 · Modelling · arc42 with C4 views', ...stamp('HLD.md') },
  { key: '02b-lld', pdf: 'Agent 02 - Low-Level Design', title: 'Low-level design', subtitle: 'Agent 02 · Modelling · tables, rules, automations, security', ...stamp('LLD.md') },
  ...DOCS.slice(3).map(({ body, ...m }) => ({ ...m, source: `docs/client-pack/${m.key}.md` })),
];
fs.writeFileSync(path.join(OUT, 'pack.json'), JSON.stringify({ module: MODULE, blueprint: bp.contentHash.slice(0, 12), documents: PACK }, null, 2) + '\n');
const index = ['# Client pack', '', `Module: **${MODULE}**. Generated by \`src/generators/emit-client-pack.js\`; A4 PDFs by \`src/generators/render-client-pack.ps1\`.`, '', table(['Document', 'Source'], PACK.map((d) => [d.pdf, `\`${d.source}\``])), ''];
fs.writeFileSync(path.join(OUT, 'README.md'), index.join('\n'));
console.log(`client pack: ${PACK.length} documents -> ${P.rel(OUT)}`);
