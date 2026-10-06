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
  inv.packageContents = await packageContents(conn, soql, inv.packages);

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

// Per package: its objects with row counts, its settings records (small objects and custom metadata),
// the hidden Apex it ships, and, for packages we know, the outputs it wrote, so its behaviour can be
// rebuilt and tested without its code. Settings go to output/inventory/packages/<namespace>/.
const SETTINGS_MAX_ROWS = 2000;
const SKIP = /(__Share|__ChangeEvent|__e|__History|__Feed)$/;
async function packageContents(conn, soql, packages) {
  if (!packages.ok) return packages;
  const global = await conn.describeGlobal();
  const out = [];
  for (const p of packages.records) {
    const ns = p.SubscriberPackage?.NamespacePrefix;
    if (!ns) continue;
    const objects = [];
    for (const g of global.sobjects.filter((o) => o.name.startsWith(`${ns}__`) && !SKIP.test(o.name) && o.queryable)) {
      let rows = null;
      try { rows = (await conn.query(`SELECT COUNT() FROM ${g.name}`)).totalSize; } catch { /* not countable */ }
      objects.push({ name: g.name, label: g.label, kind: g.name.endsWith('__mdt') ? 'custom metadata' : g.customSetting ? 'custom setting' : 'object', rows });
    }
    const settings = [];
    for (const o of objects.filter((x) => x.rows > 0 && x.rows <= SETTINGS_MAX_ROWS)) {
      try {
        const d = await conn.describe(o.name);
        const fields = d.fields.filter((f) => !['IsDeleted', 'SystemModstamp', 'LastViewedDate', 'LastReferencedDate'].includes(f.name) && f.type !== 'address' && f.type !== 'location').map((f) => f.name);
        const r = await soql(`SELECT ${fields.join(', ')} FROM ${o.name}`);
        if (r.ok) { writeJson(path.join(DIR, 'packages', ns, `${o.name}.json`), r.records); settings.push({ object: o.name, rows: r.records.length }); }
      } catch { /* skip unreadable object */ }
    }
    let apexClasses = null;
    try { apexClasses = (await conn.tooling.query(`SELECT COUNT() FROM ApexClass WHERE NamespacePrefix = '${ns}'`)).totalSize; } catch { /* tooling unavailable */ }
    const entry = { namespace: ns, name: p.SubscriberPackage?.Name, version: p.SubscriberPackageVersion?.Name, objects, settings, apexClasses, apexSource: 'hidden by the vendor' };
    if (ns === 'dlrs') entry.capturedOutputs = await captureRollups(soql, ns);
    out.push(entry);
  }
  return { ok: true, records: out };
}

// DLRS stores each rollup as a record: parent, child, relationship, operation, criteria, result field.
// We save the child rows it reads and the parent values it wrote, so a rebuilt version can be compared.
async function captureRollups(soql, ns) {
  const defs = await soql(`SELECT ${ns}__UniqueName__c, ${ns}__ParentObject__c, ${ns}__ChildObject__c, ${ns}__RelationshipField__c, ${ns}__FieldToAggregate__c, ${ns}__AggregateOperation__c, ${ns}__AggregateResultField__c, ${ns}__RelationshipCriteria__c, ${ns}__RelationshipCriteriaFields__c FROM ${ns}__LookupRollupSummary__c WHERE ${ns}__Active__c = true`);
  if (!defs.ok) return defs;
  const cases = [];
  for (const d of defs.records) {
    const P = d[`${ns}__ParentObject__c`], C = d[`${ns}__ChildObject__c`], rel = d[`${ns}__RelationshipField__c`];
    const agg = d[`${ns}__FieldToAggregate__c`], res = d[`${ns}__AggregateResultField__c`];
    const crit = (d[`${ns}__RelationshipCriteriaFields__c`] || '').split(/[\s,]+/).filter(Boolean);
    const childFields = [...new Set(['Id', rel, agg, ...crit])];
    const children = await soql(`SELECT ${childFields.join(', ')} FROM ${C} WHERE ${rel} != null`);
    const parents = await soql(`SELECT Id, ${res} FROM ${P}`);
    if (!children.ok || !parents.ok) continue;
    const file = path.join(DIR, 'packages', ns, `capture-${d[`${ns}__UniqueName__c`]}.json`);
    writeJson(file, { definition: d, children: children.records, parentValues: parents.records });
    cases.push({ rollup: d[`${ns}__UniqueName__c`], children: children.records.length, parents: parents.records.length, file: path.relative(DIR, file).replace(/\\/g, '/') });
  }
  return cases;
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
    `Prepared ${new Date().toISOString().slice(0, 10)} from ${org.Name || 'the'} org (${org.OrganizationType || 'edition unknown'}, time zone ${org.TimeZoneSidKey || 'unknown'}).`,
    '',
    'This is our list of everything Salesforce does not hand over, and how we will handle each item. Items marked',
    '**client input** are the ones we confirm during the assessment.',
    '',
    '## 1. What we have already collected',
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
    '## 2. What Salesforce keeps, and how we will handle it',
    '',
    '| Item | In this org | How we handle it | Owner |',
    '|---|---|---|---|',
    `| Managed package source code | ${pkgs.length ? pkgs.join('; ') : shown(inv.packages)} | We export the package settings as data, record what the package does as test cases, then rebuild, replace or retain it | Assessment, **client input** |`,
    `| Passwords, tokens, secrets, private keys | ${shown(inv.namedCredentials)} credentials, ${shown(inv.connectedApps)} connected apps | We move users to single sign-on (or a new password on day one); each integration owner issues a new credential, tracked on our cutover checklist | Client IT |`,
    `| Who calls Salesforce from outside | ${apps.length} login sources in ${Math.min(DAYS, 180)} days | We identify each caller from login history and confirm its owner; a Salesforce-compatible connection keeps them working while they move | Assessment, **client input** |`,
    `| History older than Salesforce keeps | audit trail from ${inv.retention.setupAuditTrail.oldest?.slice(0, 10) || '—'}, logins from ${inv.retention.loginHistory.oldest?.slice(0, 10) || '—'} | We start archiving in week one and agree retention with compliance | **client input** |`,
    '| Built-in platform behaviour (lead conversion, owner-change cascades, order of execution) | not configuration | We build this behaviour into the platform once and test it against the org | Our team |',
    `| Work in flight at cutover | ${shown(inv.pendingApprovals)} pending approvals, ${shown(inv.pausedFlows)} paused flows, ${shown(inv.scheduledJobs)} scheduled jobs | We finish each item before the freeze or carry it over in the same state | Cutover plan |`,
    `| Encryption keys | ${inv.encryptedFields.count} encrypted fields | We read the data through an authorised user and encrypt it again in the new system with keys held in the target environment | Client security |`,
    ...(inv.coverage.ok && Object.entries(inv.coverage.foldered).some(([t, c]) => got(t) < c)
      ? [`| Folder items listed but not retrieved | ${Object.entries(inv.coverage.foldered).filter(([t, c]) => got(t) < c).map(([t, c]) => `${t} ${c - got(t)} of ${c}`).join(', ')} | Usually Salesforce-managed or private folders; we check whether they are used, then the folder owner shares them | Assessment |`]
      : []),
    ...(noAccess ? [`| Items the extraction user could not read | ${noAccess} | We run again with a user who has View All Data, or the folder owner shares them | Client admin |`] : []),
    '| Email captured by Einstein Activity Capture | ask | We sync email history again from the mail server | **client input** |',
    '| Separate products (Marketing Cloud, Account Engagement, CRM Analytics, Tableau) | ask | Where they are used, we scope them separately | **client input** |',
    '',
    '## 3. How we keep this list short',
    '',
    `- **Coverage check.** The org lists ${inv.coverage.ok ? inv.coverage.notRequested.length : '—'} further metadata types that are not requested today (\`coverage.json\`). We review each one once and either add it or mark it as not relevant.`,
    `- **Usage evidence.** ${stale(inv.reports, 'LastRunDate') ?? '—'} reports and ${stale(inv.emailTemplates, 'LastUsedDate') ?? '—'} email templates have not been used in 180 days. We retire the unused ones, so we rebuild less.`,
    '- **Side-by-side run.** We run Salesforce and the new system in parallel; any difference becomes a new test.',
    '- **Archive early.** We save audit trail, login history and field history on a schedule from week one, so nothing expires during the project.',
    '- **One workshop.** We confirm the **client input** items in one session, using this list as the agenda.',
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
