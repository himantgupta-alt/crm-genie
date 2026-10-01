// Phase 1b/1c: business rules + automations, parsed from the retrieved metadata in force-app/.
// Run after `sf project retrieve start --manifest manifest/package.xml`.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { writeJson, ROOT, OUT } = require('./lib');

const globalRoot = execSync('npm root -g').toString().trim();
const { XMLParser } = require(path.join(globalRoot, '@salesforce/cli/node_modules/fast-xml-parser'));

const SRC = path.join(ROOT, 'force-app', 'main', 'default');
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const arr = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const bool = (x) => x === 'true';

function readXml(file) {
  const doc = parser.parse(fs.readFileSync(file, 'utf8'));
  return doc[Object.keys(doc).find((k) => k !== '?xml')];
}

function listFiles(dir, suffix) {
  const full = path.join(SRC, dir);
  if (!fs.existsSync(full)) return [];
  const out = [];
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    const p = path.join(full, e.name);
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), suffix));
    else if (e.name.endsWith(suffix)) out.push(p);
  }
  return out;
}

const baseName = (file, suffix) => path.basename(file, suffix);

function validationRules() {
  return listFiles('objects', '.validationRule-meta.xml').map((f) => {
    const v = readXml(f);
    return {
      object: path.basename(path.dirname(path.dirname(f))),
      name: v.fullName || baseName(f, '.validationRule-meta.xml'),
      active: bool(v.active),
      condition: v.errorConditionFormula, // record is REJECTED when this evaluates to true
      errorMessage: v.errorMessage,
      errorField: v.errorDisplayField,
      description: v.description,
    };
  });
}

function formulaFields() {
  return listFiles('objects', '.field-meta.xml').flatMap((f) => {
    const v = readXml(f);
    if (!v.formula && !v.summaryOperation) return [];
    return [{
      object: path.basename(path.dirname(path.dirname(f))),
      field: v.fullName,
      type: v.type,
      formula: v.formula,
      treatBlanksAs: v.formulaTreatBlanksAs, // BlankAsZero | BlankAsBlank — changes results for nullable inputs
      precision: v.precision, scale: v.scale,
      rollup: v.summaryOperation ? {
        op: v.summaryOperation, of: v.summarizedField, from: v.summaryForeignKey,
        filter: arr(v.summaryFilterItems).map((c) => ({ field: c.field, operation: c.operation, value: c.value })),
      } : undefined,
    }];
  });
}

function conditionText(c) {
  const val = c.rightValue ? Object.values(c.rightValue)[0] : '';
  return `${c.leftValueReference} ${c.operator} ${typeof val === 'object' ? JSON.stringify(val) : val}`;
}

// Flow element value: { stringValue | numberValue | booleanValue | dateValue | elementReference }.
function flowValue(v) {
  if (!v) return null;
  const [kind, value] = Object.entries(v)[0];
  return kind === 'elementReference' ? { ref: value } : { literal: value, kind };
}

const assignments = (r) => arr(r.inputAssignments).map((a) => ({ field: a.field, value: flowValue(a.value) }));

function flows() {
  return listFiles('flows', '.flow-meta.xml').map((f) => {
    const v = readXml(f);
    const start = v.start || {};
    return {
      name: baseName(f, '.flow-meta.xml'),
      label: v.label,
      processType: v.processType,
      status: v.status,
      description: v.description,
      trigger: start.object ? {
        object: start.object,
        triggerType: start.triggerType,
        recordTriggerType: start.recordTriggerType,
        entryConditions: arr(start.filters).map(({ field, operator, value }) => `${field} ${operator} ${value ? Object.values(value)[0] : ''}`),
        filterLogic: start.filterLogic,
        filterFormula: start.filterFormula, // formula-based entry criteria, used instead of filters
        doesRequireRecordChangedToMeetCriteria: bool(start.doesRequireRecordChangedToMeetCriteria),
        firstElement: start.connector?.targetReference,
      } : undefined,
      decisions: arr(v.decisions).map((d) => ({
        name: d.name,
        rules: arr(d.rules).map((r) => ({
          name: r.name, logic: r.conditionLogic, conditions: arr(r.conditions).map(conditionText),
          then: r.connector?.targetReference,
        })),
        default: d.defaultConnector?.targetReference,
      })),
      recordLookups: arr(v.recordLookups).map((r) => ({ name: r.name, object: r.object, filters: arr(r.filters).map(conditionText) })),
      recordCreates: arr(v.recordCreates).map((r) => ({ name: r.name, object: r.object, assignments: assignments(r), next: r.connector?.targetReference })),
      recordUpdates: arr(v.recordUpdates).map((r) => ({
        name: r.name, object: r.object || '$Record',
        fields: arr(r.inputAssignments).map((a) => `${a.field} = ${a.value ? JSON.stringify(Object.values(a.value)[0]) : ''}`),
        assignments: assignments(r), next: r.connector?.targetReference,
      })),
      recordDeletes: arr(v.recordDeletes).map((r) => ({ name: r.name, object: r.object })),
      actions: arr(v.actionCalls).map((a) => ({ name: a.name, actionType: a.actionType, actionName: a.actionName })),
      subflows: arr(v.subflows).map((s) => s.flowName),
      formulas: arr(v.formulas).map((x) => ({ name: x.name, expression: x.expression })),
    };
  });
}

function workflowRules() {
  return listFiles('workflows', '.workflow-meta.xml').flatMap((f) => {
    const v = readXml(f);
    const object = baseName(f, '.workflow-meta.xml');
    return arr(v.rules).map((r) => ({
      object, name: r.fullName, active: bool(r.active), triggerType: r.triggerType,
      formula: r.formula, criteria: arr(r.criteriaItems).map((c) => `${c.field} ${c.operation} ${c.value}`),
      actions: arr(r.actions).map((a) => `${a.type}:${a.name}`),
    }));
  });
}

function namedRules(dir, suffix, key) {
  return listFiles(dir, suffix).flatMap((f) => {
    const v = readXml(f);
    return arr(v[key]).map((r) => ({
      object: baseName(f, suffix),
      name: r.fullName,
      active: bool(r.active),
      entries: arr(r.ruleEntry).map((e) => ({
        criteria: arr(e.criteriaItems).map((c) => `${c.field} ${c.operation} ${c.value}`),
        formula: e.formula, assignedTo: e.assignedTo,
      })),
    }));
  });
}

function duplicateRules() {
  return listFiles('duplicateRules', '.duplicateRule-meta.xml').map((f) => {
    const v = readXml(f);
    return {
      name: baseName(f, '.duplicateRule-meta.xml'), active: bool(v.isActive), actionOnInsert: v.actionOnInsert,
      actionOnUpdate: v.actionOnUpdate, alertText: v.alertText,
      matchingRules: arr(v.duplicateRuleMatchRules).map((m) => `${m.matchRuleSObjectType}.${m.matchingRule}`),
    };
  });
}

function apex() {
  const read = (dir, suffix, kind) => listFiles(dir, suffix).map((f) => {
    const body = fs.readFileSync(f, 'utf8');
    const trig = kind === 'trigger' ? body.match(/trigger\s+\w+\s+on\s+(\w+)\s*\(([^)]*)\)/i) : null;
    return {
      kind, name: baseName(f, suffix),
      object: trig?.[1], events: trig?.[2].split(',').map((s) => s.trim()),
      isTest: /@isTest/i.test(body), lines: body.split('\n').length, body,
    };
  });
  return [...read('triggers', '.trigger', 'trigger'), ...read('classes', '.cls', 'class')];
}

// Object CRUD per profile / permission set; field-level security kept only where access is restricted.
function permissions() {
  const one = (dir, suffix, kind) => listFiles(dir, suffix).map((f) => {
    const v = readXml(f);
    return {
      kind, name: baseName(f, suffix), license: v.userLicense || v.license,
      objects: Object.fromEntries(arr(v.objectPermissions).map((o) => [o.object,
        ['allowRead', 'allowCreate', 'allowEdit', 'allowDelete', 'viewAllRecords', 'modifyAllRecords']
          .filter((k) => bool(o[k])).map((k) => k.replace(/^allow/, '')).join(',')])),
      hiddenOrReadOnlyFields: arr(v.fieldPermissions)
        .filter((p) => !bool(p.editable))
        .map((p) => `${p.field}:${bool(p.readable) ? 'read' : 'none'}`),
      // Full FLS grant, compact: { Object: { edit: [field], read: [field] } }. A field absent from both is
      // not granted by this profile/permission set (custom fields default to no access).
      fieldAccess: arr(v.fieldPermissions).reduce((acc, p) => {
        const [obj, field] = p.field.split('.');
        const level = bool(p.editable) ? 'edit' : bool(p.readable) ? 'read' : null;
        if (level) ((acc[obj] ??= { edit: [], read: [] })[level]).push(field);
        return acc;
      }, {}),
      systemPermissions: arr(v.userPermissions).filter((p) => bool(p.enabled)).map((p) => p.name),
    };
  });
  return [...one('profiles', '.profile-meta.xml', 'profile'), ...one('permissionsets', '.permissionset-meta.xml', 'permissionSet')];
}

// Settings the describe API does not expose: sharing model, auto-number format, restricted picklists,
// lookup delete behaviour, master-detail reparenting. Keyed by object; only fields with a metadata file.
function objectSettings() {
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const out = {};
  const objDir = path.join(SRC, 'objects');
  if (!fs.existsSync(objDir)) return [];
  for (const name of fs.readdirSync(objDir)) {
    const metaFile = path.join(objDir, name, `${name}.object-meta.xml`);
    const o = fs.existsSync(metaFile) ? readXml(metaFile) : {};
    const fields = {};
    for (const f of listFiles(path.join('objects', name, 'fields'), '.field-meta.xml')) {
      const v = readXml(f);
      const vs = v.valueSet;
      fields[v.fullName] = pick({
        type: v.type,
        required: v.required === undefined ? undefined : bool(v.required),
        unique: v.unique === undefined ? undefined : bool(v.unique),
        externalId: v.externalId === undefined ? undefined : bool(v.externalId),
        defaultValue: v.defaultValue,
        trackHistory: v.trackHistory === undefined ? undefined : bool(v.trackHistory),
        picklist: vs ? pick({
          restricted: bool(vs.restricted),
          globalValueSet: vs.valueSetName,
          values: arr(vs.valueSetDefinition?.value).map((x) => pick({ value: x.fullName, label: x.label, isDefault: bool(x.default) || undefined })),
          controllingField: vs.controllingField,
        }) : undefined,
        deleteConstraint: v.deleteConstraint, // Lookup: SetNull | Restrict | Cascade
        reparentable: v.type === 'MasterDetail' ? bool(v.reparentableMasterDetail) : undefined,
        relationshipOrder: v.relationshipOrder,
        writeRequiresMasterRead: v.type === 'MasterDetail' ? bool(v.writeRequiresMasterRead) : undefined,
        treatBlanksAs: v.formulaTreatBlanksAs,
      });
    }
    out[name] = pick({
      sharingModel: o.sharingModel,
      externalSharingModel: o.externalSharingModel,
      nameField: o.nameField ? pick({ type: o.nameField.type, displayFormat: o.nameField.displayFormat, label: o.nameField.label }) : undefined,
      enableHistory: o.enableHistory === undefined ? undefined : bool(o.enableHistory),
      fields,
    });
  }
  return Object.entries(out).map(([object, s]) => ({ object, ...s }));
}

function main() {
  const dir = path.join(OUT, 'logic');
  const result = {
    objectSettings: objectSettings(),
    validationRules: validationRules(),
    formulaFields: formulaFields(),
    flows: flows(),
    workflowRules: workflowRules(),
    assignmentRules: namedRules('assignmentRules', '.assignmentRules-meta.xml', 'assignmentRule'),
    autoResponseRules: namedRules('autoResponseRules', '.autoResponseRules-meta.xml', 'autoResponseRule'),
    escalationRules: namedRules('escalationRules', '.escalationRules-meta.xml', 'escalationRule'),
    duplicateRules: duplicateRules(),
    apex: apex(),
    permissions: permissions(),
  };
  for (const [k, v] of Object.entries(result)) writeJson(path.join(dir, `${k}.json`), v);
  writeSummary(result, dir);
  for (const [k, v] of Object.entries(result)) console.log(`  ${k}: ${v.length}`);
}

function writeSummary(r, dir) {
  const L = ['# Business Rules & Automations', ''];
  L.push('## Validation Rules (record rejected when condition is true)', '');
  for (const v of r.validationRules) L.push(`- **${v.object}.${v.name}**${v.active ? '' : ' (inactive)'}: \`${v.condition}\` → "${v.errorMessage}"`);
  L.push('', '## Formula & Roll-up Fields', '');
  for (const f of r.formulaFields) L.push(`- ${f.object}.${f.field}: ${f.formula ? `\`${String(f.formula).replace(/\s+/g, ' ')}\`` : `${f.rollup.op}(${f.rollup.of ?? ''}) from ${f.rollup.from}`}`);
  L.push('', '## Flows', '');
  for (const f of r.flows) {
    L.push(`### ${f.label} (${f.processType}, ${f.status})`);
    if (f.trigger) L.push(`Trigger: ${f.trigger.object} ${f.trigger.recordTriggerType ?? ''} ${f.trigger.triggerType} ${f.trigger.filterFormula ? `when \`${f.trigger.filterFormula.replace(/\s+/g, ' ')}\`` : f.trigger.entryConditions.join(' AND ')}`);
    for (const d of f.decisions) for (const rule of d.rules) {
      const custom = rule.logic && !['and', 'or'].includes(rule.logic);
      const cond = custom
        ? `${rule.logic} where ${rule.conditions.map((c, i) => `${i + 1}=[${c}]`).join(', ')}`
        : rule.conditions.join(` ${rule.logic ?? 'and'} `);
      L.push(`- Decision ${d.name}/${rule.name}: IF ${cond} THEN ${rule.then}`);
    }
    for (const u of f.recordUpdates) L.push(`- Update ${u.object}: ${u.fields.join('; ')}`);
    for (const c of f.recordCreates) L.push(`- Create ${c.object}${c.assignments.length ? `: ${c.assignments.map((a) => `${a.field} = ${a.value?.ref ?? JSON.stringify(a.value?.literal)}`).join('; ')}` : ''}`);
    for (const a of f.actions) L.push(`- Action ${a.actionType}:${a.actionName}`);
    L.push('');
  }
  L.push('## Workflow / Assignment / Auto-response / Escalation Rules', '');
  for (const w of r.workflowRules) L.push(`- Workflow ${w.object}.${w.name}${w.active ? '' : ' (inactive)'}: ${w.formula || w.criteria.join(' AND ')} → ${w.actions.join(', ')}`);
  for (const [label, list] of [['Assignment', r.assignmentRules], ['Auto-response', r.autoResponseRules], ['Escalation', r.escalationRules]]) {
    for (const a of list) L.push(`- ${label} ${a.object}.${a.name}${a.active ? '' : ' (inactive)'}: ${a.entries.map((e) => `[${e.formula || e.criteria.join(' AND ')}]${e.assignedTo ? ` → ${e.assignedTo}` : ''}`).join(' ; ')}`);
  }
  for (const d of r.duplicateRules) L.push(`- Duplicate ${d.name}${d.active ? '' : ' (inactive)'}: ${d.matchingRules.join(', ')} insert=${d.actionOnInsert}`);
  L.push('', '## Apex', '');
  for (const a of r.apex) L.push(`- ${a.kind} ${a.name}${a.object ? ` on ${a.object} (${a.events.join(', ')})` : ''}${a.isTest ? ' [test]' : ''} — ${a.lines} lines`);
  L.push('', '## Object Permissions by Profile / Permission Set', '');
  for (const p of r.permissions) {
    const objs = Object.entries(p.objects).filter(([, v]) => v);
    if (objs.length) L.push(`- **${p.kind} ${p.name}**: ${objs.map(([o, v]) => `${o}(${v})`).join(', ')}`);
  }
  fs.writeFileSync(path.join(dir, 'business-logic.md'), L.join('\n'));
}

main();
