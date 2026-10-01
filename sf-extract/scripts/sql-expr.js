// Blueprint expression tree -> Postgres SQL expression.
//
// ctx = {
//   row:      SQL alias/record for the current row ('NEW', 's', ...)
//   prior:    SQL record for the pre-update row ('OLD'), or null where none exists (insert, CHECK, view)
//   column:   fieldId -> column name
//   lookup:   (relationId) -> { table, key } for joining a relationship hop as a scalar subquery
//   blanksAsZero: true for formula fields with BlankAsZero (numeric refs read NULL as 0)
//   today:    SQL for TODAY() (default current_date); the harness overrides it to pin the clock
// }
// Salesforce semantics kept: a validation rule rejects only when its condition is TRUE, never NULL;
// ISBLANK on text treats '' as blank; & concatenates with blanks as ''.

const NUMERIC = new Set(['integer', 'decimal', 'currency', 'percent']);
const TEXTUAL = new Set(['text', 'longtext', 'email', 'phone', 'url', 'picklist', 'id', 'reference']);

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function compileSql(ast, ctx) {
  const today = ctx.today ?? 'current_date';

  // A ref, read from `rec` (row or prior), following relationship hops with scalar subqueries.
  const refSql = (n, rec) => {
    if (!n.field) throw new Error(`unresolved ref ${n.path.join('.')}`);
    let expr = null;
    const qual = (c) => (rec ? `${rec}.${c}` : c); // CHECK constraints name columns bare
    const hops = n.via ?? [];
    if (!hops.length) expr = qual(ctx.column(n.field));
    else {
      // Innermost: the FK column on the current row; each hop wraps a lookup.
      let key = qual(ctx.column(hops[0]));
      for (let i = 0; i < hops.length; i++) {
        const { table } = ctx.lookup(hops[i]);
        const alias = `h${i}`;
        const target = i + 1 < hops.length ? ctx.column(hops[i + 1]) : ctx.column(n.field);
        key = `(SELECT ${alias}.${target} FROM ${table} ${alias} WHERE ${alias}.id = ${key})`;
      }
      expr = key;
    }
    if (ctx.blanksAsZero && NUMERIC.has(n.type)) return `COALESCE(${expr}, 0)`;
    return expr;
  };

  const c = (n) => {
    switch (n.t) {
      case 'lit':
        if (n.type === 'null') return 'NULL';
        if (n.type === 'boolean') return n.v ? 'TRUE' : 'FALSE';
        if (n.type === 'number') return String(n.v);
        return quote(n.v);
      case 'ref': return refSql(n, ctx.row);
      case 'global':
        if (n.name === '$Flow.CurrentDate') return today;
        if (n.name === '$Flow.CurrentDateTime') return 'now()';
        throw new Error(`global ${n.name} not supported in SQL`);
      case 'neg': return `(-${c(n.arg)})`;
      case 'not': return `(NOT ${c(n.arg)})`;
      case 'and': return `(${n.args.map(c).join(' AND ')})`;
      case 'or': return `(${n.args.map(c).join(' OR ')})`;
      case 'op': {
        const [l, r] = n.args;
        if (n.op === '&') return `(COALESCE(${c(l)}::text, '') || COALESCE(${c(r)}::text, ''))`;
        if (n.op === '^') return `power(${c(l)}, ${c(r)})`;
        const op = n.op === '!=' ? '<>' : n.op;
        return `(${c(l)} ${op} ${c(r)})`;
      }
      case 'call': return call(n);
      default: throw new Error(`node ${n.t}`);
    }
  };

  const call = (n) => {
    const a = n.args;
    const needPrior = () => {
      if (!ctx.prior) throw new Error(`${n.fn} needs the prior row; not available in this context`);
    };
    switch (n.fn) {
      case 'ISPICKVAL': return `(${c(a[0])} = ${c(a[1])})`;
      case 'ISBLANK': case 'ISNULL': {
        const x = c(a[0]);
        return a[0].t === 'ref' && TEXTUAL.has(a[0].type) || a[0].t === 'call' && a[0].fn === 'TEXT'
          ? `(NULLIF(${x}, '') IS NULL)` : `(${x} IS NULL)`;
      }
      case 'BLANKVALUE': case 'NULLVALUE': return `COALESCE(${c(a[0])}, ${c(a[1])})`;
      case 'TEXT': return `(${c(a[0])})::text`;
      case 'VALUE': return `(${c(a[0])})::numeric`;
      case 'TODAY': return today;
      case 'NOW': return 'now()';
      case 'ABS': case 'ROUND': case 'FLOOR': case 'CEILING': case 'SQRT': case 'LN': case 'EXP':
        return `${n.fn === 'CEILING' ? 'ceil' : n.fn.toLowerCase()}(${a.map(c).join(', ')})`;
      case 'MAX': return `GREATEST(${a.map(c).join(', ')})`;
      case 'MIN': return `LEAST(${a.map(c).join(', ')})`;
      case 'MOD': return `mod(${c(a[0])}, ${c(a[1])})`;
      case 'LEN': return `length(COALESCE(${c(a[0])}, ''))`;
      case 'UPPER': case 'LOWER': case 'TRIM': return `${n.fn.toLowerCase()}(${c(a[0])})`;
      case 'CONTAINS': return `(strpos(COALESCE(${c(a[0])}, ''), ${c(a[1])}) > 0)`;
      case 'BEGINS': return `starts_with(COALESCE(${c(a[0])}, ''), ${c(a[1])})`;
      case 'IF': return `(CASE WHEN ${c(a[0])} THEN ${c(a[1])} ELSE ${c(a[2])} END)`;
      case 'CASE': {
        const [subject, ...rest] = a;
        const pairs = [];
        for (let i = 0; i + 1 < rest.length; i += 2) pairs.push(`WHEN ${c(rest[i])} THEN ${c(rest[i + 1])}`);
        const dflt = rest.length % 2 ? ` ELSE ${c(rest[rest.length - 1])}` : '';
        return `(CASE ${c(subject)} ${pairs.join(' ')}${dflt} END)`;
      }
      // On insert Salesforce defines PRIORVALUE as the current value and ISCHANGED as false.
      case 'PRIORVALUE': if (ctx.insert) return refSql(a[0], ctx.row); needPrior(); return refSql(a[0], ctx.prior);
      case 'ISCHANGED': if (ctx.insert) return 'FALSE'; needPrior(); return `(${refSql(a[0], ctx.row)} IS DISTINCT FROM ${refSql(a[0], ctx.prior)})`;
      case 'ISNEW': return ctx.prior ? 'FALSE' : 'TRUE';
      default: throw new Error(`function ${n.fn} has no SQL translation yet`);
    }
  };

  return c(ast);
}

module.exports = { compileSql, quote, NUMERIC };
