// As-is extraction for the multi-org assessment: what one org has built on top of standard Salesforce, and how
// much of it is used. Read-only (describe, SOQL, Tooling API).
//
//   SF_ALIAS=myorg node src/generators/assess-org.js eu "Europe"
//
// Writes adlc/1-discover/assessment/orgs/<region>.json. No org ID, instance, user names or record contents are
// written: only names of components, counts and fill rates, so the file can be versioned and shared.
const path = require('path');
const { connect, writeJson, pool, progress, CONCURRENCY, P } = require('./lib');
const { analyseApex } = require('./apex-functions');

const [region, label] = process.argv.slice(2);
if (!region) { console.error('usage: SF_ALIAS=<alias> node src/generators/assess-org.js <region> "<label>"'); process.exit(2); }

const API = '67.0';
// Standard objects whose added fields are always assessed; any other standard or package object with an unmanaged
// custom field is added at run time.
const STANDARD = ['Account', 'Contact', 'Lead', 'Opportunity', 'Product2', 'Order', 'OrderItem', 'Case', 'Campaign', 'Contract', 'Quote', 'Asset',
  'RetailStore', 'Visit', 'RetailVisitKpi', 'AssessmentTask', 'RetailStoreGroup', 'InStoreLocation', 'StoreProduct'];
const SKIP_FILL = new Set(['LongTextArea', 'Html', 'EncryptedString', 'base64', 'textarea']);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

async function main() {
  const conn = await connect();
  conn.version = API;
  const soql = async (q, tooling = false) => {
    try { return (await (tooling ? conn.tooling : conn).query(q, { autoFetch: true, maxFetch: 50000 })).records; } catch (e) { return { error: e.errorCode || e.message }; }
  };
  const count = async (q) => { try { return (await conn.query(q)).totalSize; } catch { return null; } };
  const ok = (r) => (Array.isArray(r) ? r : []);

  const org = ok(await soql('SELECT OrganizationType, DefaultLocaleSidKey, TimeZoneSidKey FROM Organization'))[0] || {};
  const global = await conn.describeGlobal();
  const unmanaged = (n) => n.endsWith('__c') && !/^[A-Za-z0-9_]+?__[A-Za-z0-9_]+__c$/.test(n);

  // Custom fields on an object, with how often each is filled in (the strongest hint that a field can go).
  async function fields(obj, total) {
    const d = await conn.sobject(obj).describe();
    const out = [];
    for (const f of d.fields.filter((x) => x.custom && unmanaged(x.name))) {
      const kind = f.calculated ? (f.calculatedFormula ? 'Formula' : 'Roll-up') : f.type === 'reference' ? (f.relationshipOrder != null ? 'Master-detail' : 'Lookup') : f.type;
      let fill = null;
      if (total > 0 && !f.calculated && !SKIP_FILL.has(f.type) && f.filterable) {
        const n = await count(`SELECT COUNT() FROM ${obj} WHERE ${f.name} ${f.type === 'boolean' ? '= true' : '!= null'}`);
        if (n != null) fill = Math.round((n / total) * 100);
      }
      out.push({ name: f.name, label: f.label, type: kind, references: f.referenceTo?.length ? f.referenceTo : undefined, fill });
    }
    return out.sort(byName);
  }

  // 1. Custom objects, several at a time (each object's counts run one after another inside its slot).
  const customObjs = global.sobjects.filter((s) => s.custom && unmanaged(s.name) && s.queryable && !s.customSetting);
  // Objects someone extended with fields of their own: the standard objects above, plus every standard or package
  // object (e.g. cgcloud__Promotion__c) that carries an unmanaged custom field.
  const queryable = new Set(global.sobjects.filter((s) => s.queryable && !s.customSetting).map((s) => s.name));
  const objById = Object.fromEntries(ok(await soql('SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject', true)).map((o) => [o.Id, `${o.NamespacePrefix ? `${o.NamespacePrefix}__` : ''}${o.DeveloperName}__c`]));
  const withOwnFields = new Set(ok(await soql('SELECT TableEnumOrId FROM CustomField WHERE NamespacePrefix = null', true)).map((f) => objById[f.TableEnumOrId] || f.TableEnumOrId));
  const stdObjs = [...new Set([...STANDARD, ...withOwnFields])].filter((n) => queryable.has(n) && !(n.endsWith('__c') && unmanaged(n))).sort();
  const totalObjs = customObjs.length + stdObjs.length;
  let doneObjs = 0;
  const tick = () => { doneObjs++; if (doneObjs % Math.max(1, Math.round(totalObjs / 20)) === 0 || doneObjs === totalObjs) progress('as-is objects', doneObjs, totalObjs); };
  progress('as-is objects', 0, totalObjs);
  const objects = await pool(customObjs, CONCURRENCY, async (g) => {
    try { const records = await count(`SELECT COUNT() FROM ${g.name}`); return { name: g.name, label: g.label, records, fields: await fields(g.name, records) }; } finally { tick(); }
  });
  objects.sort(byName);

  // 2. Standard objects extended with custom fields
  const extended = (await pool(stdObjs, CONCURRENCY, async (name) => {
    try {
      const records = await count(`SELECT COUNT() FROM ${name}`);
      const fs_ = await fields(name, records);
      const ns = name.match(/^([A-Za-z0-9_]+?)__\w+__c$/)?.[1];
      return fs_.length ? { name, records, fields: fs_, ...(ns ? { package: ns } : {}) } : null;
    } catch { return null; } finally { tick(); }
  })).filter(Boolean);
  progress('as-is code and automation', 0, 1);

  // 3. Code and declarative automation (unmanaged only)
  const customNames = objects.map((o) => o.name);
  const touches = (body) => [...new Set(customNames.filter((n) => new RegExp(`\\b${n}\\b`).test(body || '')))].sort();
  const classRows = ok(await soql('SELECT Id, Name, Body, ApiVersion, LastModifiedDate FROM ApexClass WHERE NamespacePrefix = null', true));
  const trigRows = ok(await soql('SELECT Name, TableEnumOrId, Body, Status, ApiVersion, LastModifiedDate FROM ApexTrigger WHERE NamespacePrefix = null', true));

  // "Is it used?" before anything is called unused. (1) Salesforce's dependency index: what refers to each class —
  // Lightning components, Visualforce, flows, other code. Queried 100 classes at a time (2,000 rows per query).
  progress('as-is usage check', 0, 2);
  const usedBy = {};
  let dependencyCheck = 'ok';
  for (let i = 0; i < classRows.length; i += 100) {
    const ids = classRows.slice(i, i + 100).map((c) => `'${c.Id}'`).join(',');
    const rows = await soql(`SELECT MetadataComponentName, MetadataComponentType, RefMetadataComponentName FROM MetadataComponentDependency WHERE RefMetadataComponentType = 'ApexClass' AND RefMetadataComponentId IN (${ids})`, true);
    if (!Array.isArray(rows)) { dependencyCheck = `unavailable (${rows.error})`; break; }
    for (const r of rows) if (r.MetadataComponentName !== r.RefMetadataComponentName) (usedBy[r.RefMetadataComponentName] ||= []).push({ type: r.MetadataComponentType, name: r.MetadataComponentName });
  }
  // (2) When the code last ran, from Event Monitoring logs where the org has them (last 30 days, newest first,
  // capped in size). Without Event Monitoring this is reported as not available, never as "not used".
  const lastRun = {};
  const logs = { available: false, days: 30, files: 0 };
  const logRows = await soql("SELECT Id, EventType, LogDate, LogFileLength FROM EventLogFile WHERE EventType IN ('ApexExecution', 'ApexTrigger') AND LogDate = LAST_N_DAYS:30 ORDER BY LogDate DESC");
  if (Array.isArray(logRows) && logRows.length) {
    logs.available = true;
    let bytes = 0;
    for (const f of logRows) {
      if (bytes > 200e6) break;
      bytes += f.LogFileLength || 0;
      let csv = '';
      try { csv = String(await conn.request(`/services/data/v${API}/sobjects/EventLogFile/${f.Id}/LogFile`)); } catch { continue; }
      logs.files++;
      const [head, ...lines] = csv.split(/\r?\n/);
      const cols = head.split(',').map((h) => h.replace(/"/g, ''));
      const col = cols.indexOf(f.EventType === 'ApexTrigger' ? 'TRIGGER_NAME' : 'ENTRY_POINT');
      if (col < 0) continue;
      const day = String(f.LogDate).slice(0, 10);
      for (const l of lines) {
        const v = (l.split(',')[col] || '').replace(/"/g, '').split('.')[0];
        if (v && (!lastRun[v] || lastRun[v] < day)) lastRun[v] = day;
      }
    }
  } else if (!Array.isArray(logRows)) logs.reason = logRows.error;
  progress('as-is usage check', 2, 2);
  // Line references hold for the version read: keep its API version and last change with them.
  const version = (r) => ({ apiVersion: r.ApiVersion, modified: (r.LastModifiedDate || '').slice(0, 10) });
  // Function-level reading of the code (kb/fit-gap-method.md). Only names and verdicts are kept, never the source.
  const isTest = (b) => /@isTest/i.test(b || '');
  const live = [...classRows.filter((c) => !isTest(c.Body)), ...trigRows.filter((t) => t.Status === 'Active')];
  const entryPoint = /@AuraEnabled|@InvocableMethod|@RestResource|webservice\s|implements\s+[\w.,\s]*(Schedulable|Database\.Batchable|Queueable)|@RemoteAction/i;
  const calledFromLiveCode = (name) => live.some((x) => x.Name !== name && new RegExp(`\\b${name}\\b`).test(x.Body || ''));
  const classes = classRows
    .map((c) => {
      const test = isTest(c.Body);
      const objs = touches(c.Body);
      const analysis = test ? undefined : analyseApex(c.Name, c.Body, { kind: 'class' });
      const refs = (usedBy[c.Name] || []).filter((r) => r.type !== 'ApexClass' || !/test/i.test(r.name));
      const entry = entryPoint.test(c.Body || '');
      return { name: c.Name, lines: (c.Body || '').split('\n').length, ...version(c), test, callout: /callout:|new\s+HttpRequest|HttpCalloutMock/.test(c.Body || '') && !test, objects: objs,
        ...(test ? {} : {
          analysis,
          // Unused only when nothing refers to it — not code, not a screen, flow or page — and it is no entry point.
          unreferenced: !entry && !calledFromLiveCode(c.Name) && !refs.length,
          use: { entryPoint: entry, calledFromCode: calledFromLiveCode(c.Name), usedBy: refs.slice(0, 12), usedByCount: refs.length, lastRun: lastRun[c.Name] || null },
        }) };
    })
    .sort(byName);
  const triggers = trigRows
    // TableEnumOrId is an Id for custom objects: keep the object's name, so placement and reports can read it.
    .map((t) => ({ name: t.Name, object: objById[t.TableEnumOrId] || t.TableEnumOrId, active: t.Status === 'Active', lines: (t.Body || '').split('\n').length, ...version(t), lastRun: lastRun[t.Name] || null,
      analysis: analyseApex(t.Name, t.Body, { kind: 'trigger', object: t.TableEnumOrId }) }))
    .sort(byName);
  const flows = ok(await soql('SELECT ApiName, Label, ProcessType, TriggerType, TriggerObjectOrEventLabel, IsActive FROM FlowDefinitionView WHERE NamespacePrefix = null'))
    .map((f) => ({ name: f.ApiName, label: f.Label, kind: f.ProcessType, trigger: f.TriggerType, object: f.TriggerObjectOrEventLabel, active: f.IsActive }))
    .sort(byName);
  const rules = ok(await soql('SELECT ValidationName, EntityDefinition.QualifiedApiName, Active FROM ValidationRule WHERE NamespacePrefix = null', true))
    .map((v) => ({ name: v.ValidationName, object: v.EntityDefinition?.QualifiedApiName, active: v.Active }))
    .sort((a, b) => `${a.object}.${a.name}`.localeCompare(`${b.object}.${b.name}`));
  const workflowRules = ok(await soql('SELECT Name, TableEnumOrId FROM WorkflowRule WHERE NamespacePrefix = null', true)).map((w) => ({ name: w.Name, object: objById[w.TableEnumOrId] || w.TableEnumOrId })).sort(byName);
  const approvals = ok(await soql("SELECT Name, TableEnumOrId, State FROM ProcessDefinition WHERE Type = 'Approval'")).map((a) => ({ name: a.Name, object: a.TableEnumOrId, active: a.State === 'Active' })).sort(byName);

  // 4. Packages, licences, integrations, usage
  const packages = ok(await soql('SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix FROM InstalledSubscriberPackage', true))
    .map((p) => ({ name: p.SubscriberPackage?.Name, namespace: p.SubscriberPackage?.NamespacePrefix })).sort(byName);
  const licences = ok(await soql('SELECT MasterLabel, TotalLicenses, UsedLicenses FROM UserLicense WHERE TotalLicenses > 0'))
    .map((l) => ({ name: l.MasterLabel, total: l.TotalLicenses, used: l.UsedLicenses })).sort(byName);
  const featureLicences = ok(await soql('SELECT MasterLabel, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE TotalLicenses > 0'))
    .map((l) => ({ name: l.MasterLabel, total: l.TotalLicenses, used: l.UsedLicenses })).sort(byName);
  const namedCredentials = ok(await soql('SELECT DeveloperName FROM NamedCredential')).map((n) => n.DeveloperName).sort();
  const remoteSites = ok(await soql('SELECT SiteName FROM RemoteProxy', true)).map((r) => r.SiteName).sort();
  const activeUsers = await count('SELECT COUNT() FROM User WHERE IsActive = true AND UserType = \'Standard\'');
  const reports = await count('SELECT COUNT() FROM Report');

  // 5. Markets: where the org records them (Account.Market__c in the demo orgs), with customers per market
  const marketField = extended.find((o) => o.name === 'Account')?.fields.find((f) => f.name === 'Market__c');
  let markets = [];
  if (marketField) {
    const values = (await conn.sobject('Account').describe()).fields.find((f) => f.name === 'Market__c').picklistValues.filter((v) => v.active).map((v) => v.value);
    const counts = Object.fromEntries(ok(await soql('SELECT Market__c m, COUNT(Id) n FROM Account WHERE Market__c != null GROUP BY Market__c')).map((r) => [r.m, r.n]));
    markets = values.map((m) => ({ name: m, customers: counts[m] || 0 }));
  }

  const asIs = {
    region, label: label || region,
    org: { edition: org.OrganizationType, locale: org.DefaultLocaleSidKey, timeZone: org.TimeZoneSidKey },
    markets, objects, extended,
    automation: { classes, triggers, flows, validationRules: rules, workflowRules, approvals },
    packages, licences, featureLicences,
    integrations: { namedCredentials, remoteSites, calloutClasses: classes.filter((c) => c.callout).map((c) => c.name) },
    usage: { activeUsers, reports },
    // How "is it used?" was established for this org, so every verdict can say how sure it is.
    usageCheck: { dependencies: dependencyCheck, logs },
  };
  const file = path.join(P.ASSESSMENT, 'orgs', `${region}.json`);
  writeJson(file, asIs);
  console.log(`assessment as-is: ${asIs.label}: ${objects.length} custom objects, ${extended.reduce((a, o) => a + o.fields.length, 0)} custom fields on standard objects, ${classes.length} classes, ${triggers.length} triggers, ${flows.length} flows, ${markets.length} markets -> ${P.rel(file)}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
