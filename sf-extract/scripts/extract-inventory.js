// Phase 1e: inventory of what the metadata and data exports cannot carry on their own.
// Read-only. Every query is optional: anything the org's edition or licence does not offer is
// recorded as "unavailable" and the run continues. Writes output/inventory/*.json and
// output/inventory/gap-register.md, the list we review with the client in the assessment.
const fs = require('fs');
const path = require('path');
const { connect, writeJson, OUT } = require('./lib');

const API = '67.0';
const DIR = path.join(OUT, 'inventory');
const DAYS = Number(process.env.USAGE_DAYS || 90);

async function main() {
  const conn = await connect();
  conn.version = API;
  const soql = async (q, tooling = false) => {
    try {
      const api = tooling ? conn.tooling : conn;
      const res = await api.query(q, { autoFetch: true, maxFetch: 50000 });
      return { ok: true, records: res.records.map(strip) };
    } catch (e) {
      return { ok: false, error: e.errorCode || e.message };
    }
  };

  const inv = {};

  // 1. Org facts that shape the migration: edition, timezone, currency, limits.
  inv.org = await soql('SELECT Id, Name, OrganizationType, InstanceName, IsSandbox, TimeZoneSidKey, DefaultLocaleSidKey, LanguageLocaleKey, CreatedDate FROM Organization');
  inv.currencies = await soql('SELECT IsoCode, IsCorporate, ConversionRate, IsActive FROM CurrencyType');
  try { inv.limits = { ok: true, records: pick(await conn.request(`/services/data/v${API}/limits`), ['DataStorageMB', 'FileStorageMB', 'DailyApiRequests', 'DailyBulkV2QueryJobs', 'DailyBulkV2QueryFileStorageMB']) }; }
  catch (e) { inv.limits = { ok: false, error: e.message }; }

  // 2. Managed packages: their code is not retrievable, so we list them and export their configuration as data.
  inv.packages = await soql('SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion FROM InstalledSubscriberPackage', true);

  // 3. Integrations. Outbound endpoints are in metadata; inbound callers only show up in login history.
  inv.namedCredentials = await soql('SELECT DeveloperName, MasterLabel, Endpoint, PrincipalType FROM NamedCredential');
  inv.remoteSites = await soql('SELECT SiteName, EndpointUrl, IsActive FROM RemoteProxy', true);
  inv.connectedApps = await soql('SELECT Id, Name, CreatedDate FROM ConnectedApplication');
  const logins = await soql(`SELECT Application, LoginType, UserId, Status, LoginTime FROM LoginHistory WHERE LoginTime = LAST_N_DAYS:${Math.min(DAYS, 180)}`);
  inv.loginsByApplication = logins.ok ? { ok: true, records: groupLogins(logins.records) } : logins;
  inv.apiOnlyUsers = await soql('SELECT Id, Username, Profile.Name, LastLoginDate, IsActive FROM User WHERE Profile.PermissionsApiUserOnly = true');

  // 4. Jobs and work in flight at cutover.
  inv.scheduledJobs = await soql('SELECT CronJobDetail.Name, CronJobDetail.JobType, CronExpression, State, NextFireTime, PreviousFireTime FROM CronTrigger');
  inv.pendingApprovals = await soql("SELECT Id, ProcessDefinition.Name, TargetObjectId, CreatedDate FROM ProcessInstance WHERE Status = 'Pending'");
  inv.pausedFlows = await soql('SELECT Id, Name, InterviewLabel, CurrentElement, CreatedDate FROM FlowInterview');
  inv.asyncJobs = await soql(`SELECT ApexClass.Name, JobType, Status, CreatedDate FROM AsyncApexJob WHERE CreatedDate = LAST_N_DAYS:${Math.min(DAYS, 7)} AND JobType IN ('BatchApex','Queueable','ScheduledApex','Future')`);

  // 5. Usage: what is actually used, so scope can shrink before anything is built.
  inv.reports = await soql('SELECT Id, Name, DeveloperName, FolderName, Format, LastRunDate, LastModifiedDate FROM Report');
  inv.dashboards = await soql('SELECT Id, Title, DeveloperName, FolderName, LastViewedDate, LastModifiedDate FROM Dashboard');
  inv.emailTemplates = await soql('SELECT Id, Name, DeveloperName, FolderName, TemplateType, IsActive, LastUsedDate, TimesUsed FROM EmailTemplate');
  inv.activeUsers = await soql('SELECT Id, Profile.Name, UserType, LastLoginDate FROM User WHERE IsActive = true');
  inv.reportSubscriptions = await soql("SELECT CronJobDetail.Name, State, NextFireTime FROM CronTrigger WHERE CronJobDetail.JobType IN ('8', 'A')");

  // 6. History that expires: how far back each source reaches today.
  inv.retention = {
    setupAuditTrail: await oldest(soql, 'SetupAuditTrail'),
    loginHistory: await oldest(soql, 'LoginHistory', 'LoginTime'),
  };
  inv.fieldHistory = historyCoverage();
  inv.encryptedFields = encryptedFields();

  // 7. Files: size them early, they take their own path.
  inv.files = await soql('SELECT COUNT(Id) n, SUM(ContentSize) bytes FROM ContentVersion WHERE IsLatest = true');
  inv.attachments = await soql('SELECT COUNT(Id) n, SUM(BodyLength) bytes FROM Attachment');

  // 8. Metadata types the org has that the manifest did not request, and what the retrieve could not read.
  inv.coverage = metadataCoverage();
  inv.retrieveIssues = retrieveIssues();

  for (const [k, v] of Object.entries(inv)) writeJson(path.join(DIR, `${k}.json`), v);
  fs.writeFileSync(path.join(DIR, 'gap-register.md'), gapRegister(inv));
  const unavailable = Object.entries(inv).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  console.log(`inventory: ${Object.keys(inv).length} sections -> output/inventory${unavailable.length ? ` (not offered by this org: ${unavailable.join(', ')})` : ''}`);
}

function strip(r) {
  if (r == null || typeof r !== 'object') return r;
  const o = {};
  for (const [k, v] of Object.entries(r)) if (k !== 'attributes') o[k] = v && typeof v === 'object' ? strip(v) : v;
  return o;
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k]).map((k) => [k, obj[k]]));
}

function groupLogins(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.Application || 'Unknown'}|${r.LoginType || ''}`;
    const g = m.get(k) || { application: r.Application || 'Unknown', loginType: r.LoginType, logins: 0, users: new Set(), lastLogin: null };
    g.logins += 1;
    g.users.add(r.UserId);
    if (!g.lastLogin || r.LoginTime > g.lastLogin) g.lastLogin = r.LoginTime;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, users: g.users.size })).sort((a, b) => b.logins - a.logins);
}

async function oldest(soql, object, field = 'CreatedDate') {
  const r = await soql(`SELECT ${field} FROM ${object} ORDER BY ${field} ASC LIMIT 1`);
  return r.ok ? { ok: true, oldest: r.records[0]?.[field] || null } : r;
}

function readSchema() {
  const dir = path.join(OUT, 'schema', 'objects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function historyCoverage() {
  const objs = readSchema();
  const history = objs.filter((o) => o.isHistory).map((o) => o.name);
  return { ok: true, historyObjects: history.length, names: history };
}

function encryptedFields() {
  const out = [];
  for (const o of readSchema()) for (const f of o.fields) if (f.encrypted) out.push(`${o.name}.${f.name}`);
  return { ok: true, count: out.length, fields: out };
}

function metadataCoverage() {
  const f = path.join(DIR, 'manifest-coverage.json');
  if (!fs.existsSync(f)) return { ok: false, error: 'run extract-schema.js first' };
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const requested = new Set([...c.retrieved, ...Object.keys(c.foldered), 'CustomObject']);
  const childOf = c.childOf || {};
  const covered = (t) => requested.has(t) || requested.has(childOf[t]);
  return {
    ok: true,
    retrievedTypes: c.retrieved.length,
    foldered: c.foldered,
    coveredAsChildren: c.availableInOrg.filter((t) => !requested.has(t) && covered(t)),
    notRequested: c.availableInOrg.filter((t) => !covered(t)),
  };
}

// Reads the last `sf project retrieve` result. Standard objects that are not customisable, and list views
// Salesforce ships but does not expose, are expected; anything refused for lack of access is not.
function retrieveIssues() {
  const f = path.join(OUT, 'retrieve-result.json');
  if (!fs.existsSync(f)) return { ok: false, error: 'no retrieve-result.json' };
  const r = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')).result || {}; // PowerShell redirects add a BOM
  const names = {}; // one component can arrive as several files (body + -meta.xml)
  for (const x of asArray(r.files)) if (x.type && x.state !== 'Failed') (names[x.type] ||= new Set()).add(x.fullName);
  const retrieved = Object.fromEntries(Object.entries(names).map(([t, s]) => [t, s.size]));
  const expected = { nonCustomisable: 0, unexposedListViews: 0, other: 0 };
  const noAccess = {};
  for (const m of asArray(r.messages)) {
    const p = m.problem || '';
    const access = p.match(/permissions to access (\w+)/);
    if (access) noAccess[access[1]] = (noAccess[access[1]] || 0) + 1;
    else if (/non-customizable/.test(p)) expected.nonCustomisable++;
    else if (/'ListView'.*cannot be found/.test(p)) expected.unexposedListViews++;
    else expected.other++;
  }
  return { ok: true, retrieved, noAccess, expected };
}

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

// ---------------------------------------------------------------- gap register
const n = (r) => (r && r.ok ? r.records.length : null);
const shown = (r) => (r && r.ok === false ? 'not offered by this org' : String(n(r) ?? '—'));

function gapRegister(inv) {
  const ri = inv.retrieveIssues.ok ? inv.retrieveIssues : { retrieved: {}, noAccess: {} };
  const got = (t) => ri.retrieved[t] ?? 0;
  const noAccess = Object.entries(ri.noAccess).map(([t, c]) => `${t} (${c})`).join(', ');
  const stale = (rows, field) => (rows && rows.ok ? rows.records.filter((r) => !r[field] || Date.now() - Date.parse(r[field]) > 180 * 864e5).length : null);
  const pkgs = inv.packages.ok ? inv.packages.records.map((p) => `${p.SubscriberPackage?.Name} (${p.SubscriberPackage?.NamespacePrefix || 'no namespace'})`) : [];
  const apps = inv.loginsByApplication.ok ? inv.loginsByApplication.records.slice(0, 8) : [];
  const org = inv.org.ok ? inv.org.records[0] : {};
  const lines = [
    '# Gap register',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/extract-inventory.js\` for ${org.Name || 'the org'} (${org.OrganizationType || 'edition unknown'}, time zone ${org.TimeZoneSidKey || 'unknown'}).`,
    '',
    'Everything below is either collected automatically or has an agreed way to be handled. Items marked',
    '**client input** are confirmed with the client during the assessment.',
    '',
    '## 1. Collected automatically',
    '',
    '| Area | Count | Where |',
    '|---|---|---|',
    `| Metadata types requested | ${inv.coverage.ok ? inv.coverage.retrievedTypes + 1 : '—'} | \`manifest/package.xml\` |`,
    ...(inv.coverage.ok ? Object.entries(inv.coverage.foldered).map(([t, c]) => `| ${t} (folder-based): listed / retrieved | ${c} / ${got(t)} | \`force-app/\` |`) : []),
    `| Reports with usage dates | ${shown(inv.reports)} | \`reports.json\` |`,
    `| Dashboards | ${shown(inv.dashboards)} | \`dashboards.json\` |`,
    `| Email templates with usage | ${shown(inv.emailTemplates)} | \`emailTemplates.json\` |`,
    `| Scheduled jobs | ${shown(inv.scheduledJobs)} | \`scheduledJobs.json\` |`,
    `| Named credentials (endpoints) | ${shown(inv.namedCredentials)} | \`namedCredentials.json\` |`,
    `| Remote sites (endpoints) | ${shown(inv.remoteSites)} | \`remoteSites.json\` |`,
    `| Connected apps | ${shown(inv.connectedApps)} | \`connectedApps.json\` |`,
    `| Installed packages | ${shown(inv.packages)} | \`packages.json\` |`,
    `| Currencies | ${shown(inv.currencies)} | \`currencies.json\` |`,
    `| Field history tables | ${inv.fieldHistory.historyObjects} | \`fieldHistory.json\` |`,
    `| Encrypted fields | ${inv.encryptedFields.count} | \`encryptedFields.json\` |`,
    '',
    '## 2. Not exported by Salesforce, and how each is handled',
    '',
    '| Item | In this org | How we handle it | Owner |',
    '|---|---|---|---|',
    `| Managed package source code | ${pkgs.length ? pkgs.join('; ') : shown(inv.packages)} | Configuration exported as data; behaviour captured as tests from the outside; rebuild or replace decided per package | Assessment, **client input** |`,
    `| Passwords, tokens, secrets, private keys | ${shown(inv.namedCredentials)} credentials, ${shown(inv.connectedApps)} connected apps | Users move to SSO or reset at go-live; integration owners issue new credentials, tracked on the cutover checklist | Client IT |`,
    `| Who calls Salesforce from outside | ${apps.length} login sources in ${Math.min(DAYS, 180)} days | Login history per application and integration user, confirmed in interviews; the compatibility layer keeps callers working during migration | Assessment, **client input** |`,
    `| History older than Salesforce keeps | audit trail from ${inv.retention.setupAuditTrail.oldest?.slice(0, 10) || '—'}, logins from ${inv.retention.loginHistory.oldest?.slice(0, 10) || '—'} | Archived from day one of the engagement; retention agreed with compliance | **client input** |`,
    '| Built-in platform behaviour (lead conversion, owner-change cascades, order of execution) | not configuration | Written once into the translation playbook; checked by the parity harness | Our team |',
    `| Work in flight at cutover | ${shown(inv.pendingApprovals)} pending approvals, ${shown(inv.pausedFlows)} paused flows, ${shown(inv.scheduledJobs)} scheduled jobs | Drained before the freeze or carried over, decided per item | Cutover plan |`,
    `| Encryption keys | ${inv.encryptedFields.count} encrypted fields | Data read decrypted by an authorised user; re-encrypted in the target with client-held keys | Client security |`,
    ...(inv.coverage.ok && Object.entries(inv.coverage.foldered).some(([t, c]) => got(t) < c)
      ? [`| Folder items listed but not retrieved | ${Object.entries(inv.coverage.foldered).filter(([t, c]) => got(t) < c).map(([t, c]) => `${t} ${c - got(t)} of ${c}`).join(', ')} | Usually Salesforce-managed or private folders; confirmed with the client whether they are in use, then retrieved by the folder owner | Assessment |`]
      : []),
    ...(noAccess ? [`| Items the extraction user could not read | ${noAccess} | Re-run with a user who has View All Data and Manage Reports/Dashboards, or ask the folder owner to share | Client admin |`] : []),
    '| Email captured by Einstein Activity Capture | ask | Re-synced from the mail server into the target | **client input** |',
    '| Separate products (Marketing Cloud, Account Engagement, CRM Analytics, Tableau) | ask | Scoped separately in the assessment if used | **client input** |',
    '',
    '## 3. Ways we keep the remaining gap small',
    '',
    `- **Coverage check.** The org lists ${inv.coverage.ok ? inv.coverage.notRequested.length : '—'} further metadata types that are not requested today (\`coverage.json\`). Each is reviewed once and added to the manifest or marked not relevant.`,
    `- **Usage evidence.** ${stale(inv.reports, 'LastRunDate') ?? '—'} reports and ${stale(inv.emailTemplates, 'LastUsedDate') ?? '—'} email templates have not been used in 180 days. Confirming these with the client reduces what needs rebuilding.`,
    '- **Shadow run.** Salesforce and the target run side by side; differences in outbound calls and results are recorded and turned into tests.',
    '- **Archive early.** Audit trail, login history and field history are exported on a schedule from the first week, so nothing expires during the project.',
    '- **Assessment questionnaire.** The **client input** items above are asked in one workshop, with this register as the agenda.',
    '',
    '## Top login sources',
    '',
    '| Application | Login type | Logins | Users | Last login |',
    '|---|---|---|---|---|',
    ...apps.map((a) => `| ${a.application} | ${a.loginType || ''} | ${a.logins} | ${a.users} | ${String(a.lastLogin || '').slice(0, 10)} |`),
    '',
  ];
  return lines.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
