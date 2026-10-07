// Salesforce formula language -> expression tree (the blueprint's vendor-neutral expression form).
// Covers validation rules, formula fields and flow filter formulas ({!$Record.X} merge syntax).
//
// Node shapes:
//   { t: 'lit', v, type }            type: number | text | boolean | null
//   { t: 'ref', path: [..] }         field path relative to the current record, e.g. ['Subscription__r', 'Status__c']
//   { t: 'global', name }            $User.Id, $Flow.CurrentDate, ... (context supplied at run time)
//   { t: 'op', op, args: [l, r] }    + - * / ^ & = != < <= > >=
//   { t: 'neg', arg }
//   { t: 'and' | 'or', args }        from AND()/OR() and && / ||
//   { t: 'not', arg }                from NOT() and !
//   { t: 'call', fn, args }          every other function, fn upper-cased

const OPS = ['<=', '>=', '<>', '!=', '==', '&&', '||', '=', '<', '>', '+', '-', '*', '/', '^', '&', '(', ')', ',', '!'];

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`unterminated comment at ${i}`);
      i = end + 2;
      continue;
    }
    if (src.startsWith('{!', i)) {
      const end = src.indexOf('}', i);
      if (end < 0) throw new Error(`unterminated merge field at ${i}`);
      out.push({ k: 'id', v: src.slice(i + 2, end).trim(), at: i });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      out.push({ k: 'num', v: Number(m[0]), at: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new Error(`unterminated string at ${i}`);
      out.push({ k: 'str', v: s, at: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/.exec(src.slice(i));
      out.push({ k: 'id', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`unexpected character '${c}' at ${i}`);
    out.push({ k: 'op', v: op, at: i });
    i += op.length;
  }
  return out;
}

function parse(src) {
  if (src === undefined || src === null) throw new Error('empty formula');
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...vs) => peek()?.k === 'op' && vs.includes(peek().v);
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`expected '${v}' at ${peek()?.at ?? 'end'}`);
    p++;
  };

  const binary = (next, ops, build) => () => {
    let left = next();
    while (isOp(...ops)) {
      const op = toks[p++].v;
      left = build(op, left, next());
    }
    return left;
  };
  const flat = (t) => (op, l, r) => ({ t, args: [...(l.t === t ? l.args : [l]), ...(r.t === t ? r.args : [r])] });
  const norm = { '==': '=', '<>': '!=' };
  const mkOp = (op, l, r) => ({ t: 'op', op: norm[op] ?? op, args: [l, r] });

  const primary = () => {
    const tk = toks[p++];
    if (!tk) throw new Error('unexpected end of formula');
    if (tk.k === 'num') return { t: 'lit', v: tk.v, type: 'number' };
    if (tk.k === 'str') return { t: 'lit', v: tk.v, type: 'text' };
    if (tk.k === 'op' && tk.v === '(') {
      const e = orExpr();
      expect(')');
      return e;
    }
    if (tk.k === 'id') {
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) {
          do args.push(orExpr()); while (isOp(',') && ++p);
        }
        expect(')');
        const fn = tk.v.toUpperCase();
        if (fn === 'AND' || fn === 'OR') return { t: fn.toLowerCase(), args };
        if (fn === 'NOT') {
          if (args.length !== 1) throw new Error('NOT takes one argument');
          return { t: 'not', arg: args[0] };
        }
        return { t: 'call', fn, args };
      }
      const up = tk.v.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') return { t: 'lit', v: up === 'TRUE', type: 'boolean' };
      if (up === 'NULL') return { t: 'lit', v: null, type: 'null' };
      return refNode(tk.v);
    }
    throw new Error(`unexpected '${tk.v}' at ${tk.at}`);
  };
  const unary = () => {
    if (isOp('-')) { p++; return { t: 'neg', arg: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    if (isOp('!')) { p++; return { t: 'not', arg: unary() }; }
    return primary();
  };
  const power = binary(unary, ['^'], mkOp);
  const mult = binary(power, ['*', '/'], mkOp);
  const add = binary(mult, ['+', '-', '&'], mkOp);
  const cmp = binary(add, ['<', '<=', '>', '>='], mkOp);
  const eq = binary(cmp, ['=', '==', '!=', '<>'], mkOp);
  const andExpr = binary(eq, ['&&'], flat('and'));
  const orExpr = binary(andExpr, ['||'], flat('or'));

  const ast = orExpr();
  if (p < toks.length) throw new Error(`unexpected '${toks[p].v}' at ${toks[p].at}`);
  return ast;
}

// $Record.X (flows) is the current record; other $-prefixed names are run-time context.
function refNode(name) {
  const parts = name.split('.');
  if (parts[0] === '$Record') return { t: 'ref', path: parts.slice(1) };
  if (parts[0] === '$Record__Prior') return { t: 'call', fn: 'PRIORVALUE', args: [{ t: 'ref', path: parts.slice(1) }] };
  if (name.startsWith('$')) return { t: 'global', name };
  return { t: 'ref', path: parts };
}

const children = (n) => n.args ?? (n.arg ? [n.arg] : []);

function walk(n, fn) {
  fn(n);
  for (const c of children(n)) walk(c, fn);
}

const PRIOR_FNS = new Set(['PRIORVALUE', 'ISCHANGED', 'ISNEW']);
const VOLATILE_FNS = new Set(['TODAY', 'NOW', 'TIMENOW', 'RAND']);
const VOLATILE_GLOBALS = /^\$(Flow\.Current|User\.|Profile\.|UserRole\.|Organization\.|System\.OriginDateTime)/;

// Facts the translator needs to choose a target construct.
function analyse(ast) {
  const refs = new Map();
  const fns = new Set();
  const globals = new Set();
  walk(ast, (n) => {
    if (n.t === 'ref') refs.set(n.path.join('.'), n.path);
    if (n.t === 'call') fns.add(n.fn);
    if (n.t === 'global') globals.add(n.name);
  });
  const paths = [...refs.values()];
  return {
    refs: [...refs.keys()],
    functions: [...fns].sort(),
    globals: [...globals].sort(),
    crossObject: paths.some((x) => x.length > 1), // traverses a relationship -> needs a join
    usesPrior: [...fns].some((f) => PRIOR_FNS.has(f)), // needs the pre-update row
    volatile: [...fns].some((f) => VOLATILE_FNS.has(f)) || [...globals].some((g) => VOLATILE_GLOBALS.test(g)),
  };
}

// Canonical text form; parse(print(x)) round-trips, which the tests use as a parser check.
function print(n) {
  switch (n.t) {
    case 'lit':
      if (n.type === 'text') return JSON.stringify(n.v);
      if (n.type === 'null') return 'NULL';
      return n.type === 'boolean' ? (n.v ? 'TRUE' : 'FALSE') : String(n.v);
    case 'ref': return n.path.join('.');
    case 'global': return n.name;
    case 'neg': return `-(${print(n.arg)})`;
    case 'not': return `NOT(${print(n.arg)})`;
    case 'and': case 'or': return `${n.t.toUpperCase()}(${n.args.map(print).join(', ')})`;
    case 'call': return `${n.fn}(${n.args.map(print).join(', ')})`;
    case 'op': return `(${print(n.args[0])} ${n.op} ${print(n.args[1])})`;
    default: throw new Error(`unknown node ${n.t}`);
  }
}

module.exports = { tokenize, parse, analyse, print, walk, children };
