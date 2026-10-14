// Function-level fit-gap for Apex: splits a class or trigger into the business jobs it does, and judges each job
// against standard Salesforce features and configuration (method: kb/fit-gap-method.md).
//
//   const { analyseApex, CHECKS } = require('./apex-functions');
//
// Deterministic pattern reading of the source; no language model. Each job carries a verdict, a confidence, the
// reason and its code reference (method and line range of the version read), so one verdict per component does not
// hide the detail. Used by assess-org.js (per org) and read by emit-assessment.js.

// Comments are blanked, not removed, so every position keeps its line number. "://" in a URL is not a comment.
const stripComments = (s) => String(s || '')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(?<!:)\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const words = (s) => s.replace(/__c$/, '').replace(/_/g, ' ');
const human = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase());
const uniq = (xs) => [...new Set(xs)];
const lineAt = (src, i) => src.slice(0, i).split('\n').length;

// Methods with their bodies and line ranges, by brace matching from each declaration. A trigger is one block.
function methodsOf(src, isTrigger) {
  if (isTrigger) { const i = src.indexOf('{'); return [{ name: '(trigger body)', body: src.slice(i + 1, src.lastIndexOf('}')), head: '', start: 1, end: lineAt(src, src.length), lines: src.split('\n').length }]; }
  const out = [];
  const decl = /(?:^|[\n;{}])\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|global|protected|static|override|virtual|webservice|testMethod)\s+)+[\w<>,.\s[\]]+?\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = decl.exec(src))) {
    const name = m[1];
    if (['if', 'for', 'while', 'switch', 'catch', 'class'].includes(name)) continue;
    let depth = 1, i = decl.lastIndex;
    for (; i < src.length && depth; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; }
    const body = src.slice(decl.lastIndex, i - 1);
    const head = src.slice(m.index, decl.lastIndex);
    const lead = /^[\n;{}]/.test(head) ? 1 : 0;
    const start = lineAt(src, m.index + lead + head.slice(lead).search(/\S/));
    const end = lineAt(src, i - 1);
    out.push({ name, body, head, start, end, lines: end - start + 1 });
    decl.lastIndex = i;
  }
  return out;
}

const RX = {
  callout: /new\s+HttpRequest\b|['"]callout:/,
  chatter: /new\s+FeedItem\s*\(|ConnectApi\.ChatterFeeds/,
  email: /Messaging\.(SingleEmailMessage|sendEmail|MassEmailMessage)/,
  approval: /Approval\.(process|ProcessSubmitRequest|ProcessWorkitemRequest)/,
  soql: /\[\s*SELECT\b/i,
  aggregate: /\b(SUM|COUNT|AVG|MAX|MIN)\s*\(|AggregateResult/i,
  dml: /\b(insert|update|upsert|delete)\s+[\w(]/,
  addError: /\.addError\s*\(/,
  status: /\.Status__c\s*=\s*'[^']*'/,
  assign: /\b\w+\.(\w+__c)\s*=(?!=)/g,
  future: /@future\s*\(\s*callout\s*=\s*true/i,
};

// Fields a method writes (assignments and new-record arguments) and reads (other references and SOQL), so linked
// steps can be found. Values of the record before the save (old, oldMap) are not a dependency.
function fieldsOf(b) {
  const writes = uniq([...[...b.matchAll(/\.(\w+__c)\s*=(?!=)/g)].map((x) => x[1]),
    ...[...b.matchAll(/new\s+\w+__c\s*\(([^)]*)\)/g)].flatMap((x) => [...x[1].matchAll(/(\w+__c)\s*=(?!=)/g)].map((y) => y[1]))]);
  const t = b.replace(/oldMap\.get\([^)]*\)\.\w+__c/g, '').replace(/\bold\w*\.\w+__c/g, '').replace(/\.(\w+__c)\s*=(?!=)/g, '')
    .replace(/new\s+\w+__c\s*\(([^)]*)\)/g, (m, args) => args.replace(/(\w+__c)\s*=(?!=)/g, ''));
  const soql = [...t.matchAll(/\[\s*SELECT([\s\S]*?)\bFROM\s+\w+([\s\S]*?)\]/gi)].flatMap((m) => [...`${m[1]} ${m[2]}`.matchAll(/\b(\w+__c)\b/g)].map((x) => x[1]));
  const reads = uniq([...[...t.matchAll(/\.(\w+__c)\b/g)].map((x) => x[1]), ...soql]);
  return { reads, writes };
}

// One business job found in a method: { what, verdict, confidence, why, method, kind, lines }.
function jobsOf(m, ctx) {
  const b = m.body;
  const jobs = [];
  const reads = uniq([...b.matchAll(/FROM\s+(\w+)/gi)].map((x) => x[1]));
  const builds = uniq([...b.matchAll(/new\s+(\w+__c)\s*\(/g)].map((x) => x[1]));
  const own = ctx.object;
  const other = (xs) => xs.filter((x) => x !== own);
  const onWhat = own ? ` on ${words(own)}` : '';
  const add = (kind, what, verdict, confidence, why) => jobs.push({ kind, what, verdict, confidence, why, method: m.name, lines: [m.start, m.end] });

  if (RX.callout.test(b)) {
    add('integration', `Calls an external system${RX.future.test(m.head || '') ? ' asynchronously (@future)' : ''}`, 'retain', 'High',
      'External system integration; no standard feature replaces it. Keep it behind a named credential; a queue or platform event adds retries.');
  }
  if (RX.chatter.test(b)) add('chatter', `Posts a Chatter message${onWhat}`, 'configure', 'High', "Flow 'Post to Chatter' action.");
  if (RX.email.test(b)) add('email', 'Builds and sends an email in code', 'adopt', 'Medium', 'Email template with an email alert, sent from a flow or an approval step.');
  if (RX.approval.test(b)) add('approval', 'Submits or decides approvals in code', 'configure', 'Medium', 'Approval process with entry criteria; auto-submission from a record-triggered flow.');
  const parent = other(builds)[0] || other(reads).find((r) => r.endsWith('__c'));
  if (RX.aggregate.test(b) && RX.dml.test(b) && parent) {
    add('rollup', `Keeps totals on ${words(parent)} from its related records`, 'configure', 'Medium', 'Roll-up summary field where the relationship is master-detail; otherwise a record-triggered flow.');
  }
  if (RX.addError.test(b)) {
    if (RX.soql.test(b)) add('check', `Blocks the save after checking other records (${other(reads).map(words).join(', ') || 'related data'})`, 'retain', 'Medium', 'The check needs other records, which a validation rule cannot read; keep it, or move it to a before-save flow with a lookup.');
    else add('rule', `Blocks the save when a field rule fails${onWhat}`, 'configure', 'High', 'Validation rule.');
  }
  const children = other(builds).filter((x) => x !== parent || !jobs.some((j) => j.kind === 'rollup'));
  if (children.length && RX.dml.test(b) && !jobs.some((j) => j.kind === 'rollup')) {
    add('create', `Creates ${children.map(words).join(', ')} records automatically`, 'configure', 'Medium', 'Record-triggered flow creating the records.');
  }
  if (RX.status.test(b) && !RX.soql.test(b)) {
    add('status', `Sets the status automatically${onWhat}`, 'configure', 'High', 'Approval process entry criteria or a before-save flow; keep any threshold as custom metadata, not in code.');
  } else {
    const assigned = uniq([...b.matchAll(RX.assign)].map((x) => x[1])).filter((f) => f !== 'Status__c');
    if (assigned.length && !RX.soql.test(b) && !RX.callout.test(b) && !jobs.length) {
      add('calc', `Calculates ${assigned.map(words).join(', ')}`, 'configure', 'High', 'Formula field, or a before-save flow if the value must be stored.');
    }
  }
  return jobs;
}

// Calls a trigger makes, with their line and the context they run in: before or after the save, and on insert or
// not. Reads the if / else structure of the trigger body (Trigger.isBefore, isAfter, isInsert, isUpdate, isDelete).
function triggerCalls(src) {
  const open = src.indexOf('{');
  const s = src.slice(open + 1, src.lastIndexOf('}'));
  const declared = ((src.slice(0, open).match(/\(([^)]*)\)\s*$/) || [])[1] || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const out = [];
  const cond = (c) => ({ phase: /Trigger\.isBefore/.test(c) ? 'before' : /Trigger\.isAfter/.test(c) ? 'after' : undefined, insert: /Trigger\.isInsert/.test(c) ? true : /Trigger\.is(Update|Delete)/.test(c) ? false : undefined });
  const neg = (c) => ({ phase: c.phase === 'before' ? 'after' : c.phase === 'after' ? 'before' : undefined, insert: c.insert === undefined ? undefined : !c.insert });
  const merge = (a, b) => ({ phase: b.phase ?? a.phase, insert: b.insert ?? a.insert });
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const parens = () => { let depth = 0; const from = i; for (; i < s.length; i++) { if (s[i] === '(') depth++; else if (s[i] === ')' && !--depth) { i++; return s.slice(from + 1, i - 1); } } return s.slice(from); };
  const kw = (k) => s.startsWith(k, i) && !/\w/.test(s[i + k.length] || '');
  function statement(ctx) {
    ws();
    if (i >= s.length) return;
    if (kw('if')) {
      i += 2; ws(); const c = cond(parens());
      statement(merge(ctx, c)); ws();
      if (kw('else')) { i += 4; statement(merge(ctx, neg(c))); }
      return;
    }
    if (kw('for') || kw('while')) { i += kw('for') ? 3 : 5; ws(); parens(); statement(ctx); return; }
    if (s[i] === '{') { i++; for (;;) { ws(); if (i >= s.length) return; if (s[i] === '}') { i++; return; } const at = i; statement(ctx); if (i === at) i++; } }
    const from = i; let depth = 0;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (ch === '(' || ch === '{') depth++;
      else if (ch === ')' || ch === '}') { if (!depth) break; depth--; } else if (ch === ';' && !depth) { i++; break; }
    }
    const text = s.slice(from, i);
    for (const m of text.matchAll(/\b([A-Z]\w*)\.(\w+)\s*\(/g)) out.push({ to: `${m[1]}.${m[2]}`, line: lineAt(src, open + 1 + from + m.index), ...ctx });
  }
  while (i < s.length) { const at = i; statement({}); if (i === at) i++; }
  // Where the code does not say, the declared events do (a trigger on "after insert" only runs after).
  for (const c of out) {
    if (c.phase) continue;
    const fits = declared.filter((e) => c.insert === undefined || (c.insert ? /insert/.test(e) : !/insert/.test(e)));
    const phases = uniq(fits.map((e) => e.split(/\s+/)[0]));
    c.phase = phases.length === 1 ? phases[0] : undefined;
  }
  return { calls: out, events: declared };
}

// Patterns that are risky wherever they appear (the cross-cutting findings of the method).
const CHECKS = [
  { id: 'test-code', title: 'Test-only code in production', severity: 'Low', rx: /Test\.isRunningTest\s*\(/, detail: 'Test.isRunningTest() changes behaviour under test, so tests do not prove what runs in production.' },
  { id: 'text-keys', title: 'Logic keyed on text values', severity: 'Medium', rx: /UserInfo\.get(Name|UserName)\(\)\s*[!=]=|Profile\.Name\s*[!=]=|\.Name\s*==\s*'[^']+'/, detail: 'Decisions taken on a user, profile or record name break when a label changes; a custom permission or a setting is safer.' },
  { id: 'id-prefix', title: 'Hard-coded ID prefixes', severity: 'Low', rx: /startsWith\(\s*'0[0-9A-Za-z]{2}'\s*\)|'00[0-9A-Z]'/, detail: "Checks like '005' to tell users from queues; use the Schema describe or instanceof instead." },
  { id: 'hidden-errors', title: 'Errors hidden from users', severity: 'Medium', rx: /catch\s*\([^)]*\)\s*\{\s*(System\.debug\([^;]*\);\s*)?\}/, detail: 'A catch block only logs the error, so failures are silent.' },
  { id: 'thresholds', title: 'Business thresholds held in code', severity: 'Medium', rx: /static\s+final\s+(Decimal|Integer|Double|Long)\s+\w+\s*=\s*[\d.]+/, detail: 'A limit the business owns is changed only by a developer and a release; custom metadata keeps it as configuration.' },
];

// Analyse one class or trigger. ctx: { kind: 'class'|'trigger', object (the trigger's object) }.
function analyseApex(name, source, ctx = {}) {
  const src = stripComments(source);
  const isTrigger = ctx.kind === 'trigger';
  const methods = methodsOf(src, isTrigger);
  const functions = methods.flatMap((m) => jobsOf(m, ctx));
  const issues = CHECKS.filter((c) => c.rx.test(src)).map(({ id, title, severity }) => ({ id, title, severity }));
  const big = methods.filter((m) => m.lines > 150).map((m) => `${m.name} (${m.lines} lines, L${m.start}-${m.end})`);
  if (big.length) issues.push({ id: 'large-methods', title: 'Very large methods', severity: 'Medium', where: big });
  // Per method: line range, the other methods of this class it calls, the custom objects it writes, and the fields
  // it reads and writes. Trigger groups keep only the handler methods the trigger reaches; linked steps form chains.
  const names = methods.map((m) => m.name);
  const methodInfo = methods.map((m) => ({
    name: m.name, lines: [m.start, m.end],
    local: names.filter((n) => n !== m.name && new RegExp(`(^|[^.\\w])${n}\\s*\\(`).test(m.body)),
    writes: RX.dml.test(m.body) ? uniq([...m.body.matchAll(/new\s+(\w+__c)\s*\(/g)].map((x) => x[1])) : [],
    fields: fieldsOf(m.body),
  }));
  const out = { name, functions, issues, methodInfo, lines: src.split('\n').length };
  if (isTrigger) Object.assign(out, triggerCalls(src));
  else out.calls = uniq([...src.matchAll(/\b([A-Z]\w*)\.(\w+)\s*\(/g)].map((x) => `${x[1]}.${x[2]}`)).map((to) => ({ to }));
  return out;
}

module.exports = { analyseApex, CHECKS, human, words };
