// Discovery extraction for one org: the complete as-is picture behind the discovery documents and the Discovery
// explorer. Read-only (describe, SOQL, Tooling API).
//
//   SF_ALIAS=myorg node src/generators/discover-org.js eu "Europe"
//
// Writes adlc/1-discover/assessment/discovery/<region>/discovery.json. Holds configuration (names, formulas, flow
// logic, settings) and counts; never record contents, user names, org ID or instance.
const path = require('path');
const { connect, writeJson, pool, progress, CONCURRENCY, P } = require('./lib');

const [region, label] = process.argv.slice(2);
if (!region) { console.error('usage: SF_ALIAS=<alias> node src/generators/discover-org.js <region> "<label>"'); process.exit(2); }

const API = '67.0';
// Standard objects every sales org is described for, customised or not.
const CORE = ['Account', 'Contact', 'Lead', 'Opportunity', 'OpportunityLineItem', 'Product2', 'Pricebook2', 'PricebookEntry', 'Order', 'OrderItem', 'Quote', 'Contract', 'Case', 'Campaign', 'Task', 'Event', 'User'];
const SKIP_FILL = new Set(['textarea', 'base64', 'encryptedstring', 'address', 'location', 'anyType', 'complexvalue']);
const by = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));

async function main() {
  const conn = await connect();
  conn.version = API;
  const q = async (soql, tooling = false) => {
    try { return (await (tooling ? conn.tooling : conn).query(soql, { autoFetch: true, maxFetch: 50000 })).records; } catch { return []; }
  };
  const count = async (soql) => { try { return (await conn.query(soql)).totalSize; } catch { return null; } };
  // Single-record Tooling queries (the Metadata field is only returned one record at a time).
  const one = async (soql) => { try { return (await conn.tooling.query(soql)).records[0] || null; } catch { return null; } };
  // Where a component comes from: built in this org, an installed package, or Salesforce itself (template flows,
  // feature components in a Salesforce namespace).
  const installedNs = new Set((await q('SELECT SubscriberPackage.NamespacePrefix FROM InstalledSubscriberPackage', true)).map((p) => p.SubscriberPackage?.NamespacePrefix).filter(Boolean));
  const managed = (ns) => (!ns ? 'custom' : installedNs.has(ns) ? 'package' : 'salesforce');

  /* ---------------------------------------------------------------- org profile */
  const orgRow = (await q('SELECT OrganizationType, DefaultLocaleSidKey, LanguageLocaleKey, TimeZoneSidKey FROM Organization'))[0] || {};
  let limits = {};
  try {
    const l = await conn.request(`/services/data/v${API}/limits`);
    for (const k of ['DataStorageMB', 'FileStorageMB', 'DailyApiRequests', 'DailyBulkV2QueryJobs', 'DailyAsyncApexExecutions']) if (l[k]) limits[k] = { max: l[k].Max, used: l[k].Max - l[k].Remaining };
  } catch { limits = {}; }
  const licences = (await q('SELECT MasterLabel, TotalLicenses, UsedLicenses FROM UserLicense WHERE TotalLicenses > 0')).map((x) => ({ name: x.MasterLabel, total: x.TotalLicenses, used: x.UsedLicenses })).sort(by('name'));
  const featureLicences = (await q('SELECT MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE UsedLicenses > 0')).map((x) => ({ name: x.MasterLabel, total: x.TotalLicenses, used: x.UsedLicenses })).sort(by('name'));
  const currencies = (await q('SELECT IsoCode, IsCorporate FROM CurrencyType WHERE IsActive = true')).map((c) => c.IsoCode + (c.IsCorporate ? ' (corporate)' : '')).sort();
  const usersByProfile = (await q("SELECT Profile.Name p, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY Profile.Name")).map((r) => ({ profile: r.p, users: r.n })).sort(by('profile'));

  /* ---------------------------------------------------------------- data model */
  const global = await conn.describeGlobal();
  const gl = Object.fromEntries(global.sobjects.map((s) => [s.name, s]));
  const customFields = await q('SELECT DeveloperName, TableEnumOrId, NamespacePrefix FROM CustomField', true);
  const customObjectsT = await q('SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject', true);
  const objIdToName = Object.fromEntries(customObjectsT.map((o) => [o.Id, `${o.NamespacePrefix ? `${o.NamespacePrefix}__` : ''}${o.DeveloperName}__c`]));
  const standardWithCustom = new Set(customFields.map((f) => objIdToName[f.TableEnumOrId] || f.TableEnumOrId).filter((n) => n && !n.endsWith('__c') && gl[n]));
  const customObjNames = global.sobjects.filter((s) => s.custom && s.name.endsWith('__c') && !s.customSetting && s.queryable).map((s) => s.name);
  const names = [...new Set([...CORE.filter((n) => gl[n]), ...standardWithCustom, ...customObjNames])].sort();

  const sharing = Object.fromEntries((await q(`SELECT QualifiedApiName, InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName IN (${names.map((n) => `'${n}'`).join(',')})`, true))
    .map((e) => [e.QualifiedApiName, { internal: e.InternalSharingModel, external: e.ExternalSharingModel }]));
  const recordTypes = await q('SELECT SobjectType, Name, DeveloperName, IsActive FROM RecordType');
  const layouts = await q('SELECT Name, TableEnumOrId FROM Layout', true);

  let described = 0;
  const step = Math.max(1, Math.round(names.length / 20));
  progress('objects', 0, names.length);
  // Objects in parallel; each object's fill-rate counts run one after another inside its slot.
  const tick = () => { if (++described % step === 0 || described === names.length) progress('objects', described, names.length); };
  const objects = (await pool(names, CONCURRENCY, async (name) => {
    try { return await describeObject(name); } finally { tick(); }
  })).filter(Boolean);

  async function describeObject(name) {
    let d;
    try { d = await conn.sobject(name).describe(); } catch { return null; }
    const records = d.queryable ? await count(`SELECT COUNT() FROM ${name}`) : null;
    const nsMatch = name.match(/^([A-Za-z0-9_]+?)__\w+__c$/);
    const fields = [];
    for (const f of d.fields) {
      const custom = !!f.custom;
      let fill = null;
      if (custom && records > 0 && !f.calculated && f.filterable && !SKIP_FILL.has(f.type)) {
        const n = await count(`SELECT COUNT() FROM ${name} WHERE ${f.name} ${f.type === 'boolean' ? '= true' : '!= null'}`);
        if (n != null) fill = Math.round((n / records) * 100);
      }
      const fieldNs = f.name.match(/^([A-Za-z0-9_]+?)__\w+__c$/)?.[1];
      fields.push({
        name: f.name, label: f.label, type: f.calculated ? (f.calculatedFormula ? 'formula' : 'roll-up') : f.type,
        origin: custom ? managed(fieldNs) : 'standard', required: !f.nillable && f.createable && !f.defaultedOnCreate,
        unique: f.unique || undefined, externalId: f.externalId || undefined,
        references: f.referenceTo?.length ? f.referenceTo : undefined, masterDetail: f.relationshipOrder != null ? true : undefined,
        formula: f.calculatedFormula || undefined, picklistValues: f.picklistValues?.length ? f.picklistValues.filter((v) => v.active).length : undefined, fill,
      });
    }
    const objId = Object.entries(objIdToName).find(([, n]) => n === name)?.[0];
    return {
      name, label: d.label, origin: d.custom ? managed(nsMatch?.[1]) : 'standard', records,
      sharing: sharing[name] || null,
      recordTypes: recordTypes.filter((r) => r.SobjectType === name).map((r) => ({ name: r.Name, active: r.IsActive })),
      layouts: layouts.filter((l) => l.TableEnumOrId === name || l.TableEnumOrId === objId).map((l) => l.Name).sort(),
      fields: fields.sort((a, b) => (a.origin === b.origin ? a.name.localeCompare(b.name) : a.origin === 'standard' ? 1 : -1)),
    };
  }

  /* ---------------------------------------------------------------- rules and processes */
  const vrRows = await q('SELECT Id, ValidationName, EntityDefinition.QualifiedApiName, Active, ErrorMessage, ErrorDisplayField, Description, NamespacePrefix FROM ValidationRule', true);
  progress('validation rules', 0, vrRows.length);
  const validationRules = await pool(vrRows, CONCURRENCY, async (v) => {
    const m = await one(`SELECT Metadata FROM ValidationRule WHERE Id = '${v.Id}'`);
    return { object: v.EntityDefinition?.QualifiedApiName, name: v.ValidationName, active: v.Active, origin: managed(v.NamespacePrefix),
      formula: m?.Metadata?.errorConditionFormula || null, message: v.ErrorMessage, field: v.ErrorDisplayField || null, description: v.Description || null };
  });
  validationRules.sort((a, b) => `${a.object}.${a.name}`.localeCompare(`${b.object}.${b.name}`));

  const flowRows = await q('SELECT ApiName, Label, ProcessType, TriggerType, TriggerObjectOrEventLabel, RecordTriggerType, IsActive, ActiveVersionId, LatestVersionId, NamespacePrefix, Description FROM FlowDefinitionView');
  progress('flows', 0, flowRows.length);
  const flows = await pool(flowRows, CONCURRENCY, async (f) => {
    const vid = f.ActiveVersionId || f.LatestVersionId;
    const m = !f.NamespacePrefix && vid ? (await one(`SELECT Metadata FROM Flow WHERE Id = '${vid}'`))?.Metadata : null;
    return { name: f.ApiName, label: f.Label, kind: f.ProcessType, trigger: f.TriggerType, recordTrigger: f.RecordTriggerType, object: f.TriggerObjectOrEventLabel,
      active: f.IsActive, origin: managed(f.NamespacePrefix), description: f.Description || null, logic: m ? flowLogic(m) : null };
  });
  flows.sort(by('name'));

  const approvals = (await q("SELECT Name, DeveloperName, TableEnumOrId, State, Description FROM ProcessDefinition WHERE Type = 'Approval'"))
    .map((a) => ({ name: a.Name, object: a.TableEnumOrId, active: a.State === 'Active', description: a.Description || null })).sort(by('name'));
  const workflowRules = (await q('SELECT Name, TableEnumOrId, NamespacePrefix FROM WorkflowRule', true)).map((w) => ({ name: w.Name, object: objIdToName[w.TableEnumOrId] || w.TableEnumOrId, origin: managed(w.NamespacePrefix) })).sort(by('name'));

  const trigRows = await q('SELECT Name, TableEnumOrId, Status, ApiVersion, NamespacePrefix, Body, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate, UsageBeforeDelete, UsageAfterDelete, UsageAfterUndelete FROM ApexTrigger', true);
  const triggers = trigRows.map((t) => ({
    name: t.Name, object: objIdToName[t.TableEnumOrId] || t.TableEnumOrId, active: t.Status === 'Active', apiVersion: t.ApiVersion, origin: managed(t.NamespacePrefix),
    events: [['before insert', t.UsageBeforeInsert], ['after insert', t.UsageAfterInsert], ['before update', t.UsageBeforeUpdate], ['after update', t.UsageAfterUpdate], ['before delete', t.UsageBeforeDelete], ['after delete', t.UsageAfterDelete], ['after undelete', t.UsageAfterUndelete]].filter(([, on]) => on).map(([e]) => e),
    lines: t.Body && t.Body !== '(hidden)' ? t.Body.split('\n').length : null,
  })).sort(by('name'));

  /* ---------------------------------------------------------------- code */
  const coverage = Object.fromEntries((await q('SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate', true))
    .filter((c) => c.NumLinesCovered + c.NumLinesUncovered > 0).map((c) => [c.ApexClassOrTrigger?.Name, Math.round((c.NumLinesCovered / (c.NumLinesCovered + c.NumLinesUncovered)) * 100)]));
  // Package code is hidden, so only the org's own classes are read with their body: a package-heavy org has
  // thousands of package classes, and reading their (hidden) bodies page by page takes many minutes.
  progress('code', 0, 1);
  const classRows = [...await q('SELECT Name, ApiVersion, Status, NamespacePrefix, Body FROM ApexClass WHERE NamespacePrefix = null', true),
    ...await q('SELECT Name, ApiVersion, Status, NamespacePrefix FROM ApexClass WHERE NamespacePrefix != null', true)];
  const classes = classRows.map((c) => {
    const body = c.Body && c.Body !== '(hidden)' ? c.Body : '';
    return { name: c.Name, apiVersion: c.ApiVersion, origin: managed(c.NamespacePrefix), lines: body ? body.split('\n').length : null,
      test: /@isTest/i.test(body), callout: !/@isTest/i.test(body) && /callout:|new\s+HttpRequest\b/.test(body), batch: /Database\.Batchable/.test(body), schedulable: /\bSchedulable\b/.test(body),
      coverage: coverage[c.Name] ?? null };
  }).sort(by('name'));
  for (const t of triggers) t.coverage = coverage[t.name] ?? null;
  const lwc = (await q('SELECT DeveloperName, ApiVersion, NamespacePrefix FROM LightningComponentBundle', true)).map((x) => ({ name: x.DeveloperName, apiVersion: x.ApiVersion, origin: managed(x.NamespacePrefix) })).sort(by('name'));
  const aura = (await q('SELECT DeveloperName, ApiVersion, NamespacePrefix FROM AuraDefinitionBundle', true)).map((x) => ({ name: x.DeveloperName, apiVersion: x.ApiVersion, origin: managed(x.NamespacePrefix) })).sort(by('name'));
  const visualforce = (await q('SELECT Name, ApiVersion, NamespacePrefix FROM ApexPage', true)).map((x) => ({ name: x.Name, apiVersion: x.ApiVersion, origin: managed(x.NamespacePrefix) })).sort(by('name'));

  /* ---------------------------------------------------------------- packages */
  const pkgRows = await q('SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion FROM InstalledSubscriberPackage', true);
  const packages = pkgRows.map((p) => {
    const ns = p.SubscriberPackage?.NamespacePrefix || null;
    const owned = (xs) => (ns ? xs.filter((x) => x.NamespacePrefix === ns).length : 0);
    return { name: p.SubscriberPackage?.Name, namespace: ns, version: `${p.SubscriberPackageVersion?.MajorVersion}.${p.SubscriberPackageVersion?.MinorVersion}`,
      objects: owned(customObjectsT), fields: owned(customFields), classes: 0 };
  }).sort(by('name'));
  // Package code is hidden, but the class count shows how much behaviour the package brings.
  for (const p of packages) if (p.namespace) p.classes = (await q(`SELECT Id FROM ApexClass WHERE NamespacePrefix = '${p.namespace}'`, true)).length;

  // Feature configuration held as records. A managed package (or a Salesforce feature such as Consumer Goods
  // Cloud) keeps much of its set-up as records: templates, definitions, settings. These are set-up, not business
  // records: we keep the object, the count and the record names, so the feature's configuration is evidenced
  // without its code.
  const SETUP_NAME = /(Template|Setting|Config|Definition|Rule|Polic|Summar|Schedule|Calculat|Type|Kpi)/i;
  const PLATFORM_SETUP = ['ActionPlanTemplate', 'ActionPlanTemplateItem', 'AssessmentIndicatorDefinition', 'AssessmentTaskDefinition', 'AssessmentTaskIndDefinition', 'RetailStoreGroup', 'InStoreLocation', 'RetailStoreKpi', 'VisitorTerritory', 'ProductCategory'];
  const setupObjects = global.sobjects.filter((s) => s.queryable && (
    (s.custom && installedNs.size && [...installedNs].some((ns) => s.name.startsWith(`${ns}__`)) && (s.customSetting || SETUP_NAME.test(s.name)))
    || PLATFORM_SETUP.includes(s.name)));
  progress('feature configuration', 0, setupObjects.length);
  const featureConfig = await pool(setupObjects, CONCURRENCY, async (s) => {
    const ns = s.name.match(/^([A-Za-z0-9_]+?)__(?=\w+__)/)?.[1] || null;
    const records = await count(`SELECT COUNT() FROM ${s.name}`);
    let names = [];
    if (records) {
      let nameField;
      try { nameField = (await conn.sobject(s.name).describe()).fields.find((f) => f.nameField)?.name; } catch { nameField = null; }
      if (nameField) names = (await q(`SELECT ${nameField} FROM ${s.name} ORDER BY ${nameField} LIMIT 50`)).map((r) => String(r[nameField])).filter(Boolean);
    }
    return { object: s.name, label: s.label, origin: ns ? managed(ns) : 'salesforce', namespace: ns, customSetting: !!s.customSetting, records, names };
  });
  featureConfig.sort((a, b) => `${a.origin}${a.object}`.localeCompare(`${b.origin}${b.object}`));

  /* ---------------------------------------------------------------- scheduled processing */
  const JOB = { 1: 'Data export', 3: 'Dashboard refresh', 4: 'Reporting snapshot', 6: 'Scheduled flow', 7: 'Scheduled Apex', 8: 'Report run', 9: 'Batch Apex', A: 'Report notification' };
  // Report and dashboard jobs are often named after the person who scheduled them, so only code-based jobs keep
  // their name; the others are listed by type and number (no personal data in the outputs).
  const scheduledJobs = (await q('SELECT CronJobDetail.Name, CronJobDetail.JobType, State, CronExpression, NextFireTime FROM CronTrigger'))
    .map((j) => { const code = j.CronJobDetail?.JobType; const type = JOB[code] || `System job (type ${code || '?'})`; return { name: /Apex/.test(type) ? j.CronJobDetail?.Name : null, type, state: j.State, schedule: j.CronExpression, next: j.NextFireTime ? String(j.NextFireTime).slice(0, 10) : null }; })
    .sort((a, b) => `${a.type}${a.name}${a.schedule}`.localeCompare(`${b.type}${b.name}${b.schedule}`))
    .map((j, k, all) => ({ ...j, name: j.name || `${j.type} ${all.slice(0, k + 1).filter((x) => x.type === j.type && !x.name).length}` }));

  /* ---------------------------------------------------------------- security */
  const profiles = (await q('SELECT Name, UserLicense.Name, UserType FROM Profile')).map((p) => ({ name: p.Name, licence: p.UserLicense?.Name, users: usersByProfile.find((u) => u.profile === p.Name)?.users || 0 })).sort(by('name'));
  const psAssign = Object.fromEntries((await q('SELECT PermissionSetId p, COUNT(Id) n FROM PermissionSetAssignment WHERE PermissionSet.IsOwnedByProfile = false GROUP BY PermissionSetId')).map((r) => [r.p, r.n]));
  const permissionSets = (await q('SELECT Id, Name, Label, NamespacePrefix, Type FROM PermissionSet WHERE IsOwnedByProfile = false'))
    .filter((p) => p.Type !== 'Group').map((p) => ({ name: p.Name, label: p.Label, origin: managed(p.NamespacePrefix), assignments: psAssign[p.Id] || 0 })).sort(by('name'));
  const permissionSetGroups = (await q('SELECT DeveloperName, MasterLabel, NamespacePrefix FROM PermissionSetGroup')).map((g) => ({ name: g.DeveloperName, label: g.MasterLabel, origin: managed(g.NamespacePrefix) })).sort(by('name'));
  const roleRows = await q('SELECT Id, Name, ParentRoleId FROM UserRole');
  const depth = (id, seen = 0) => { const r = roleRows.find((x) => x.Id === id); return r && r.ParentRoleId && seen < 50 ? 1 + depth(r.ParentRoleId, seen + 1) : 1; };
  const roles = { count: roleRows.length, depth: roleRows.reduce((m, r) => Math.max(m, depth(r.Id)), 0), names: roleRows.map((r) => r.Name).sort() };
  let sharingRules = [];
  try {
    for (const type of ['SharingCriteriaRule', 'SharingOwnerRule']) {
      const list = await conn.metadata.list([{ type }], API);
      sharingRules.push(...[].concat(list || []).map((x) => ({ name: x.fullName, kind: type === 'SharingCriteriaRule' ? 'criteria' : 'owner' })));
    }
  } catch { sharingRules = []; }
  sharingRules.sort(by('name'));
  // Field-level access to custom fields: how many profiles and permission sets can read and edit each one.
  const fieldAccess = {};
  const customObjs = objects.filter((ob) => ob.fields.some((f) => f.origin !== 'standard')).map((ob) => `'${ob.name}'`);
  if (customObjs.length) {
    for (const p of await q(`SELECT SobjectType, Field, PermissionsRead, PermissionsEdit, Parent.IsOwnedByProfile FROM FieldPermissions WHERE SobjectType IN (${customObjs.join(',')})`)) {
      const a = (fieldAccess[p.Field] ||= { read: 0, edit: 0, profiles: 0, permissionSets: 0 });
      if (p.PermissionsRead) a.read++;
      if (p.PermissionsEdit) a.edit++;
      if (p.Parent?.IsOwnedByProfile) a.profiles++; else a.permissionSets++;
    }
  }
  for (const ob of objects) for (const f of ob.fields) if (f.origin !== 'standard') f.access = fieldAccess[`${ob.name}.${f.name}`] || { read: 0, edit: 0, profiles: 0, permissionSets: 0 };

  /* ---------------------------------------------------------------- integrations */
  const namedCredentials = (await q('SELECT DeveloperName, MasterLabel, Endpoint FROM NamedCredential')).map((n) => ({ name: n.DeveloperName, label: n.MasterLabel, host: hostOf(n.Endpoint) })).sort(by('name'));
  const remoteSites = (await q('SELECT SiteName, EndpointUrl, IsActive FROM RemoteProxy', true)).map((r) => ({ name: r.SiteName, host: hostOf(r.EndpointUrl), active: r.IsActive })).sort(by('name'));
  const connectedApps = (await q('SELECT Name FROM ConnectedApplication')).map((c) => c.Name).sort();
  const logins = await q('SELECT Application, LoginType, COUNT(Id) n FROM LoginHistory WHERE LoginTime = LAST_N_DAYS:90 GROUP BY Application, LoginType');
  const loginSources = logins.map((l) => ({ application: l.Application, type: l.LoginType, logins: l.n })).sort((a, b) => b.logins - a.logins);

  /* ---------------------------------------------------------------- user interface */
  const apps = (await q('SELECT DeveloperName, Label, NavType, UiType, NamespacePrefix FROM CustomApplication', true)).map((a) => ({ name: a.DeveloperName, label: a.Label, nav: a.NavType, ui: a.UiType, origin: managed(a.NamespacePrefix) })).sort(by('label'));
  const flexiPages = (await q('SELECT DeveloperName, MasterLabel, Type, EntityDefinitionId, NamespacePrefix FROM FlexiPage', true)).map((f) => ({ name: f.DeveloperName, label: f.MasterLabel, type: f.Type, object: objIdToName[f.EntityDefinitionId] || f.EntityDefinitionId || null, origin: managed(f.NamespacePrefix) })).sort(by('name'));

  /* ---------------------------------------------------------------- usage */
  const reports = await q('SELECT Name, FolderName, Format, LastRunDate FROM Report');
  const cutoff = Date.now() - 90 * 864e5;
  const usage = {
    reports: reports.length, reportsRun90d: reports.filter((r) => r.LastRunDate && Date.parse(r.LastRunDate) >= cutoff).length,
    reportFolders: [...new Set(reports.map((r) => r.FolderName).filter(Boolean))].sort(),
    dashboards: await count('SELECT COUNT() FROM Dashboard'), emailTemplates: await count('SELECT COUNT() FROM EmailTemplate'),
    activeUsers: usersByProfile.reduce((n, u) => n + u.users, 0),
  };

  // Where-used: Salesforce's own dependency index between components (unmanaged components only).
  const dependencies = (await q("SELECT MetadataComponentName, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentNamespace = null LIMIT 2000", true))
    .filter((d) => ['ApexClass', 'ApexTrigger', 'Flow', 'ValidationRule', 'CustomField', 'CustomObject', 'LightningComponentBundle', 'ApexPage', 'FlexiPage', 'Layout', 'EmailTemplate', 'Report'].includes(d.MetadataComponentType))
    .map((d) => ({ from: d.MetadataComponentName, fromType: d.MetadataComponentType, to: d.RefMetadataComponentName, toType: d.RefMetadataComponentType }))
    .sort((a, b) => `${a.fromType}${a.from}${a.toType}${a.to}`.localeCompare(`${b.fromType}${b.from}${b.toType}${b.to}`));

  const markets = [];
  const acc = objects.find((o) => o.name === 'Account');
  if (acc?.fields.some((f) => f.name === 'Market__c')) {
    for (const r of await q('SELECT Market__c m, COUNT(Id) n FROM Account WHERE Market__c != null GROUP BY Market__c')) markets.push({ name: r.m, customers: r.n });
    markets.sort(by('name'));
  }

  const out = {
    region, label: label || region,
    profile: { edition: orgRow.OrganizationType, locale: orgRow.DefaultLocaleSidKey, language: orgRow.LanguageLocaleKey, timeZone: orgRow.TimeZoneSidKey, currencies, licences, featureLicences, limits, usersByProfile },
    markets, objects, validationRules, flows, approvals, workflowRules, triggers, scheduledJobs,
    code: { classes, lwc, aura, visualforce }, packages, featureConfig,
    security: { profiles, permissionSets, permissionSetGroups, roles, sharingRules },
    integrations: { namedCredentials, remoteSites, connectedApps, loginSources, calloutClasses: classes.filter((c) => c.callout).map((c) => c.name) },
    ui: { apps, flexiPages }, usage, dependencies,
  };
  const file = path.join(P.ASSESSMENT, 'discovery', region, 'discovery.json');
  writeJson(file, out);
  console.log(`discovery: ${out.label}: ${objects.length} objects, ${validationRules.length} validation rules, ${flows.length} flows, ${triggers.length} triggers, ${classes.length} classes, ${packages.length} packages -> ${P.rel(file)}`);
}

// Flow logic as nodes and edges, enough to draw the flow and describe what it does.
function flowLogic(m) {
  const kinds = { decisions: 'Decision', assignments: 'Assignment', recordCreates: 'Create records', recordUpdates: 'Update records', recordLookups: 'Get records', recordDeletes: 'Delete records', actionCalls: 'Action', subflows: 'Subflow', loops: 'Loop', screens: 'Screen', waits: 'Wait', collectionProcessors: 'Collection', customErrors: 'Custom error', transforms: 'Transform' };
  const nodes = [];
  const edges = [];
  const add = (from, conn, labelText) => { if (conn?.targetReference) edges.push({ from, to: conn.targetReference, label: labelText }); };
  const s = m.start || {};
  const startTxt = [s.triggerType, s.recordTriggerType, s.object].filter(Boolean).join(' · ') || 'Start';
  nodes.push({ id: '__start', kind: 'Start', label: startTxt, filter: (s.filters || []).map((f) => `${f.field} ${f.operator} ${valueOf(f.value)}`).join(` ${s.filterLogic || 'and'} `) || s.filterFormula || null });
  add('__start', s.connector, null);
  for (const sp of [].concat(s.scheduledPaths || [])) add('__start', sp.connector, sp.label || 'scheduled');
  for (const [key, kind] of Object.entries(kinds)) {
    for (const e of [].concat(m[key] || [])) {
      nodes.push({ id: e.name, kind, label: e.label || e.name, object: e.object || e.inputReference || undefined, action: e.actionName || e.flowName || undefined });
      add(e.name, e.connector, null);
      add(e.name, e.defaultConnector, e.defaultConnectorLabel || 'default');
      add(e.name, e.nextValueConnector, 'each');
      add(e.name, e.noMoreValuesConnector, 'done');
      add(e.name, e.faultConnector, 'fault');
      for (const r of [].concat(e.rules || [])) add(e.name, r.connector, r.label || r.name);
    }
  }
  return { nodes, edges, apiVersion: m.apiVersion || null };
}
function valueOf(v) { if (!v) return ''; const k = Object.keys(v).find((x) => v[x] != null); return k ? String(v[k]) : ''; }
function hostOf(u) { try { return new URL(String(u).replace(/^callout:/, 'https://')).host; } catch { return null; } }

main().catch((e) => { console.error(e.message || e); process.exit(1); });
