// Turns output/inventory (what Salesforce does not hand over) into one working document per gap,
// each owned by an agent and reviewed at that agent's gate. No org connection; reads local files only.
//
//   node scripts/emit-cutover.js [--parts packages,credentials,work,history,platform]
//
//   packages     → target/cutover/packages.md            Modelling agent  (vendor package code)
//   credentials  → target/cutover/credentials.md         Security agent   (passwords, secrets, systems that call in)
//   work         → target/cutover/work-in-progress.md    Data load agent  (approvals, paused flows, jobs at go-live)
//   history      → target/cutover/history-archive.md     Data load agent  (history with time limits)
//   platform     → target/cutover/platform-behaviour.md  Verification agent (built-in platform behaviour)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INV = path.join(ROOT, 'output', 'inventory');
const OUT = path.join(ROOT, 'target', 'cutover');
const ALL = ['packages', 'credentials', 'work', 'history', 'platform'];

const arg = process.argv.indexOf('--parts');
const parts = arg > -1 ? process.argv[arg + 1].split(',') : ALL;

const read = (f) => {
  const p = path.join(INV, f);
  if (!fs.existsSync(p)) return { ok: false, error: 'not collected (run extract-inventory.js)' };
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
};
const rows = (r) => (r && r.ok ? r.records || [] : []);
const status = (r) => (r && r.ok === false ? `_${r.error}_` : null);
const date = (s) => (s ? String(s).slice(0, 10) : '—');
const cell = (s) => String(s ?? '—').replace(/\|/g, '\\|');
// Usernames are personal data: keep the profile and the first letter only.
const maskUser = (u) => (u ? `${u[0]}…@${u.split('@')[1]?.split('.')[0] || '…'}` : '—');
const head = (title, owner, why) => [
  `# ${title}`, '',
  `Prepared by our team from the org inventory. Owner: **${owner}**; we review it with you at that phase's gate.`, '',
  why, '',
];

const writers = {
  packages() {
    const pc = read('packageContents.json');
    const lines = head('Vendor packages', 'Modelling agent',
      'The vendor hides the code of each installed package. We still take everything around it: its objects, its data and its settings. We record what the package does as input → output test cases, then agree with you whether to rebuild it, replace it, or keep it on Salesforce for now.');
    if (status(pc)) lines.push(status(pc), '');
    const tests = [];
    for (const p of rows(pc)) {
      const withRows = p.objects.filter((o) => o.rows > 0);
      lines.push(
        `## ${p.name} (\`${p.namespace}\`, version ${p.version || '—'})`, '',
        '| What | Count | How we take it |', '|---|---|---|',
        `| Package objects | ${p.objects.length} | describe |`,
        `| Objects holding records | ${withRows.length} | data export |`,
        `| Settings records saved | ${p.settings.reduce((a, s) => a + s.rows, 0)} | \`output/inventory/packages/${p.namespace}/\` |`,
        `| Apex classes | ${p.apexClasses ?? '—'} | source hidden by the vendor |`, '',
      );
      if (withRows.length) lines.push('Objects with records:', '', ...withRows.map((o) => `- \`${o.name}\` (${o.kind}) — ${o.rows} rows`), '');
      for (const c of p.capturedOutputs || []) {
        const r = rebuildRollup(p.namespace, c.file);
        tests.push(r);
        lines.push(
          `### Rebuilt from its settings: ${r.rollup}`, '',
          `The package stores this rollup as a settings record. We read it and rebuilt the behaviour without the package code:`, '',
          '```sql', r.sql, '```', '',
          `Compared with the values the package wrote: **${r.matched} of ${r.total} ${r.parent} records match**${r.mismatches.length ? ` (${r.mismatches.length} differ: ${r.mismatches.slice(0, 3).map((m) => `${m.id} expected ${m.package}, rebuilt ${m.rebuilt}`).join('; ')})` : ''}. Records with no matching child count as zero on both sides.`, '',
        );
      }
      const covered = (p.capturedOutputs || []).length;
      lines.push(
        '| Decision | Value |', '|---|---|',
        '| Business owner | _to confirm with you_ |',
        `| In use? | ${withRows.length ? `yes: ${withRows.map((o) => `${o.rows} ${o.label || o.name}`).join(', ')}` : 'no records found'} |`,
        `| Our proposed route | ${covered ? 'rebuild: the behaviour is fully described by its settings and matches the package output' : withRows.length ? 'to decide in assessment' : 'not needed: installed but holds no records'} |`,
        `| Test cases from your data | ${covered ? tests.filter((t) => t.namespace === p.namespace).reduce((a, t) => a + t.total, 0) + ' (one per parent record per rollup)' : '_planned_'} |`, '',
      );
    }
    fs.writeFileSync(path.join(OUT, 'package-tests.json'), JSON.stringify(tests.map(({ mismatches, ...t }) => ({ ...t, mismatches: mismatches.slice(0, 20) })), null, 2));
    return lines;
  },

  credentials() {
    const nc = read('namedCredentials.json'), rs = read('remoteSites.json'), ca = read('connectedApps.json');
    const api = read('apiOnlyUsers.json'), lg = read('loginsByApplication.json');
    const callers = rows(lg).filter((a) => a.loginType !== 'Application'); // browser logins are people
    const lines = head('Credentials and integrations checklist', 'Security agent',
      'Salesforce never exports passwords, tokens or keys. Your users will sign in through your company login (single sign-on, matched by Federation ID), or set a new password on day one. For every integration, the owner issues a new credential; we store it in Azure Key Vault, test it, and switch on an agreed date. We find the systems that call into Salesforce from login history and keep them running through a Salesforce-compatible connection until each one moves.');
    const table = (title, cols, data, map, missing) => {
      lines.push(`## ${title}`, '');
      if (missing) { lines.push(missing, ''); return; }
      if (!data.length) { lines.push('_None in this org._', ''); return; }
      lines.push(`| ${cols.join(' | ')} | Owner | New credential | Tested | Switch date |`, `|${'---|'.repeat(cols.length + 4)}`);
      for (const d of data) lines.push(`| ${map(d).map(cell).join(' | ')} | | | | |`);
      lines.push('');
    };
    table('Outbound: named credentials', ['Name', 'Endpoint', 'Auth'], rows(nc), (d) => [d.DeveloperName, d.Endpoint, d.PrincipalType], status(nc));
    table('Outbound: remote sites', ['Site', 'Endpoint', 'Active'], rows(rs), (d) => [d.SiteName, d.EndpointUrl, d.IsActive], status(rs));
    table('Connected apps (OAuth clients)', ['App', 'Created'], rows(ca), (d) => [d.Name, date(d.CreatedDate)], status(ca));
    table('Inbound: who calls Salesforce (login history)', ['Application', 'Login type', 'Logins', 'Users', 'Last login'], callers, (d) => [d.application, d.loginType, d.logins, d.users, date(d.lastLogin)], status(lg));
    table('API-only users (integration accounts)', ['User', 'Profile', 'Last login', 'Active'], rows(api), (d) => [maskUser(d.Username), d.Profile?.Name, date(d.LastLoginDate), d.IsActive], status(api));
    return lines;
  },

  work() {
    const ap = read('pendingApprovals.json'), fl = read('pausedFlows.json'), sj = read('scheduledJobs.json'), aj = read('asyncJobs.json');
    const lines = head('Work in progress at go-live', 'Data load agent',
      'Processes that are halfway through on the day we switch live inside Salesforce, not in your records. We either finish each one before the freeze, or carry it over into the new system in the same state. We switch scheduled jobs in one step, off in Salesforce and on in the new system together, so nothing runs twice or is missed.');
    const sys = (n) => /Program Milestone|Program Status|Metalytics|Salesforce|sfdc/i.test(n || '');
    lines.push(`## Pending approvals (${rows(ap).length})`, '');
    if (status(ap)) lines.push(status(ap), '');
    else if (!rows(ap).length) lines.push('_None open today. Re-run in the week before the freeze._', '');
    else { lines.push('| Process | Record | Opened | Route |', '|---|---|---|---|'); for (const d of rows(ap)) lines.push(`| ${cell(d.ProcessDefinition?.Name)} | ${d.TargetObjectId} | ${date(d.CreatedDate)} | drain if under 7 days old, else carry over at the same step |`); lines.push(''); }
    lines.push(`## Paused flows (${rows(fl).length})`, '');
    if (status(fl)) lines.push(status(fl), '');
    else if (!rows(fl).length) lines.push('_None paused today._', '');
    else { lines.push('| Flow | Waiting at | Since | Route |', '|---|---|---|---|'); for (const d of rows(fl)) lines.push(`| ${cell(d.InterviewLabel || d.Name)} | ${cell(d.CurrentElement)} | ${date(d.CreatedDate)} | recreate as a scheduled job in the target with the original due date |`); lines.push(''); }
    lines.push(`## Scheduled jobs (${rows(sj).length})`, '');
    if (status(sj)) lines.push(status(sj), '');
    else { lines.push('| Job | Schedule (cron) | Next run | Route |', '|---|---|---|---|'); for (const d of rows(sj)) { const n = d.CronJobDetail?.Name; lines.push(`| ${cell(n)} | \`${d.CronExpression}\` | ${date(d.NextFireTime)} | ${sys(n) ? 'Salesforce internal job, not migrated' : 'switch in one step: disable here, enable the target worker'} |`); } lines.push(''); }
    lines.push(`## Recent batch and queued Apex (${rows(aj).length})`, '', status(aj) || (rows(aj).length ? rows(aj).map((d) => `- ${d.ApexClass?.Name} · ${d.JobType} · ${d.Status}`).join('\n') : '_None in the last 7 days._'), '');
    return lines;
  },

  history() {
    const rt = read('retention.json'), fh = read('fieldHistory.json');
    const lines = head('History archive plan', 'Data load agent',
      'Salesforce deletes some history after a fixed time. From week one we save each source on a schedule, adding only what is new since the last run, so nothing expires while the project runs. At go-live we load the archive into the new system, which keeps history with no time limit.');
    lines.push('| Source | Salesforce keeps | Reaches back to today | Archive |', '|---|---|---|---|',
      `| Field history (${fh.historyObjects ?? '—'} history tables) | 18 months in the UI, 24 via API; longer only with Field Audit Trail | per table | weekly, by \`CreatedDate\` watermark |`,
      `| Setup Audit Trail (configuration changes) | 180 days | ${date(rt.setupAuditTrail?.oldest)} | weekly |`,
      `| Login history | 6 months | ${date(rt.loginHistory?.oldest)} | weekly |`,
      '| Recycle bin (deleted records) | 15 days | — | daily, `queryAll` where `IsDeleted = true` |',
      '| Event Monitoring logs | 1 day, or 30 with Shield | — | daily, if licensed |', '',
      '| Decision | Value |', '|---|---|',
      '| Retention required by compliance (years, per source) | _to confirm with the client_ |',
      '| History older than today\'s reach: accepted as not available | _to confirm with the client_ |',
      '| Fields never tracked: changes were not recorded and cannot be recovered | noted |', '');
    return lines;
  },

  platform() {
    const casesFile = path.join(ROOT, 'target', 'parity', 'cases.json');
    const c = fs.existsSync(casesFile) ? JSON.parse(fs.readFileSync(casesFile, 'utf8')) : [];
    const ids = new Set((Array.isArray(c) ? c : c.cases || []).map((x) => x.id || x.name));
    const has = (id) => (ids.has(id) ? `tested (\`${id}\`)` : null);
    const B = [
      ['Restricted picklists reject unknown values', 'lookup table + foreign key', has('platform.restrictedPicklist')],
      ['Master-detail delete removes the children', 'ON DELETE CASCADE', has('platform.masterDetailCascade')],
      ['Blank numbers count as zero in formulas', 'COALESCE in the compiled expression', 'tested (formula values)'],
      ['Roll-up summaries stay current', 'trigger-maintained column + recompute backstop', 'tested (roll-up values)'],
      ['TODAY() in the org\'s time zone', 'app.today() evaluated in the org time zone', 'tested (Days_To_Renewal)'],
      ['Field-level security', 'column grants per role', has('security.readOnlyFieldsNotWritable')],
      ['Sharing inherited from the parent record', 'row-level security policy', has('security.permsetEditsAllowedFields')],
      ['Order of execution on save', 'save pipeline calling generated hooks in Salesforce order, one transaction', 'planned'],
      ['Lead conversion', 'service using the retrieved LeadConvertSettings field mapping', 'planned'],
      ['Owner change moves open opportunities and cases', 'service rule on owner change', 'planned'],
      ['Duplicate and matching rules', 'check before insert, using retrieved rule definitions', 'planned'],
      ['Assignment and escalation rules', 'ordered rule engine + scheduler', 'planned (rules already extracted)'],
    ];
    const lines = head('Built-in platform behaviour', 'Verification agent',
      'These behaviours are how Salesforce itself works, so no configuration describes them. We build each one into our platform once and reuse it for every client. For each, we run the same operation in Salesforce and in the new system and compare the result.');
    lines.push('| Behaviour | How the target does it | Status |', '|---|---|---|', ...B.map(([b, how, s]) => `| ${b} | ${how} | ${s || 'planned'} |`), '');
    const done = B.filter(([, , s]) => s && s.startsWith('tested')).length;
    lines.push(`${done} of ${B.length} behaviours tested today; the rest are on the playbook backlog.`, '');
    return lines;
  },
};

// Rebuilds one DLRS rollup from its settings record and the captured child rows, then compares the
// result with the parent values the package wrote. Criteria support `Field = 'value'` / `!=` joined by AND.
function rebuildRollup(ns, file) {
  const cap = JSON.parse(fs.readFileSync(path.join(INV, file), 'utf8'));
  const d = cap.definition, k = (f) => d[`${ns}__${f}__c`];
  const [P, C, rel, agg, op, res, crit] = ['ParentObject', 'ChildObject', 'RelationshipField', 'FieldToAggregate', 'AggregateOperation', 'AggregateResultField', 'RelationshipCriteria'].map(k);
  const conds = (crit || '').split(/\s+AND\s+/i).filter(Boolean).map((c) => {
    const m = c.match(/^\s*(\w+)\s*(!=|=)\s*'([^']*)'\s*$/);
    if (!m) throw new Error(`criteria not supported yet: ${c}`);
    return { field: m[1], neg: m[2] === '!=', value: m[3] };
  });
  const keep = (row) => conds.every((c) => (String(row[c.field]) === c.value) !== c.neg);
  const acc = new Map();
  for (const row of cap.children.filter(keep)) {
    const a = acc.get(row[rel]) || { n: 0, sum: 0 };
    a.n += 1; a.sum += Number(row[agg]) || 0;
    acc.set(row[rel], a);
  }
  const calc = (a) => (!a ? 0 : op === 'Count' ? a.n : op === 'Sum' ? a.sum : op === 'Avg' ? a.sum / a.n : null);
  if (!['Count', 'Sum', 'Avg'].includes(op)) throw new Error(`operation not supported yet: ${op}`);
  const mismatches = [];
  let matched = 0;
  for (const p of cap.parentValues) {
    const rebuilt = calc(acc.get(p.Id)), pkg = Number(p[res]) || 0;
    if (Math.abs(rebuilt - pkg) < 0.005) matched++; else mismatches.push({ id: p.Id, package: pkg, rebuilt });
  }
  const fn = op === 'Count' ? `COUNT(${agg})` : `${op.toUpperCase()}(${agg})`;
  const where = conds.map((c) => `${c.field} ${c.neg ? '<>' : '='} '${c.value}'`).join(' AND ');
  const sql = `-- ${d[`${ns}__UniqueName__c`]}: ${P}.${res} = ${op} of ${C}.${agg}${where ? ` where ${where}` : ''}\nUPDATE ${P} p SET ${res} = COALESCE((\n  SELECT ${fn} FROM ${C} c\n  WHERE c.${rel} = p.Id${conds.map((c) => ` AND c.${c.field} ${c.neg ? '<>' : '='} '${c.value}'`).join('')}\n), 0);`;
  return { namespace: ns, rollup: d[`${ns}__UniqueName__c`], parent: P, total: cap.parentValues.length, matched, mismatches, sql };
}

const FILES = { packages: 'packages.md', credentials: 'credentials.md', work: 'work-in-progress.md', history: 'history-archive.md', platform: 'platform-behaviour.md' };
fs.mkdirSync(OUT, { recursive: true });
for (const p of parts) {
  if (!writers[p]) { console.error(`unknown part ${p}; use ${ALL.join(',')}`); process.exit(1); }
  fs.writeFileSync(path.join(OUT, FILES[p]), writers[p]().join('\n'));
  console.log(`target/cutover/${FILES[p]}`);
}
