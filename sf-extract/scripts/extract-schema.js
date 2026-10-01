// Phase 1a: schema blueprint — objects, fields, data types, formulas, picklists, relationships.
// Also writes manifest/package.xml covering standard + custom objects for the metadata retrieve.
const fs = require('fs');
const path = require('path');
const { connect, writeJson, isBusinessObject, isHistoryObject, ROOT, OUT } = require('./lib');

const API = '67.0';

async function main() {
  const conn = await connect();
  const global = await conn.describeGlobal();
  const business = global.sobjects.filter(isBusinessObject);
  const businessNames = new Set(business.map((g) => g.name));
  const history = global.sobjects.filter((g) => isHistoryObject(g, businessNames));
  const targets = [...business, ...history];
  console.log(`describeGlobal: ${global.sobjects.length} total, ${business.length} business, ${history.length} history`);

  const objects = [];
  const relationships = [];
  for (const [i, g] of targets.entries()) {
    let d;
    try {
      d = await conn.describe(g.name);
    } catch (e) {
      console.warn(`  skip ${g.name}: ${e.message}`);
      continue;
    }
    const fields = d.fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      length: f.length || undefined,
      precision: f.precision || undefined,
      scale: f.scale || undefined,
      required: !f.nillable && f.createable && !f.defaultedOnCreate,
      unique: f.unique || undefined,
      externalId: f.externalId || undefined,
      custom: f.custom,
      calculated: f.calculated || undefined,
      formula: f.calculatedFormula || undefined,
      defaultValue: f.defaultValueFormula || f.defaultValue || undefined,
      picklistValues: f.picklistValues?.length
        ? f.picklistValues.filter((p) => p.active).map((p) => p.value)
        : undefined,
      controllerName: f.controllerName || undefined,
      referenceTo: f.referenceTo?.length ? f.referenceTo : undefined,
      relationshipName: f.relationshipName || undefined,
      compoundFieldName: f.compoundFieldName || undefined,
      inlineHelpText: f.inlineHelpText || undefined,
    }));
    for (const f of d.fields.filter((x) => x.type === 'reference')) {
      relationships.push({
        from: d.name,
        field: f.name,
        to: f.referenceTo,
        relationshipName: f.relationshipName,
        kind: f.cascadeDelete && f.relationshipOrder != null ? 'MasterDetail' : 'Lookup',
        polymorphic: f.referenceTo.length > 1,
      });
    }
    const obj = {
      name: d.name,
      label: d.label,
      custom: d.custom,
      keyPrefix: d.keyPrefix,
      isHistory: !businessNames.has(d.name),
      recordTypes: d.recordTypeInfos.filter((r) => r.active && !r.master).map((r) => r.developerName),
      fields,
      childRelationships: d.childRelationships
        .filter((c) => c.relationshipName && businessNames.has(c.childSObject))
        .map((c) => ({ child: c.childSObject, field: c.field, relationshipName: c.relationshipName, cascadeDelete: c.cascadeDelete })),
    };
    objects.push(obj);
    writeJson(path.join(OUT, 'schema', 'objects', `${d.name}.json`), obj);
    if ((i + 1) % 25 === 0) console.log(`  described ${i + 1}/${targets.length}`);
  }

  writeJson(path.join(OUT, 'schema', 'relationships.json'), relationships);
  writeJson(path.join(OUT, 'schema', 'index.json'), objects.map((o) => ({
    name: o.name, label: o.label, custom: o.custom, isHistory: o.isHistory, fieldCount: o.fields.length,
  })));
  writeSummary(objects, relationships);
  writeManifest(business.map((g) => g.name));
  console.log(`schema: ${objects.length} objects, ${relationships.length} relationships -> output/schema`);
}

// Compact, LLM-readable blueprint of the business objects.
function writeSummary(objects, relationships) {
  const lines = ['# Salesforce Org Schema', ''];
  for (const o of objects.filter((x) => !x.isHistory)) {
    lines.push(`## ${o.name} (${o.label})${o.custom ? ' [custom]' : ''}`);
    if (o.recordTypes.length) lines.push(`Record types: ${o.recordTypes.join(', ')}`);
    for (const f of o.fields) {
      let t = f.type;
      if (f.referenceTo) t += ` -> ${f.referenceTo.join('|')}`;
      if (f.formula) t += ` = ${f.formula.replace(/\s+/g, ' ')}`;
      if (f.picklistValues) t += ` {${f.picklistValues.slice(0, 15).join(', ')}${f.picklistValues.length > 15 ? ', …' : ''}}`;
      lines.push(`- ${f.name}: ${t}${f.required ? ' (required)' : ''}`);
    }
    lines.push('');
  }
  lines.push('## Relationships', '');
  for (const r of relationships) lines.push(`- ${r.from}.${r.field} -> ${r.to.join('|')} (${r.kind})`);
  fs.writeFileSync(path.join(OUT, 'schema', 'schema-summary.md'), lines.join('\n'));
}

// Wildcards don't cover standard objects, so they are listed explicitly.
function writeManifest(objectNames) {
  const wildcard = [
    'ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent', 'LightningComponentBundle', 'AuraDefinitionBundle',
    'Flow', 'FlowDefinition', 'Workflow', 'AssignmentRules', 'AutoResponseRules', 'EscalationRules', 'ApprovalProcess',
    'Profile', 'PermissionSet', 'PermissionSetGroup', 'CustomPermission', 'Role', 'Group', 'Queue', 'SharingRules',
    'Layout', 'FlexiPage', 'CustomTab', 'CustomApplication', 'QuickAction', 'GlobalValueSet', 'CustomLabels',
    'CustomMetadata', 'DuplicateRule', 'MatchingRules', 'RecordType', 'ValidationRule', 'CustomField',
  ];
  const types = [
    `    <types>\n${objectNames.map((n) => `        <members>${n}</members>`).join('\n')}\n        <members>*</members>\n        <name>CustomObject</name>\n    </types>`,
    ...wildcard.map((t) => `    <types>\n        <members>*</members>\n        <name>${t}</name>\n    </types>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types.join('\n')}\n    <version>${API}</version>\n</Package>\n`;
  fs.writeFileSync(path.join(ROOT, 'manifest', 'package.xml'), xml);
  console.log(`manifest/package.xml: ${objectNames.length} objects + ${wildcard.length} wildcard types`);
}

main().catch((e) => { console.error(e); process.exit(1); });
