// Gate for every generator stage: blueprint.json must match blueprint.schema.json and be referentially
// intact (every id it points at exists). Exits non-zero on any failure.
//
//   node src/generators/validate-blueprint.js [path/to/blueprint.json]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { walk } = require('./formula');

const P = require('../paths');
const ROOT = P.ROOT;

// ajv from target/node_modules (CI), else the copy bundled with the global Salesforce CLI (laptop).
function loadAjv() {
  try {
    return require(require.resolve('ajv/dist/2020', { paths: [path.join(ROOT, 'src', 'verification')] })).default;
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, '@salesforce/cli/node_modules/ajv/dist/2020')).default;
  }
}
const Ajv2020 = loadAjv();

const file = process.argv[2] ?? P.BLUEPRINT;
const bp = JSON.parse(fs.readFileSync(file, 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(P.BLUEPRINT_DIR, 'blueprint.schema.json'), 'utf8'));

const errors = [];

const ajv = new Ajv2020({ allErrors: true, strict: false });
if (!ajv.validate(schema, bp)) {
  for (const e of ajv.errors.slice(0, 50)) errors.push(`schema ${e.instancePath || '/'} ${e.message}`);
}

// Referential integrity.
const entities = new Map(bp.entities.map((e) => [e.id, e]));
const fields = new Map(bp.entities.flatMap((e) => e.fields.map((f) => [f.id, f])));
const relations = new Map(bp.relations.map((r) => [r.id, r]));
const derivations = new Map(bp.derivations.map((d) => [d.id, d]));
const need = (cond, msg) => { if (!cond) errors.push(msg); };

const tableNames = new Map();
for (const e of bp.entities) {
  need(!tableNames.has(e.name), `entity name '${e.name}' used by ${tableNames.get(e.name)} and ${e.id}`);
  tableNames.set(e.name, e.id);
  need(fields.has(e.primaryKey), `${e.id}: primaryKey ${e.primaryKey} missing`);
  if (e.sharing?.inheritsFrom) need(relations.get(e.sharing.inheritsFrom)?.kind === 'composition', `${e.id}: inheritsFrom ${e.sharing.inheritsFrom} is not a composition`);
  if (e.historyOf) need(entities.has(e.historyOf), `${e.id}: historyOf ${e.historyOf} missing`);
  const cols = new Set();
  for (const f of e.fields) {
    need(!cols.has(f.name), `${e.id}: column '${f.name}' duplicated`);
    cols.add(f.name);
    need(f.id.startsWith(`${e.id}.`), `${f.id}: not under entity ${e.id}`);
    if (f.relation) need(relations.has(f.relation), `${f.id}: relation ${f.relation} missing`);
    if (f.derivation) need(derivations.has(f.derivation), `${f.id}: derivation ${f.derivation} missing`);
    if (f.type === 'reference') need(!!f.relation, `${f.id}: reference without relation`);
    if (f.picklist?.restricted && f.default !== undefined) need(f.picklist.values.includes(String(f.default)), `${f.id}: default '${f.default}' not in restricted picklist`);
  }
}
for (const r of bp.relations) {
  need(fields.has(r.from.field), `relation ${r.id}: from field missing`);
  if (!r.external) for (const t of r.to) need(entities.has(t), `relation ${r.id}: target ${t} missing`);
  if (r.kind === 'composition') need(r.required, `relation ${r.id}: composition must be required`);
}

const checkExpr = (ast, where) => {
  if (!ast) return;
  walk(ast, (n) => {
    if (n.t !== 'ref') return;
    need(!n.unresolved && fields.has(n.field), `${where}: unresolved ref ${n.path.join('.')}`);
    for (const v of n.via ?? []) need(relations.has(v), `${where}: via ${v} missing`);
  });
};
for (const d of bp.derivations) {
  need(fields.get(d.field)?.derivation === d.id, `derivation ${d.id}: field does not point back`);
  checkExpr(d.expr, `derivation ${d.id}`);
  if (d.rollup) {
    need(relations.get(d.rollup.relation)?.kind === 'composition', `derivation ${d.id}: roll-up relation ${d.rollup.relation} is not a composition`);
    if (d.rollup.of) need(fields.has(d.rollup.of), `derivation ${d.id}: roll-up field ${d.rollup.of} missing`);
  }
}
for (const c of bp.constraints) {
  need(entities.has(c.entity), `constraint ${c.id}: entity missing`);
  if (c.errorField) need(fields.has(c.errorField), `constraint ${c.id}: errorField ${c.errorField} missing`);
  checkExpr(c.rejectWhen, `constraint ${c.id}`);
}
for (const a of bp.automations) {
  if (a.trigger) need(entities.has(a.trigger.entity), `automation ${a.id}: entity ${a.trigger.entity} missing`);
  checkExpr(a.trigger?.condition, `automation ${a.id}`);
  for (const act of a.actions ?? []) for (const v of Object.values(act.set ?? {})) checkExpr(v, `automation ${a.id}`);
}
for (const [id, name] of Object.entries(bp.vocabulary.entities)) need(entities.get(id)?.name === name, `vocabulary ${id} != entity name`);
for (const [id, name] of Object.entries(bp.vocabulary.fields)) need(fields.get(id)?.name === name, `vocabulary ${id} != field name`);

if (errors.length) {
  console.error(`INVALID ${path.relative(ROOT, file)}: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 60)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`valid ${path.relative(ROOT, file)} (blueprint ${bp.blueprintVersion}, ${bp.contentHash.slice(0, 12)}): ` +
  `${bp.entities.length} entities, ${fields.size} fields, ${bp.relations.length} relations, ${bp.derivations.length} derivations, ` +
  `${bp.constraints.length} constraints, ${bp.automations.length} automations`);
