// Phase 2a: fold output/schema + output/logic into one versioned, vendor-neutral blueprint.json.
// Every later stage (DDL, services, loader, parity) reads only the blueprint, never Salesforce output.
// Reads local files only; no org connection.
//
//   node scripts/normalise-blueprint.js            -> blueprint/blueprint.json + blueprint/normalise-report.md
//
// Ids stay in Salesforce API names (stable across runs, and what the strangler facade must speak);
// `name` fields carry the client vocabulary used by generated code.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formula = require('./formula');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output');
const BP = path.join(ROOT, 'blueprint');
const BLUEPRINT_VERSION = '1.0.0';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readLogic = (name) => {
  const f = path.join(OUT, 'logic', `${name}.json`);
  return fs.existsSync(f) ? readJson(f) : [];
};
const warnings = [];
const warn = (where, msg) => warnings.push({ where, msg });

// ---------------------------------------------------------------- vocabulary

const PG_RESERVED = new Set(('all analyse analyze and any array as asc asymmetric both case cast check collate column ' +
  'constraint create current_catalog current_date current_role current_time current_timestamp current_user default ' +
  'deferrable desc distinct do else end except false fetch for foreign from grant group having in initially intersect ' +
  'into lateral leading limit localtime localtimestamp not null offset on only or order placing primary references ' +
  'returning select session_user some symmetric table then to trailing true union unique user using variadic when ' +
  'where window with authorization binary collation concurrently cross freeze full ilike inner is isnull join left ' +
  'like natural notnull outer overlaps right similar tablesample verbose').split(/\s+/));

function snake(apiName) {
  return apiName
    .replace(/__(c|r|History)$/i, (m, s) => (s.toLowerCase() === 'history' ? '_history' : ''))
    .replace(/__/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Postgres truncates identifiers past 63 bytes, which would silently merge long names. Shorten
// deterministically: keep a readable prefix and add a hash of the full source name.
const PG_MAX_IDENT = 63;
function fitIdent(name, source) {
  if (name.length <= PG_MAX_IDENT) return name;
  const h = crypto.createHash('sha1').update(source).digest('hex').slice(0, 8);
  return `${name.slice(0, PG_MAX_IDENT - 9).replace(/_+$/, '')}_${h}`;
}

function entityTerm(api, overrides) {
  if (overrides.entities[api]) return overrides.entities[api];
  const s = snake(api);
  return fitIdent(PG_RESERVED.has(s) ? `${s}_record` : s, api);
}

function fieldTerm(entity, f, overrides) {
  const o = overrides.fields[`${entity}.${f.name}`];
  if (o) return o;
  let s = snake(f.name);
  // Custom lookups (Account__c) read as the related thing; standard ones already end in Id.
  if (f.type === 'reference' && f.custom && !s.endsWith('_id')) s += '_id';
  return fitIdent(PG_RESERVED.has(s) ? `${s}_value` : s, `${entity}.${f.name}`);
}

// ---------------------------------------------------------------- types

const SYSTEM_FIELDS = new Set(['Id', 'IsDeleted', 'CreatedDate', 'CreatedById', 'LastModifiedDate', 'LastModifiedById',
  'SystemModstamp', 'LastActivityDate', 'LastViewedDate', 'LastReferencedDate']);

// describe type -> logical type + Postgres physical type
function mapType(f) {
  const num = (p, s) => (p ? `numeric(${p},${s ?? 0})` : 'numeric');
  switch (f.type) {
    case 'id': return { type: 'id', pg: 'varchar(18)' };
    case 'reference': return { type: 'reference', pg: 'varchar(18)' };
    case 'string': case 'combobox': case 'encryptedstring':
      return { type: 'text', pg: f.length ? `varchar(${f.length})` : 'text', ...(f.type === 'encryptedstring' && { encrypted: true }) };
    case 'textarea': return { type: f.length > 255 ? 'longtext' : 'text', pg: 'text', maxLength: f.length };
    case 'email': return { type: 'email', pg: 'varchar(80)' };
    case 'phone': return { type: 'phone', pg: 'varchar(40)' };
    case 'url': return { type: 'url', pg: 'text' };
    case 'boolean': return { type: 'boolean', pg: 'boolean' };
    case 'int': return { type: 'integer', pg: 'integer' };
    case 'long': return { type: 'integer', pg: 'bigint' };
    case 'double': return { type: 'decimal', pg: num(f.precision, f.scale) };
    case 'currency': return { type: 'currency', pg: num(f.precision, f.scale) };
    case 'percent': return { type: 'percent', pg: num(f.precision, f.scale) };
    case 'date': return { type: 'date', pg: 'date' };
    case 'datetime': return { type: 'datetime', pg: 'timestamptz' };
    case 'time': return { type: 'time', pg: 'time' };
    case 'picklist': return { type: 'picklist', pg: 'text' };
    case 'multipicklist': return { type: 'multipicklist', pg: 'text[]' };
    case 'base64': return { type: 'binary', pg: 'bytea' };
    case 'anyType': return { type: 'any', pg: 'text' };
    case 'address': case 'location': return { type: 'compound', pg: null }; // components are stored as their own fields
    default:
      warn(`type ${f.type}`, 'unmapped describe type, stored as text');
      return { type: 'text', pg: 'text' };
  }
}

const pick = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null &&
  !(Array.isArray(v) && v.length === 0)));

// ---------------------------------------------------------------- entities, fields, relations

function buildEntities(objects, settings, rowCounts, overrides) {
  const entities = [];
  const relations = [];
  const names = new Set(objects.map((o) => o.name));

  for (const o of objects) {
    const s = settings[o.name] ?? {};
    const sf = s.fields ?? {};
    const used = new Map();
    const fields = o.fields.map((f) => {
      const meta = sf[f.name] ?? {};
      const t = mapType(f);
      let name = fieldTerm(o.name, f, overrides);
      if (used.has(name)) {
        warn(`${o.name}.${f.name}`, `vocabulary collision with ${used.get(name)} on '${name}'`);
        name = `${name}_${used.size}`;
      }
      used.set(name, f.name);

      const picklist = f.type === 'picklist' || f.type === 'multipicklist'
        ? meta.picklist
          ? pick({ values: meta.picklist.values.map((v) => v.value), restricted: meta.picklist.restricted,
            globalValueSet: meta.picklist.globalValueSet, controllingField: meta.picklist.controllingField })
          : pick({ values: f.picklistValues ?? [], restricted: false, controllingField: f.controllerName })
        : undefined;
      // describe reports required=false for a required field with a default (e.g. Status__c); metadata is authoritative.
      const required = f.type === 'id' || f.required || meta.required === true || meta.type === 'MasterDetail';
      const autoNumber = f.name === 'Name' && s.nameField?.type === 'AutoNumber'
        ? { format: s.nameField.displayFormat } : undefined;
      let def = meta.defaultValue ?? f.defaultValue;
      if (def === undefined && meta.picklist) def = meta.picklist.values.find((v) => v.isDefault)?.value;

      if (f.type === 'reference') {
        const meta2 = sf[f.name] ?? {};
        const isMD = meta2.type === 'MasterDetail';
        const targets = f.referenceTo ?? [];
        const polymorphic = targets.length > 1;
        // Field-history rows are owned by the tracked record and are deleted with it.
        const historyParent = o.isHistory && f.name === 'ParentId';
        const onDelete = isMD || historyParent ? 'cascade'
          : { SetNull: 'set_null', Restrict: 'restrict', Cascade: 'cascade' }[meta2.deleteConstraint] ?? 'set_null';
        relations.push(pick({
          id: `${o.name}.${f.name}`,
          from: { entity: o.name, field: `${o.name}.${f.name}` },
          to: targets,
          name: f.relationshipName,
          kind: isMD ? 'composition' : polymorphic ? 'polymorphic' : 'association',
          onDelete: polymorphic ? 'none' : onDelete,
          onDeleteSource: isMD ? 'master-detail' : historyParent ? 'field-history' : meta2.deleteConstraint ? 'metadata' : 'assumed',
          reparentable: isMD ? meta2.reparentable === true : undefined,
          required,
          external: targets.some((x) => !names.has(x)) || undefined,
        }));
      }

      return pick({
        id: `${o.name}.${f.name}`,
        source: f.name,
        name,
        label: f.label,
        sourceType: f.type,
        ...t,
        required: required || undefined,
        unique: f.unique || meta.unique || undefined,
        externalId: f.externalId || meta.externalId || undefined,
        system: SYSTEM_FIELDS.has(f.name) || undefined,
        default: def,
        autoNumber,
        picklist,
        relation: f.type === 'reference' ? `${o.name}.${f.name}` : undefined,
        derivation: f.calculated || f.formula || meta.type === 'Summary' ? `${o.name}.${f.name}` : undefined,
        trackHistory: meta.trackHistory || undefined,
        compound: f.compoundFieldName,
      });
    });

    const md = o.fields.find((f) => sf[f.name]?.type === 'MasterDetail' && sf[f.name]?.relationshipOrder === '0')
      ?? o.fields.find((f) => sf[f.name]?.type === 'MasterDetail');
    entities.push(pick({
      id: o.name,
      source: o.name,
      name: entityTerm(o.name, overrides),
      label: o.label,
      kind: o.isHistory ? 'history' : o.custom ? 'custom' : 'standard',
      historyOf: o.isHistory ? o.name.replace(/__History$/, '__c').replace(/(Field)?History$/, '') : undefined,
      keyPrefix: o.keyPrefix,
      primaryKey: `${o.name}.Id`,
      recordTypes: o.recordTypes,
      sharing: pick({
        internal: s.sharingModel,
        external: s.externalSharingModel,
        inheritsFrom: s.sharingModel === 'ControlledByParent' && md ? `${o.name}.${md.name}` : undefined,
      }),
      fieldHistory: s.enableHistory || undefined,
      rowCount: rowCounts[o.name],
      fields,
    }));
  }
  return { entities, relations };
}

// ---------------------------------------------------------------- expression resolution

// Resolve each ref path against the schema: relationship hops become relation ids, the leaf a field id.
function makeResolver(entities, relations) {
  const byEntity = new Map(entities.map((e) => [e.id.toLowerCase(), e]));
  const relById = new Map(relations.map((r) => [r.id, r]));
  return function resolve(entityId, ast, where) {
    let ok = true;
    formula.walk(ast, (n) => {
      if (n.t !== 'ref') return;
      let ent = byEntity.get(entityId.toLowerCase());
      const via = [];
      for (const [i, seg] of n.path.entries()) {
        if (!ent) break;
        const last = i === n.path.length - 1;
        const lc = seg.toLowerCase();
        if (last) {
          const f = ent.fields.find((x) => x.source.toLowerCase() === lc);
          if (f) Object.assign(n, { field: f.id, type: f.type, ...(via.length && { via }) });
          ent = f ? ent : null;
        } else {
          const f = ent.fields.find((x) => x.relation && relById.get(x.relation)?.name?.toLowerCase() === lc);
          const rel = f && relById.get(f.relation);
          if (!rel || rel.to.length !== 1) { ent = null; break; }
          via.push(rel.id);
          ent = byEntity.get(rel.to[0].toLowerCase());
        }
      }
      if (!n.field) {
        ok = false;
        n.unresolved = true;
        warn(where, `cannot resolve ${n.path.join('.')} from ${entityId}`);
      }
    });
    return ok;
  };
}

function compile(entityId, text, resolve, where) {
  try {
    const ast = formula.parse(text);
    const resolved = resolve(entityId, ast, where);
    return { ast, analysis: formula.analyse(ast), resolved };
  } catch (e) {
    warn(where, `parse error: ${e.message}`);
    return { ast: null, analysis: null, resolved: false, error: e.message };
  }
}

// ---------------------------------------------------------------- derivations

function buildDerivations(entities, formulaFields, describeFormulas, resolve) {
  const meta = new Map(formulaFields.map((f) => [`${f.object}.${f.field}`, f]));
  const out = [];
  for (const e of entities) {
    for (const f of e.fields.filter((x) => x.derivation)) {
      const m = meta.get(f.id);
      if (m?.rollup) {
        const [childEntity, fk] = m.rollup.from.split('.');
        out.push(pick({
          id: f.id, entity: e.id, field: f.id, kind: 'rollup',
          rollup: pick({
            op: m.rollup.op, child: childEntity, relation: `${childEntity}.${fk}`,
            of: m.rollup.of, filter: m.rollup.filter,
          }),
          resultType: f.type,
          strategy: 'trigger_maintained', // child write keeps the parent column current; recompute job is the backstop
        }));
        continue;
      }
      const src = m?.formula ?? describeFormulas.get(f.id) ?? null;
      if (!src) {
        // Standard calculated fields (no metadata file, no formula text): value computed by the platform.
        out.push({ id: f.id, entity: e.id, field: f.id, kind: 'platform', resultType: f.type, strategy: 'load_as_data' });
        continue;
      }
      const c = compile(e.id, src, resolve, `derivation ${f.id}`);
      const a = c.analysis;
      const strategy = !c.ast ? 'needs_review'
        : a.usesPrior ? 'needs_review'
          : a.volatile ? 'compute_on_read' // TODAY() is not immutable -> cannot be a STORED generated column
            : a.crossObject ? 'view_join' // reads another row -> join in a view
              : 'generated_column';
      out.push(pick({
        id: f.id, entity: e.id, field: f.id, kind: 'formula', source: src, expr: c.ast,
        resultType: f.type, treatBlanksAs: m?.treatBlanksAs ?? 'BlankAsZero',
        analysis: a, strategy, error: c.error,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- constraints (validation rules)

function buildConstraints(validationRules, resolve) {
  return validationRules.map((v) => {
    const where = `validation ${v.object}.${v.name}`;
    const c = compile(v.object, v.condition, resolve, where);
    const a = c.analysis;
    // CHECK only sees the new row, must be immutable, and cannot read other rows.
    const strategy = !c.ast || !c.resolved ? 'needs_review'
      : a.usesPrior || a.crossObject || a.volatile ? 'write_guard' : 'check';
    return pick({
      id: `${v.object}.${v.name}`, entity: v.object, name: v.name, active: v.active,
      rejectWhen: c.ast, source: v.condition, message: v.errorMessage,
      errorField: v.errorField ? `${v.object}.${v.errorField}` : undefined,
      analysis: a, strategy,
      reason: strategy === 'write_guard'
        ? [a.usesPrior && 'needs the prior row', a.crossObject && 'reads a related row', a.volatile && 'time-dependent'].filter(Boolean).join(', ')
        : undefined,
      error: c.error,
    });
  });
}

// ---------------------------------------------------------------- automations, services, tests

function flowValueExpr(v) {
  if (!v) return { t: 'lit', v: null, type: 'null' };
  if (v.ref) return formula.parse(v.ref.startsWith('$') ? v.ref : `$Record.${v.ref}`); // element refs are $Record.X / $Flow.X
  const type = v.kind === 'numberValue' ? 'number' : v.kind === 'booleanValue' ? 'boolean' : 'text';
  const val = type === 'number' ? Number(v.literal) : type === 'boolean' ? v.literal === 'true' : v.literal;
  return { t: 'lit', v: val, type };
}

const FLOW_EVENTS = { Create: ['insert'], Update: ['update'], CreateAndUpdate: ['insert', 'update'], Delete: ['delete'] };
const FLOW_TIMING = { RecordBeforeSave: 'before', RecordAfterSave: 'after', RecordBeforeDelete: 'before' };

function buildFlowAutomations(flows, resolve) {
  return flows.map((f) => {
    const id = `flow:${f.name}`;
    const base = { id, source: pick({ kind: 'flow', name: f.name, label: f.label, processType: f.processType, status: f.status }), description: f.description };
    if (!f.trigger || f.status !== 'Active') {
      return pick({ ...base, scope: 'out_of_scope', reason: !f.trigger ? `${f.processType} is not record-triggered` : `status ${f.status}` });
    }
    const t = f.trigger;
    let condition = null;
    if (t.filterFormula) condition = compile(t.object, t.filterFormula, resolve, `${id} entry`).ast;
    else if (t.entryConditions.length) warn(id, 'filter-list entry conditions not yet compiled; kept as text');
    const actions = [
      ...f.recordCreates.map((c) => ({ kind: 'create', entity: c.object, set: Object.fromEntries(c.assignments.map((a) => [a.field, flowValueExpr(a.value)])) })),
      ...f.recordUpdates.map((u) => ({ kind: 'update', entity: u.object, set: Object.fromEntries((u.assignments ?? []).map((a) => [a.field, flowValueExpr(a.value)])) })),
      ...f.recordDeletes.map((d) => ({ kind: 'delete', entity: d.object })),
      ...f.actions.map((a) => ({ kind: 'action', actionType: a.actionType, action: a.actionName })),
    ];
    // Values assigned on created records reference the triggering record; resolve against it.
    for (const a of actions) for (const v of Object.values(a.set ?? {})) resolve(t.object, v, `${id} ${a.kind} ${a.entity}`);
    const simple = f.decisions.length === 0 && f.recordLookups.length === 0 && f.subflows.length === 0 && f.actions.length === 0;
    return pick({
      ...base,
      trigger: pick({
        entity: t.object, on: FLOW_EVENTS[t.recordTriggerType] ?? [], timing: FLOW_TIMING[t.triggerType],
        condition, conditionText: t.filterFormula ?? (t.entryConditions.join(' AND ') || undefined),
        onlyWhenConditionBecomesTrue: t.doesRequireRecordChangedToMeetCriteria || undefined,
      }),
      actions,
      // After-save flows run inside the saving transaction, so a failure rolls the save back.
      strategy: FLOW_TIMING[t.triggerType] === 'before' ? 'before_trigger' : 'in_transaction_hook',
      translation: simple ? 'structured' : 'agent',
    });
  });
}

function apexFacts(body) {
  const strip = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const soql = [...strip.matchAll(/\[\s*SELECT[\s\S]*?\bFROM\s+(\w+)/gi)].map((m) => m[1]);
  const dml = [...strip.matchAll(/\b(insert|update|upsert|delete)\s+(\w+)\s*;/gi)].map((m) => m[1].toLowerCase());
  const created = [...strip.matchAll(/\bnew\s+(\w+)\s*\(/g)].map((m) => m[1]).filter((x) => /__c$|^[A-Z]\w+$/.test(x));
  return {
    reads: [...new Set(soql)],
    dml: [...new Set(dml)],
    constructs: [...new Set(created)],
    constants: Object.fromEntries([...strip.matchAll(/static\s+final\s+\w+\s+(\w+)\s*=\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])),
    methods: [...strip.matchAll(/(?:public|global|private|protected)\s+(?:static\s+)?[\w<>,\s.]+?\s+(\w+)\s*\([^)]*\)\s*\{/g)]
      .map((m) => m[1]).filter((m) => !['if', 'for', 'while', 'catch'].includes(m)),
    calls: [...new Set([...strip.matchAll(/\b([A-Z]\w+)\.(\w+)\s*\(/g)].map((m) => `${m[1]}.${m[2]}`))]
      .filter((c) => !/^(Trigger|Database|System|Date|Datetime|Math|String|Test|Schema|JSON|Integer|Decimal|Limits)\./.test(c)),
  };
}

function buildApex(apex, entityIds) {
  const automations = [];
  const services = [];
  const tests = [];
  const sobjects = (list) => list.filter((x) => entityIds.has(x));
  for (const a of apex) {
    const facts = apexFacts(a.body);
    const ref = { kind: a.kind === 'trigger' ? 'apexTrigger' : 'apexClass', name: a.name, lines: a.lines };
    if (a.kind === 'trigger') {
      const events = a.events.map((ev) => {
        const [timing, op] = ev.split(/\s+/);
        return { timing, on: op };
      });
      automations.push({
        id: `apex-trigger:${a.name}`, source: ref,
        trigger: { entity: a.object, events },
        handlers: facts.calls,
        strategy: 'trigger_dispatch', // before events -> BEFORE trigger/service hook; after events -> after-write hook
        translation: 'agent',
      });
    } else if (a.isTest) {
      tests.push({ id: `apex-test:${a.name}`, source: ref, methods: facts.methods, entities: sobjects([...facts.reads, ...facts.constructs]) });
    } else if (/implements\s+[^{]*Database\.Batchable/i.test(a.body)) {
      automations.push(pick({
        id: `apex-job:${a.name}`, source: ref,
        schedule: { kind: 'cron', expression: null, note: 'schedule lives in CronTrigger, not in metadata; confirm with the org' },
        schedulable: /Schedulable/.test(a.body) || undefined,
        reads: sobjects(facts.reads), writes: sobjects(facts.constructs), constants: facts.constants,
        strategy: 'cron_worker', // batch size was shaped by governor limits; re-bound deliberately in the target
        translation: 'agent',
      }));
    } else {
      services.push(pick({
        id: `apex-class:${a.name}`, source: ref, methods: facts.methods, constants: facts.constants,
        reads: sobjects(facts.reads), writes: sobjects(facts.constructs), dml: facts.dml, translation: 'agent',
      }));
    }
  }
  // Who calls each service method.
  for (const s of services) {
    s.calledBy = automations.filter((x) => (x.handlers ?? []).some((h) => h.startsWith(`${s.source.name}.`))).map((x) => x.id);
  }
  return { automations, services, tests };
}

function buildRuleAutomations(logic) {
  const out = [];
  for (const [kind, list] of [['assignmentRule', logic.assignmentRules], ['escalationRule', logic.escalationRules], ['autoResponseRule', logic.autoResponseRules]]) {
    for (const r of list) {
      out.push(pick({
        id: `${kind}:${r.object}.${r.name}`, source: { kind, name: r.name },
        trigger: { entity: r.object, on: ['insert'], timing: 'after' },
        active: r.active,
        entries: r.entries, // ordered, first match wins; criteria kept as extracted text
        strategy: 'service_hook', translation: 'structured',
      }));
    }
  }
  for (const d of logic.duplicateRules) {
    const [entity] = d.name.split('.');
    out.push(pick({
      id: `duplicateRule:${d.name}`, source: { kind: 'duplicateRule', name: d.name },
      trigger: { entity, on: ['insert', 'update'], timing: 'before' }, active: d.active,
      matchingRules: d.matchingRules, onInsert: d.actionOnInsert, onUpdate: d.actionOnUpdate,
      strategy: 'service_hook', translation: 'structured',
    }));
  }
  return out;
}

// ---------------------------------------------------------------- security

const CRUD = { Read: 'read', Create: 'create', Edit: 'edit', Delete: 'delete', viewAllRecords: 'viewAll', modifyAllRecords: 'modifyAll' };

function buildSecurity(permissions, entityIds) {
  return permissions.map((p) => pick({
    id: `${p.kind}:${p.name}`,
    kind: p.kind,
    name: decodeURIComponent(p.name),
    license: p.license,
    objects: Object.fromEntries(Object.entries(p.objects)
      .filter(([o, v]) => v && entityIds.has(o))
      .map(([o, v]) => [o, v.split(',').map((x) => CRUD[x] ?? x)])),
    fields: Object.fromEntries(Object.entries(p.fieldAccess ?? {}).filter(([o]) => entityIds.has(o))),
    systemPermissions: p.systemPermissions,
  }));
}

// ---------------------------------------------------------------- main

function stableHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function main() {
  const objDir = path.join(OUT, 'schema', 'objects');
  const objects = fs.readdirSync(objDir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => readJson(path.join(objDir, f)));
  const logic = Object.fromEntries(['objectSettings', 'validationRules', 'formulaFields', 'flows', 'assignmentRules',
    'escalationRules', 'autoResponseRules', 'duplicateRules', 'apex', 'permissions'].map((k) => [k, readLogic(k)]));
  if (!logic.objectSettings.length) throw new Error('output/logic/objectSettings.json missing: re-run node scripts/extract-logic.js');
  const settings = Object.fromEntries(logic.objectSettings.map((s) => [s.object, s]));
  const reportFile = path.join(OUT, 'data', '_export-report.json');
  const rowCounts = fs.existsSync(reportFile)
    ? Object.fromEntries(readJson(reportFile).filter((r) => r.records !== undefined).map((r) => [r.object, r.records])) : {};
  const overridesFile = path.join(BP, 'vocabulary.overrides.json');
  const overrides = { entities: {}, fields: {}, ...(fs.existsSync(overridesFile) ? readJson(overridesFile) : {}) };

  const { entities, relations } = buildEntities(objects, settings, rowCounts, overrides);
  const entityIds = new Set(entities.map((e) => e.id));
  const resolve = makeResolver(entities, relations);

  const describeFormulas = new Map(objects.flatMap((o) => o.fields.filter((f) => f.formula).map((f) => [`${o.name}.${f.name}`, f.formula])));
  const derivations = buildDerivations(entities, logic.formulaFields, describeFormulas, resolve);
  const constraints = buildConstraints(logic.validationRules, resolve);
  const apex = buildApex(logic.apex, entityIds);
  const automations = [...buildFlowAutomations(logic.flows, resolve), ...apex.automations, ...buildRuleAutomations(logic)];
  const security = buildSecurity(logic.permissions, entityIds);

  const vocabulary = {
    entities: Object.fromEntries(entities.map((e) => [e.id, e.name])),
    fields: Object.fromEntries(entities.flatMap((e) => e.fields.map((f) => [f.id, f.name]))),
  };

  const content = {
    entities, relations, derivations, constraints, automations,
    services: apex.services, tests: apex.tests, security, vocabulary,
  };
  const blueprint = {
    $schema: './blueprint.schema.json',
    blueprintVersion: BLUEPRINT_VERSION,
    contentHash: stableHash(content),
    source: {
      platform: 'salesforce',
      apiVersion: readJson(path.join(ROOT, 'sfdx-project.json')).sourceApiVersion,
      inputs: ['output/schema/objects', 'output/logic', 'output/data/_export-report.json', 'blueprint/vocabulary.overrides.json'],
    },
    warnings,
    ...content,
  };
  fs.mkdirSync(BP, { recursive: true });
  fs.writeFileSync(path.join(BP, 'blueprint.json'), JSON.stringify(blueprint, null, 2));
  fs.writeFileSync(path.join(BP, 'normalise-report.md'), report(blueprint));

  const count = (list, key) => Object.entries(list.reduce((a, x) => ({ ...a, [x[key] ?? '-']: (a[x[key] ?? '-'] ?? 0) + 1 }), {}))
    .map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`blueprint ${BLUEPRINT_VERSION} ${blueprint.contentHash.slice(0, 12)}`);
  console.log(`  entities: ${entities.length}  fields: ${entities.reduce((a, e) => a + e.fields.length, 0)}  relations: ${relations.length}`);
  console.log(`  derivations: ${count(derivations, 'strategy')}`);
  console.log(`  constraints: ${count(constraints, 'strategy')}`);
  console.log(`  automations: ${count(automations, 'strategy')}`);
  console.log(`  services: ${apex.services.length}  tests: ${apex.tests.length}  security grants: ${security.length}`);
  console.log(`  warnings: ${warnings.length}`);
}

// Human-readable digest of what the generator will have to do, per strategy.
function report(b) {
  const L = [`# Blueprint ${b.blueprintVersion} (${b.contentHash.slice(0, 12)})`, '',
    'Generated by `scripts/normalise-blueprint.js`. Do not edit; edit the inputs or `vocabulary.overrides.json`.', ''];
  const custom = b.entities.filter((e) => e.kind === 'custom');
  L.push('## Shape', '',
    `- ${b.entities.length} entities (${custom.length} custom, ${b.entities.filter((e) => e.kind === 'history').length} history), ` +
    `${b.entities.reduce((a, e) => a + e.fields.length, 0)} fields, ${b.relations.length} relations ` +
    `(${b.relations.filter((r) => r.kind === 'composition').length} composition, ${b.relations.filter((r) => r.kind === 'polymorphic').length} polymorphic)`,
    `- ${b.security.length} security grants (profiles + permission sets)`, '');
  L.push('## Derivations', '', '| Field | Kind | Strategy | Why |', '|---|---|---|---|');
  for (const d of b.derivations.filter((x) => x.kind !== 'platform')) {
    const why = d.kind === 'rollup' ? `${d.rollup.op}(${d.rollup.of ?? '*'}) over ${d.rollup.relation}`
      : [d.analysis?.volatile && 'time-dependent', d.analysis?.crossObject && 'cross-object', `\`${d.source}\``].filter(Boolean).join('; ');
    L.push(`| ${d.id} | ${d.kind} | ${d.strategy} | ${why} |`);
  }
  L.push('', `Platform-calculated standard fields loaded as data: ${b.derivations.filter((x) => x.kind === 'platform').length}`, '');
  L.push('## Constraints (validation rules)', '', '| Rule | Strategy | Why |', '|---|---|---|');
  for (const c of b.constraints) L.push(`| ${c.id} | ${c.strategy} | ${c.reason ?? 'row-local, immutable'} |`);
  L.push('', '## Automations', '', '| Automation | Trigger | Strategy | Translation |', '|---|---|---|---|');
  for (const a of b.automations) {
    const trig = a.trigger
      ? [a.trigger.entity, a.trigger.timing, (a.trigger.on ?? a.trigger.events?.map((e) => `${e.timing} ${e.on}`) ?? []).join('/')].filter(Boolean).join(' ')
      : a.schedule ? 'schedule' : '-';
    L.push(`| ${a.id} | ${trig} | ${a.strategy ?? a.scope} | ${a.translation ?? a.reason ?? ''} |`);
  }
  L.push('', '## Services and tests', '');
  for (const s of b.services) L.push(`- ${s.id}: methods ${s.methods.join(', ')}; reads ${s.reads.join(', ') || '-'}; writes ${s.writes.join(', ') || '-'}; called by ${s.calledBy.join(', ') || '-'}`);
  for (const t of b.tests) L.push(`- ${t.id}: ${t.methods.length} methods over ${t.entities.join(', ')}`);
  L.push('', `## Warnings (${b.warnings.length})`, '');
  const grouped = b.warnings.reduce((a, w) => ({ ...a, [w.msg.replace(/ from \w+$/, '')]: [...(a[w.msg.replace(/ from \w+$/, '')] ?? []), w.where] }), {});
  for (const [msg, where] of Object.entries(grouped)) L.push(`- ${msg} (${where.length}): ${where.slice(0, 5).join('; ')}${where.length > 5 ? '; …' : ''}`);
  return L.join('\n') + '\n';
}

main();
