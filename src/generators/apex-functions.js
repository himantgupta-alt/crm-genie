// Function-level fit-gap for Apex: splits a class or trigger into the business jobs it does, and judges each job
// against standard Salesforce features and configuration (method: kb/fit-gap-method.md).
//
//   const { analyseApex, crossCutting } = require('./apex-functions');
//
// Deterministic pattern reading of the source; no language model. Each job carries a verdict, a confidence and the
// reason, so one verdict per component does not hide the detail. Used by assess-org.js (per org) and read by
// emit-assessment.js.

const stripComments = (s) => String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const words = (s) => s.replace(/__c$/, '').replace(/_/g, ' ');
const human = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase());
const uniq = (xs) => [...new Set(xs)];

// Methods with their bodies, by brace matching from each declaration. A trigger is one block.
function methodsOf(src, isTrigger) {
  if (isTrigger) { const i = src.indexOf('{'); return [{ name: '(trigger body)', body: src.slice(i + 1, src.lastIndexOf('}')), lines: src.split('\n').length }]; }
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
    out.push({ name, body, head, lines: body.split('\n').length + 1 });
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

// One business job found in a method: { what, verdict, confidence, why, method, kind }.
function jobsOf(m, ctx) {
  const b = m.body;
  const jobs = [];
  const reads = uniq([...b.matchAll(/FROM\s+(\w+)/gi)].map((x) => x[1]));
  const builds = uniq([...b.matchAll(/new\s+(\w+__c)\s*\(/g)].map((x) => x[1]));
  const own = ctx.object;
  const other = (xs) => xs.filter((x) => x !== own);
  const onWhat = own ? ` on ${words(own)}` : '';
  const capStd = ctx.capability && ctx.capability.verdict === 'adopt' ? ctx.capability : null;
  const add = (kind, what, verdict, confidence, why) => jobs.push({ kind, what, verdict, confidence, why, method: m.name });

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
    if (RX.soql.test(b)) {
      if (capStd) add('check', `Blocks the save after checking other records (${other(reads).map(words).join(', ') || 'related data'})`, 'adopt', 'Medium', `Covered by the standard feature: ${capStd.standard}.`);
      else add('check', `Blocks the save after checking other records (${other(reads).map(words).join(', ') || 'related data'})`, 'retain', 'Medium', 'The check needs other records, which a validation rule cannot read; keep it, or move it to a before-save flow with a lookup.');
    } else add('rule', `Blocks the save when a field rule fails${onWhat}`, 'configure', 'High', 'Validation rule.');
  }
  const children = other(builds).filter((x) => x !== parent || !jobs.some((j) => j.kind === 'rollup'));
  if (children.length && RX.dml.test(b) && !jobs.some((j) => j.kind === 'rollup')) {
    if (capStd) add('create', `Creates ${children.map(words).join(', ')} records automatically`, 'adopt', 'Medium', `Covered by the standard feature: ${capStd.standard}.`);
    else add('create', `Creates ${children.map(words).join(', ')} records automatically`, 'configure', 'Medium', 'Record-triggered flow creating the records.');
  }
  if (RX.status.test(b) && !RX.soql.test(b)) {
    add('status', `Sets the status automatically${onWhat}`, 'configure', 'High', 'Approval process entry criteria or a before-save flow; keep any threshold as custom metadata, not in code.');
  } else {
    const assigned = uniq([...b.matchAll(RX.assign)].map((x) => x[1])).filter((f) => f !== 'Status__c');
    if (assigned.length && !RX.soql.test(b) && !RX.callout.test(b) && !jobs.length) {
      if (capStd) add('calc', `Calculates ${assigned.map(words).join(', ')}`, 'adopt', 'Medium', `Covered by the standard feature: ${capStd.standard}.`);
      else add('calc', `Calculates ${assigned.map(words).join(', ')}`, 'configure', 'High', 'Formula field, or a before-save flow if the value must be stored.');
    }
  }
  return jobs;
}

// Patterns that are risky wherever they appear (the cross-cutting findings of the method).
const CHECKS = [
  { id: 'test-code', title: 'Test-only code in production', severity: 'Low', rx: /Test\.isRunningTest\s*\(/, detail: 'Test.isRunningTest() changes behaviour under test, so tests do not prove what runs in production.' },
  { id: 'text-keys', title: 'Logic keyed on text values', severity: 'Medium', rx: /UserInfo\.get(Name|UserName)\(\)\s*[!=]=|Profile\.Name\s*[!=]=|\.Name\s*==\s*'[^']+'/, detail: 'Decisions taken on a user, profile or record name break when a label changes; a custom permission or a setting is safer.' },
  { id: 'id-prefix', title: 'Hard-coded ID prefixes', severity: 'Low', rx: /startsWith\(\s*'0[0-9A-Za-z]{2}'\s*\)|'00[0-9A-Z]'/, detail: "Checks like '005' to tell users from queues; use the Schema describe or instanceof instead." },
  { id: 'hidden-errors', title: 'Errors hidden from users', severity: 'Medium', rx: /catch\s*\([^)]*\)\s*\{\s*(System\.debug\([^;]*\);\s*)?\}/, detail: 'A catch block only logs the error, so failures are silent.' },
  { id: 'thresholds', title: 'Business thresholds held in code', severity: 'Medium', rx: /static\s+final\s+(Decimal|Integer|Double|Long)\s+\w+\s*=\s*[\d.]+/, detail: 'A limit the business owns is changed only by a developer and a release; custom metadata keeps it as configuration.' },
];

// Analyse one class or trigger. ctx: { kind: 'class'|'trigger', object (trigger object or main object), capability }.
function analyseApex(name, source, ctx = {}) {
  const src = stripComments(source);
  const isTrigger = ctx.kind === 'trigger';
  const methods = methodsOf(src, isTrigger);
  const functions = methods.flatMap((m) => jobsOf(m, ctx));
  const issues = CHECKS.filter((c) => c.rx.test(src)).map(({ id, title, severity }) => ({ id, title, severity }));
  const big = methods.filter((m) => m.lines > 150).map((m) => `${m.name} (${m.lines} lines)`);
  if (big.length) issues.push({ id: 'large-methods', title: 'Very large methods', severity: 'Medium', where: big });
  // Per method: the other methods of this class it calls, and the custom objects it writes. A trigger group uses
  // these to keep only the handler methods the trigger reaches, and to find what fires next (order of execution).
  const names = methods.map((m) => m.name);
  const methodInfo = methods.map((m) => ({
    name: m.name,
    local: names.filter((n) => n !== m.name && new RegExp(`(^|[^.\\w])${n}\\s*\\(`).test(m.body)),
    writes: RX.dml.test(m.body) ? uniq([...m.body.matchAll(/new\s+(\w+__c)\s*\(/g)].map((x) => x[1])) : [],
  }));
  const calls = uniq([...src.matchAll(/\b([A-Z]\w+)\.(\w+)\s*\(/g)].map((x) => `${x[1]}.${x[2]}`));
  return { name, functions, issues, calls, methodInfo, lines: src.split('\n').length };
}

module.exports = { analyseApex, CHECKS, human, words };
