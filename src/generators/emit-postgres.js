// Phase 2b (first slice): blueprint -> Postgres DDL for one object family.
//
//   node src/generators/emit-postgres.js [Entity,Entity,...]     default: Subscription__c,Subscription_Line__c
//   node src/generators/emit-postgres.js --parts tables,views   only the listed parts (used by the individual agents)
//
// Parts and the agent that owns them: runtime, tables, views, rollups (Schema agent); guards, translations
// (Logic agent); security (Security agent). Without --parts every part is emitted.
//
// Writes adlc/3-build/{schema,logic,security}/sql/NNN_*.sql (each part in its owning agent's folder)
// plus adlc/3-build/manifest.json (apply order; pins the blueprint contentHash).
// Reads only blueprint/blueprint.json and blueprint/translations/ (agent-translated Apex, reviewed as code).
// Entities the family references but does not own are emitted as reference tables (id + the columns the
// family reads), so foreign keys and cross-object formulas work without pulling in their whole schema.
const fs = require('fs');
const path = require('path');
const { compileSql, quote } = require('./sql-expr');

const P = require('../paths');
const ROOT = P.ROOT;
const BP_DIR = P.BLUEPRINT_DIR;
const S = 'app';

const bp = JSON.parse(fs.readFileSync(path.join(BP_DIR, 'blueprint.json'), 'utf8'));
const argv = process.argv.slice(2);
const partsIdx = argv.indexOf('--parts');
const PARTS = partsIdx >= 0 ? new Set(argv[partsIdx + 1].split(',')) : null;
const family = (argv.find((a, i) => !a.startsWith('--') && i !== partsIdx + 1) ?? 'Subscription__c,Subscription_Line__c').split(',');

const entities = new Map(bp.entities.map((e) => [e.id, e]));
const fields = new Map(bp.entities.flatMap((e) => e.fields.map((f) => [f.id, f])));
const relations = new Map(bp.relations.map((r) => [r.id, r]));
const derivations = new Map(bp.derivations.map((d) => [d.id, d]));
for (const id of family) if (!entities.has(id)) throw new Error(`unknown entity ${id}`);

const T = (entityId) => `${S}.${entities.get(entityId).name}`;
const col = (fieldId) => fields.get(fieldId).name;
const ident = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 63);
const AUDIT_USER_FIELDS = new Set(['CreatedById', 'LastModifiedById']);

// ---------------------------------------------------------------- which entities, which columns

const familyEntities = family.map((id) => entities.get(id));
const familyIds = new Set(family);
const exprs = [
  ...bp.derivations.filter((d) => familyIds.has(d.entity) && d.expr).map((d) => d.expr),
  ...bp.constraints.filter((c) => familyIds.has(c.entity) && c.rejectWhen).map((c) => c.rejectWhen),
];
const refFields = new Set();
const walk = (n, fn) => { fn(n); for (const c of n.args ?? (n.arg ? [n.arg] : [])) walk(c, fn); };
for (const e of exprs) walk(e, (n) => { if (n.t === 'ref' && n.field) refFields.add(n.field); });

// Reference tables: every non-audit relation target outside the family.
const refTables = new Map();
for (const e of familyEntities) {
  for (const f of e.fields.filter((x) => x.relation && !AUDIT_USER_FIELDS.has(x.source))) {
    const r = relations.get(f.relation);
    if (r.kind === 'polymorphic') continue;
    const target = r.to[0];
    if (!familyIds.has(target) && entities.has(target)) refTables.set(target, new Set());
  }
}
for (const fid of refFields) {
  const owner = fid.split('.')[0];
  if (refTables.has(owner)) refTables.get(owner).add(fid);
}
for (const [id, cols] of refTables) {
  const e = entities.get(id);
  const name = e.fields.find((f) => f.source === 'Name');
  if (name) cols.add(name.id);
  cols.delete(e.primaryKey);
}

const derivOf = (f) => (f.derivation ? derivations.get(f.derivation) : null);
const stored = (f) => f.pg && !['compute_on_read', 'view_join'].includes(derivOf(f)?.strategy);

// ---------------------------------------------------------------- SQL pieces

const exprCtx = (row, extra = {}) => ({
  row,
  column: col,
  lookup: (relId) => ({ table: T(relations.get(relId).to[0]) }),
  today: `${S}.today()`,
  ...extra,
});

function columnSql(e, f) {
  const d = derivOf(f);
  const parts = [`${f.name} ${f.pg}`];
  if (d?.strategy === 'generated_column') {
    const expr = compileSql(d.expr, exprCtx('', { blanksAsZero: d.treatBlanksAs === 'BlankAsZero' }));
    parts.push(`GENERATED ALWAYS AS (${expr}) STORED`);
    return parts.join(' ');
  }
  if (f.id === e.primaryKey) return `${f.name} varchar(18) PRIMARY KEY DEFAULT ${S}.new_sfid(${quote(e.keyPrefix)})`;
  if (d?.strategy === 'trigger_maintained') return `${f.name} ${f.pg} NOT NULL DEFAULT 0`;
  if (f.autoNumber) return `${f.name} ${f.pg} NOT NULL DEFAULT ${S}.next_autonumber(${quote(e.id)}, ${quote(f.autoNumber.format)})`;
  if (f.source === 'IsDeleted') return `${f.name} boolean NOT NULL DEFAULT false`;
  if (['CreatedDate', 'LastModifiedDate', 'SystemModstamp'].includes(f.source)) return `${f.name} timestamptz NOT NULL DEFAULT now()`;
  // Salesforce checkboxes are never null.
  if (f.type === 'boolean') return `${f.name} boolean NOT NULL DEFAULT ${String(f.default ?? false)}`;
  if (f.required && !f.system) parts.push('NOT NULL');
  if (f.default !== undefined) parts.push(`DEFAULT ${quote(f.default)}`);
  if (f.unique) parts.push('UNIQUE');
  if (f.relation && !AUDIT_USER_FIELDS.has(f.source)) {
    const r = relations.get(f.relation);
    const target = r.to[0];
    if (r.kind !== 'polymorphic' && (familyIds.has(target) || refTables.has(target))) {
      const onDelete = { cascade: 'CASCADE', set_null: 'SET NULL', restrict: 'RESTRICT' }[r.onDelete];
      parts.push(`REFERENCES ${T(target)}(id)${onDelete ? ` ON DELETE ${onDelete}` : ''}`);
    }
  }
  if (f.picklist?.restricted && f.picklist.values.length) {
    parts.push(`CONSTRAINT ${ident(`${f.name}_picklist`)} CHECK (${f.name} IN (${f.picklist.values.map(quote).join(', ')}))`);
  }
  return parts.join(' ');
}

const header = (title) => `-- ${title}\n-- GENERATED by src/generators/emit-postgres.js from blueprint ${bp.blueprintVersion} ${bp.contentHash.slice(0, 12)}. Do not edit.\n\n`;

function runtimeSql() {
  return header('Runtime support: schema, ids, auto-numbers, clock, load mode') + `CREATE SCHEMA IF NOT EXISTS ${S};

-- Salesforce-compatible 18-character ids for rows created in the target (3-char key prefix + 12 random
-- base62 + 3-char case-safe checksum), so the strangler facade can hand them to Salesforce-shaped clients.
CREATE FUNCTION ${S}.new_sfid(prefix text) RETURNS varchar(18) LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
  base text := prefix || '000';
  sfx text := '';
  bits int;
BEGIN
  FOR i IN 1..9 LOOP base := base || substr(chars, 1 + floor(random() * 62)::int, 1); END LOOP;
  FOR chunk IN 0..2 LOOP
    bits := 0;
    FOR j IN 0..4 LOOP
      IF substr(base, chunk * 5 + j + 1, 1) ~ '[A-Z]' THEN bits := bits | (1 << j); END IF;
    END LOOP;
    sfx := sfx || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', bits + 1, 1);
  END LOOP;
  RETURN base || sfx;
END $$;

-- Auto-number fields (Name = SUB-{0000}): one counter per entity, resynced after a data load.
-- Numbering is a platform operation, independent of the caller's access: runs as the owner.
CREATE TABLE ${S}.autonumber (entity text PRIMARY KEY, last_value bigint NOT NULL DEFAULT 0);
CREATE FUNCTION ${S}.next_autonumber(p_entity text, p_format text) RETURNS text LANGUAGE plpgsql VOLATILE
  SECURITY DEFINER SET search_path = ${S}, pg_temp AS $$
DECLARE n bigint; width int; prefix text;
BEGIN
  INSERT INTO ${S}.autonumber AS a (entity, last_value) VALUES (p_entity, 1)
    ON CONFLICT (entity) DO UPDATE SET last_value = a.last_value + 1 RETURNING last_value INTO n;
  prefix := split_part(p_format, '{', 1);
  width := length(substring(p_format from '\\{(0+)\\}'));
  RETURN prefix || lpad(n::text, greatest(width, length(n::text)), '0');
END $$;

-- TODAY() for formulas. A session can pin the clock (SET app.as_of_date = '2026-09-18') to reproduce
-- values Salesforce computed on a given day; unset, it is the real date.
CREATE FUNCTION ${S}.today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.as_of_date', true), '')::date, current_date)
$$;

-- Bulk load mode: historical rows are loaded as they are in Salesforce. Write-time rules (guards,
-- Apex-translated defaults, roll-up maintenance) skip; roll-ups are recomputed once the load ends.
CREATE FUNCTION ${S}.is_loading() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.loading', true), '') = 'on'
$$;

-- Validation-rule messages, keyed by constraint name, for the API layer to return Salesforce's text.
CREATE TABLE ${S}.rule_message (
  constraint_name text PRIMARY KEY,
  rule_id text NOT NULL,
  message text NOT NULL,
  error_field text
);
`;
}

function tablesSql() {
  let sql = header(`Tables: ${family.join(', ')} (+ reference tables ${[...refTables.keys()].join(', ')})`);
  for (const [id, cols] of refTables) {
    const e = entities.get(id);
    const defs = [`id varchar(18) PRIMARY KEY`, ...[...cols].map((fid) => `${col(fid)} ${fields.get(fid).pg}`)];
    sql += `-- Reference table: ${id} is owned by another family; only the columns this family reads.\n`;
    sql += `CREATE TABLE ${T(id)} (\n  ${defs.join(',\n  ')}\n);\n\n`;
  }
  // Parents before children so REFERENCES resolve.
  const ordered = [...familyEntities].sort((a, b) => depth(a) - depth(b));
  for (const e of ordered) {
    const cols = e.fields.filter(stored).map((f) => columnSql(e, f));
    const checks = bp.constraints.filter((c) => c.entity === e.id && c.active && c.strategy === 'check').map((c) =>
      `CONSTRAINT ${ident(c.name)} CHECK (NOT COALESCE(${compileSql(c.rejectWhen, exprCtx(''))}, false))`);
    sql += `-- ${e.id} (${e.label}); sharing ${e.sharing?.internal ?? 'n/a'}\n`;
    sql += `CREATE TABLE ${T(e.id)} (\n  ${[...cols, ...checks].join(',\n  ')}\n);\n`;
    for (const f of e.fields.filter((x) => x.relation && stored(x) && !AUDIT_USER_FIELDS.has(x.source))) {
      sql += `CREATE INDEX ON ${T(e.id)} (${f.name});\n`;
    }
    for (const c of bp.constraints.filter((x) => x.entity === e.id && x.active)) {
      const name = c.strategy === 'check' ? ident(c.name) : ident(`guard_${c.name}`);
      sql += `INSERT INTO ${S}.rule_message VALUES (${quote(name)}, ${quote(c.id)}, ${quote(c.message)}, ${c.errorField ? quote(col(c.errorField)) : 'NULL'});\n`;
    }
    sql += '\n';
  }
  return sql;
}

function depth(e, seen = new Set()) {
  if (seen.has(e.id)) return 0;
  seen.add(e.id);
  const parents = e.fields.filter((f) => f.relation && relations.get(f.relation).kind === 'composition')
    .map((f) => relations.get(f.relation).to[0]).filter((t) => familyIds.has(t));
  return parents.length ? 1 + Math.max(...parents.map((p) => depth(entities.get(p), seen))) : 0;
}

function viewsSql() {
  let sql = header('Read views: stored columns plus time-dependent and cross-object formulas');
  for (const e of familyEntities) {
    const computed = e.fields.filter((f) => f.pg && !stored(f)).map((f) => {
      const d = derivOf(f);
      return `  ${compileSql(d.expr, exprCtx('t', { blanksAsZero: d.treatBlanksAs === 'BlankAsZero' }))}::${f.pg} AS ${f.name}`;
    });
    sql += `CREATE VIEW ${T(e.id)}_v WITH (security_invoker = true) AS\nSELECT t.*${computed.length ? `,\n${computed.join(',\n')}` : ''}\nFROM ${T(e.id)} t;\n\n`;
  }
  return sql;
}

function rollupsSql() {
  let sql = header('Roll-up summaries: maintained on child writes, with a full recompute as backstop');
  const rollups = bp.derivations.filter((d) => d.kind === 'rollup' && familyIds.has(d.entity));
  const byPair = new Map();
  for (const d of rollups) {
    const key = `${d.entity}|${d.rollup.relation}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(d);
  }
  for (const [key, list] of byPair) {
    const [parentId, relId] = key.split('|');
    const childId = relations.get(relId).from.entity;
    const fk = col(relId);
    const fn = `${S}.recompute_${entities.get(parentId).name}_from_${entities.get(childId).name}`;
    const aggs = list.map((d) => {
      if (d.rollup.filter?.length) throw new Error(`${d.id}: roll-up filters not yet supported`);
      const agg = d.rollup.op === 'count' ? 'count(*)' : `COALESCE(${d.rollup.op}(c.${col(d.rollup.of)}), 0)`;
      return { target: col(d.field), agg };
    });
    const set = aggs.map((a) => `${a.target} = s.${a.target}`).join(', ');
    const cmp = `(${aggs.map((a) => `p.${a.target}`).join(', ')}) IS DISTINCT FROM (${aggs.map((a) => `s.${a.target}`).join(', ')})`;
    sql += `-- ${list.map((d) => d.id).join(', ')}
CREATE FUNCTION ${fn}(p_ids varchar[]) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = ${S}, pg_temp AS $$
  WITH s AS (
    SELECT p.id, ${aggs.map((a) => `(SELECT ${a.agg} FROM ${T(childId)} c WHERE c.${fk} = p.id) AS ${a.target}`).join(', ')}
    FROM ${T(parentId)} p WHERE p_ids IS NULL OR p.id = ANY (p_ids)
  ), u AS (
    UPDATE ${T(parentId)} p SET ${set} FROM s WHERE p.id = s.id AND ${cmp} RETURNING 1
  )
  SELECT count(*)::int FROM u
$$;

CREATE FUNCTION ${fn}_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${S}, pg_temp AS $$
BEGIN
  IF ${S}.is_loading() THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM ${fn}(ARRAY[OLD.${fk}]);
  ELSIF TG_OP = 'UPDATE' AND OLD.${fk} IS DISTINCT FROM NEW.${fk} THEN
    PERFORM ${fn}(ARRAY[OLD.${fk}, NEW.${fk}]);
  ELSE
    PERFORM ${fn}(ARRAY[NEW.${fk}]);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER z90_rollup_${ident(entities.get(parentId).name)} AFTER INSERT OR UPDATE OR DELETE ON ${T(childId)}
  FOR EACH ROW EXECUTE FUNCTION ${fn}_trg();

`;
  }
  sql += `-- Backstop: recompute every roll-up in this family (run after a bulk load, or nightly).
CREATE FUNCTION ${S}.recompute_all_rollups() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${S}, pg_temp AS $$
DECLARE n integer := 0;
BEGIN
${[...byPair.keys()].map((k) => {
    const [p, r] = k.split('|');
    return `  n := n + ${S}.recompute_${entities.get(p).name}_from_${entities.get(relations.get(r).from.entity).name}(NULL);`;
  }).join('\n')}
  RETURN n;
END $$;
`;
  return sql;
}

function guardsSql() {
  let sql = header('Write guards: validation rules a CHECK cannot express (prior row, related rows)');
  for (const c of bp.constraints.filter((x) => familyIds.has(x.entity) && x.active && x.strategy === 'write_guard')) {
    const e = entities.get(c.entity);
    const name = ident(`guard_${c.name}`);
    const onInsert = compileSql(c.rejectWhen, exprCtx('NEW', { insert: true }));
    const onUpdate = compileSql(c.rejectWhen, exprCtx('NEW', { prior: 'OLD' }));
    const raise = `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = ${quote(c.message)}, CONSTRAINT = ${quote(name)}, HINT = ${quote(c.id)};`;
    sql += `-- ${c.id} (${c.reason}): ${c.source}
CREATE FUNCTION ${S}.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${S}, pg_temp AS $$
BEGIN
  IF ${S}.is_loading() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(${onInsert}, false) THEN ${raise} END IF;
  ELSIF COALESCE(${onUpdate}, false) THEN ${raise}
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER v50_${name} BEFORE INSERT OR UPDATE ON ${T(e.id)} FOR EACH ROW EXECUTE FUNCTION ${S}.${name}();

`;
  }
  // Audit stamps run last among BEFORE triggers (Salesforce stamps after before-triggers too).
  for (const e of familyEntities) {
    const lm = e.fields.find((f) => f.source === 'LastModifiedDate');
    const sm = e.fields.find((f) => f.source === 'SystemModstamp');
    if (!lm && !sm) continue;
    sql += `CREATE FUNCTION ${S}.stamp_${e.name}() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ${S}.is_loading() THEN RETURN NEW; END IF;
  ${[lm, sm].filter(Boolean).map((f) => `NEW.${f.name} := now();`).join(' ')}
  RETURN NEW;
END $$;
CREATE TRIGGER z10_stamp BEFORE UPDATE ON ${T(e.id)} FOR EACH ROW EXECUTE FUNCTION ${S}.stamp_${e.name}();

`;
  }
  return sql;
}

// ---------------------------------------------------------------- security

const ROLE = (g) => ident(`sf_${g.kind === 'profile' ? 'profile' : 'permset'}_${g.name.replace(/[^A-Za-z0-9]+/g, '_')}`);
const PRIV = { read: 'SELECT', create: 'INSERT', edit: 'UPDATE', delete: 'DELETE' };

function securitySql() {
  let sql = header('Security: object CRUD + field-level security as grants, record sharing as row-level security');
  // Record access, walked up ControlledByParent chains to the entity whose sharing model decides.
  const access = new Map();
  const accessFn = (id) => {
    if (access.has(id)) return access.get(id);
    const e = entities.get(id);
    const model = e.sharing?.internal;
    const fn = `${S}.can_access_${e.name}`;
    access.set(id, fn);
    let body;
    if (model === 'ControlledByParent') {
      const rel = relations.get(e.sharing.inheritsFrom);
      const parentFn = accessFn(rel.to[0]);
      body = `SELECT ${parentFn}((SELECT x.${col(rel.id)} FROM ${T(id)} x WHERE x.id = p_id), p_level)`;
      sql += `-- ${id}: ControlledByParent via ${rel.id}\n`;
    } else if (model === 'ReadWrite' || model === 'ReadWriteTransfer') {
      body = 'SELECT p_id IS NOT NULL';
      sql += `-- ${id}: organisation-wide default ${model}; any user with object access may read and edit every record\n`;
    } else {
      throw new Error(`${id}: sharing model ${model} not yet translated (needs owner, role hierarchy and sharing rules)`);
    }
    sql += `CREATE FUNCTION ${fn}(p_id varchar, p_level text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ${S}, pg_temp AS $$ ${body} $$;\n\n`;
    return fn;
  };

  for (const e of familyEntities) {
    if (e.sharing?.internal !== 'ControlledByParent') continue;
    const rel = relations.get(e.sharing.inheritsFrom);
    const parentFn = accessFn(rel.to[0]);
    const fk = col(rel.id);
    sql += `ALTER TABLE ${T(e.id)} ENABLE ROW LEVEL SECURITY;
CREATE POLICY sharing_read ON ${T(e.id)} FOR SELECT USING (${parentFn}(${fk}, 'read'));
CREATE POLICY sharing_insert ON ${T(e.id)} FOR INSERT WITH CHECK (${parentFn}(${fk}, 'edit'));
CREATE POLICY sharing_update ON ${T(e.id)} FOR UPDATE USING (${parentFn}(${fk}, 'edit')) WITH CHECK (${parentFn}(${fk}, 'edit'));
CREATE POLICY sharing_delete ON ${T(e.id)} FOR DELETE USING (${parentFn}(${fk}, 'edit'));

`;
  }

  // One role per profile / permission set that grants anything on this family.
  for (const g of bp.security) {
    const touched = family.filter((id) => g.objects?.[id]?.length);
    const refs = [...refTables.keys()].filter((id) => g.objects?.[id]?.includes('read'));
    if (!touched.length) continue;
    const role = ROLE(g);
    sql += `-- ${g.id}\nCREATE ROLE ${role} NOLOGIN;\nGRANT USAGE ON SCHEMA ${S} TO ${role};\n`;
    for (const id of refs) sql += `GRANT SELECT ON ${T(id)} TO ${role};\n`;
    for (const id of touched) {
      const e = entities.get(id);
      const perms = g.objects[id];
      const fls = g.fields?.[id] ?? { edit: [], read: [] };
      const viewAll = perms.includes('viewAll') || perms.includes('modifyAll');
      const storedFields = e.fields.filter(stored);
      // Salesforce: required and master-detail fields carry no FLS and are always readable and editable.
      const alwaysEdit = (f) => f.required && !f.system && !f.autoNumber && !derivOf(f);
      const editable = storedFields.filter((f) => alwaysEdit(f) || (fls.edit.includes(f.source) && !derivOf(f)));
      const readable = storedFields.filter((f) => f.system || f.autoNumber || alwaysEdit(f) || fls.edit.includes(f.source) || fls.read.includes(f.source));
      const viewCols = e.fields.filter((f) => f.pg && !stored(f) && (fls.edit.includes(f.source) || fls.read.includes(f.source)));
      if (perms.includes('read')) {
        sql += `GRANT SELECT (${readable.map((f) => f.name).join(', ')}) ON ${T(id)} TO ${role};\n`;
        // The view exposes computed columns; grant it only the columns this role may read.
        sql += `GRANT SELECT (${[...readable, ...viewCols].map((f) => f.name).join(', ')}) ON ${T(id)}_v TO ${role};\n`;
      }
      if (perms.includes('create')) sql += `GRANT INSERT (${editable.map((f) => f.name).join(', ')}) ON ${T(id)} TO ${role};\n`;
      if (perms.includes('edit')) sql += `GRANT UPDATE (${editable.map((f) => f.name).join(', ')}) ON ${T(id)} TO ${role};\n`;
      if (perms.includes('delete')) sql += `GRANT DELETE ON ${T(id)} TO ${role};\n`;
      if (viewAll) {
        sql += `CREATE POLICY ${ident(`${role}_all`)} ON ${T(id)} FOR ALL TO ${role} USING (true)${perms.includes('modifyAll') ? ' WITH CHECK (true)' : ''};\n`;
      }
    }
    sql += '\n';
  }
  return sql;
}

// ---------------------------------------------------------------- agent translations

function translationsSql() {
  const indexFile = path.join(P.TRANSLATIONS, 'index.json');
  if (!fs.existsSync(indexFile)) return { sql: '', used: [] };
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const used = index.filter((t) => t.entities.every((x) => familyIds.has(x) || refTables.has(x)));
  let sql = header('Agent-translated Apex (adlc/3-build/logic/translations), included verbatim after review');
  for (const t of used) {
    sql += `-- ${t.file}: implements ${t.implements.join(', ')}; reviewed: ${t.reviewed}\n`;
    sql += fs.readFileSync(path.join(P.TRANSLATIONS, t.file), 'utf8') + '\n';
  }
  return { sql, used };
}

// ---------------------------------------------------------------- main

function main() {
  const all = !PARTS;
  if (all) for (const f of P.sqlFiles()) fs.rmSync(f, { force: true });
  for (const d of Object.values(P.SQL_DIRS)) fs.mkdirSync(d, { recursive: true });
  const translations = translationsSql();
  const parts = [
    ['runtime', '000_runtime.sql', runtimeSql],
    ['tables', '010_tables.sql', tablesSql],
    ['views', '020_views.sql', viewsSql],
    ['rollups', '030_rollups.sql', rollupsSql],
    ['guards', '040_guards.sql', guardsSql],
    ['translations', '050_translations.sql', () => translations.sql],
    ['security', '060_security.sql', securitySql],
  ];
  if (PARTS) for (const p of PARTS) if (!parts.some(([k]) => k === p)) throw new Error(`unknown part ${p}`);
  let written = 0;
  for (const [key, name, build] of parts) {
    if (!all && !PARTS.has(key)) continue;
    const sql = build();
    const file = path.join(P.sqlDirFor(name), name);
    const owner = { schema: 'Schema agent', logic: 'Logic agent', security: 'Security agent' }[Object.keys(P.SQL_DIRS).find((k) => P.SQL_DIRS[k] === P.sqlDirFor(name))];
    const prov = `-- Owner: ${owner} (${P.rel(P.sqlDirFor(name)).replace(/\/sql$/, '')}) · traceability: adlc/2-design/modelling/design/LLD.md (section 11)\n`;
    if (sql) { fs.writeFileSync(file, prov + sql); written++; } else fs.rmSync(file, { force: true });
  }
  // The manifest always lists every part present, so a partial run keeps the others.
  const files = P.sqlFiles().map((f) => [P.rel(f)]);

  // What the family's automations need, and which of them this emit covers.
  const covered = new Set(translations.used.flatMap((t) => t.implements));
  const automations = bp.automations.filter((a) => familyIds.has(a.trigger?.entity) || (a.writes ?? []).some((w) => familyIds.has(w)) || (a.reads ?? []).some((w) => familyIds.has(w)));
  const services = bp.services.filter((s) => [...(s.reads ?? []), ...(s.writes ?? [])].some((w) => familyIds.has(w)));
  const manifest = {
    blueprintVersion: bp.blueprintVersion,
    blueprintHash: bp.contentHash,
    family,
    referenceTables: [...refTables.keys()],
    files: files.map(([n]) => n),
    coverage: {
      derivations: bp.derivations.filter((d) => familyIds.has(d.entity) && d.kind !== 'platform').map((d) => ({ id: d.id, strategy: d.strategy })),
      constraints: bp.constraints.filter((c) => familyIds.has(c.entity)).map((c) => ({ id: c.id, strategy: c.strategy })),
      translations: translations.used.map((t) => ({ file: t.file, implements: t.implements, reviewed: t.reviewed })),
      pending: [
        ...automations.map((a) => a.id),
        ...services.flatMap((s) => s.methods.map((m) => `${s.id}#${m}`)),
      ].filter((id) => !covered.has(id)),
    },
  };
  fs.writeFileSync(P.DB_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`emitted ${all ? files.length : `${written} of ${files.length}`} files${all ? '' : ` (parts: ${[...PARTS].join(', ')})`} for ${family.join(', ')} -> ${P.rel(P.BUILD)} (blueprint ${bp.contentHash.slice(0, 12)})`);
  console.log(`  reference tables: ${manifest.referenceTables.join(', ')}`);
  console.log(`  translations: ${manifest.coverage.translations.map((t) => t.file).join(', ') || '-'}`);
  console.log(`  pending (not in this slice): ${manifest.coverage.pending.join(', ') || '-'}`);
}

main();
