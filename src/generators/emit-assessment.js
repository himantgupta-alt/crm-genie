// Multi-org assessment: fit-gap, cross-org comparison, report and architecture, from the as-is files.
//
//   node src/generators/emit-assessment.js
//
// Reads  adlc/1-discover/assessment/orgs/<region>.json (assess-org.js, one per org)
//        src/agents/assessment/engagement.json and capabilities.json
// Writes adlc/1-discover/assessment/fit-gap.json, assessment-report.md, architecture.md, and embeds the same data
//        in the Org Compiler console between the ASSESS markers.
// No org connection. Deterministic: the same inputs give the same files.
const fs = require('fs');
const path = require('path');
const P = require('../paths');

const DIR = P.ASSESSMENT;
const SPEC = path.join(P.AGENTS, 'assessment');
const eng = JSON.parse(fs.readFileSync(process.env.ENGAGEMENT_FILE || path.join(SPEC, 'engagement.json'), 'utf8'));
const cat = JSON.parse(fs.readFileSync(path.join(SPEC, 'capabilities.json'), 'utf8'));
const V = cat.verdicts;
const VERDICTS = Object.keys(V);

const orgs = eng.orgs.map((o) => {
  const f = path.join(DIR, 'orgs', `${o.region}.json`);
  return { ...o, asIs: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null };
});
const extracted = orgs.filter((o) => o.asIs);
if (!extracted.length) { console.error('assessment: no as-is files yet; run assess-org.js for at least one org'); process.exit(1); }

/* ---------------------------------------------------------------- classify */

const re = (s) => (s ? new RegExp(s) : null);
const caps = cat.capabilities.map((c) => ({ ...c, re: Object.fromEntries(Object.entries(c.match).map(([k, v]) => [k, re(v)])) }));
const byKey = (kind, name) => caps.find((c) => c.re[kind]?.test(name));
const capOfObject = (name) => byKey('objects', name);

function classify(o) {
  const a = o.asIs;
  const items = [];
  const push = (kind, name, cap, extra = {}) => {
    let verdict = cap ? cap.verdict : 'review';
    let reason = cap ? cap.standard : 'Not matched to a known capability; confirm owner and purpose in the workshop.';
    if (extra.unused && verdict !== 'retire') {
      if (!cap) { verdict = 'retire'; reason = extra.unused; } else reason = `${reason}. Note: ${extra.unused.toLowerCase()}`;
    }
    items.push({ org: o.region, kind, name, capability: cap?.id || null, verdict, reason, ...extra.facts });
  };

  for (const ob of a.objects) {
    const unused = cat.rules.retireObjectsWithoutRecords && ob.records === 0 ? 'No records in the org.' : null;
    push('Custom object', ob.name, capOfObject(ob.name), { unused, facts: { records: ob.records, fields: ob.fields.length } });
  }
  for (const so of a.extended) for (const f of so.fields) {
    const name = `${so.name}.${f.name}`;
    const unused = f.fill != null && f.fill < cat.rules.retireWhenFillBelow && so.records > 0 ? `Filled on ${f.fill}% of ${so.records} records.` : null;
    push('Custom field', name, byKey('fields', name), { unused, facts: { fill: f.fill, type: f.type } });
  }
  for (const c of a.automation.classes.filter((x) => !x.test)) {
    const cap = byKey('classes', c.name) || (c.objects.length ? capOfObject(c.objects[0]) : null);
    push('Apex class', c.name, cap, { facts: { lines: c.lines, objects: c.objects } });
  }
  for (const t of a.automation.triggers) {
    const cap = byKey('triggers', t.name) || capOfObject(t.object);
    push('Apex trigger', t.name, cap, { unused: t.active ? null : 'Inactive.', facts: { object: t.object, lines: t.lines } });
  }
  for (const fl of a.automation.flows) {
    const obj = a.objects.find((x) => x.label === fl.object)?.name;
    const cap = obj ? capOfObject(obj) : null;
    // A flow is already configuration: it stays unless its capability moves to a standard feature.
    const base = cap ? { ...cap, verdict: cap.verdict === 'adopt' ? 'adopt' : 'keep' } : { id: null, verdict: 'keep', standard: 'Already configuration (Flow); keep and document.' };
    push('Flow', fl.name, base.id ? base : null, { unused: fl.active ? null : 'Inactive.', facts: { object: fl.object } });
    if (!base.id) Object.assign(items[items.length - 1], { verdict: fl.active ? 'keep' : 'retire', reason: base.standard });
  }
  for (const vr of a.automation.validationRules) {
    const cap = capOfObject(vr.object) || caps.find((c) => c.re.fields && [...(a.extended.find((s) => s.name === vr.object)?.fields || [])].some((f) => c.re.fields.test(`${vr.object}.${f.name}`) && new RegExp(f.name.replace(/__c$/, '').split('_')[0], 'i').test(vr.name)));
    push('Validation rule', `${vr.object}.${vr.name}`, cap, { unused: vr.active ? null : 'Inactive.', facts: { object: vr.object } });
  }
  for (const p of a.packages) push('Installed package', p.name, byKey('packages', p.name), {});
  return items;
}

const items = extracted.flatMap(classify);

/* ---------------------------------------------------------------- summarise */

const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);
const orgSummary = orgs.map((o) => {
  if (!o.asIs) return { region: o.region, label: o.label, extracted: false };
  const a = o.asIs;
  const mine = items.filter((i) => i.org === o.region);
  return {
    region: o.region, label: o.label, extracted: true, edition: a.org.edition,
    markets: a.markets,
    counts: {
      customObjects: a.objects.length,
      customFields: sum(a.objects, (x) => x.fields.length) + sum(a.extended, (x) => x.fields.length),
      fieldsOnStandard: sum(a.extended, (x) => x.fields.length),
      apexClasses: a.automation.classes.filter((c) => !c.test).length,
      apexTests: a.automation.classes.filter((c) => c.test).length,
      apexLines: sum(a.automation.classes.filter((c) => !c.test), (c) => c.lines) + sum(a.automation.triggers, (t) => t.lines),
      triggers: a.automation.triggers.length,
      flows: a.automation.flows.length,
      validationRules: a.automation.validationRules.length,
      packages: a.packages.length,
      customRecords: sum(a.objects, (x) => x.records),
      activeUsers: a.usage.activeUsers,
      reports: a.usage.reports,
    },
    integrations: a.integrations,
    objects: a.objects.map((x) => ({ name: x.name, label: x.label, records: x.records, fields: x.fields.length })),
    verdicts: Object.fromEntries(VERDICTS.map((v) => [v, mine.filter((i) => i.verdict === v).length])),
  };
});

const capabilityMatrix = cat.capabilities.map((c) => {
  const perOrg = Object.fromEntries(extracted.map((o) => [o.region, items.filter((i) => i.org === o.region && i.capability === c.id).map((i) => i.name)]));
  const objectsPerOrg = extracted.map((o) => items.filter((i) => i.org === o.region && i.capability === c.id && i.kind === 'Custom object').map((i) => i.name).sort().join('+')).filter(Boolean);
  const inOrgs = Object.values(perOrg).filter((x) => x.length).length;
  return { id: c.id, area: c.area, capability: c.capability, verdict: c.verdict, standard: c.standard, licence: c.licence, reference: c.reference, perOrg, inOrgs, builtDifferently: new Set(objectsPerOrg).size > 1 };
}).filter((c) => c.inOrgs > 0);

const total = items.length;
const share = (v) => (total ? Math.round((items.filter((i) => i.verdict === v).length / total) * 100) : 0);
const marketsFound = sum(orgSummary.filter((o) => o.extracted), (o) => o.markets.length);
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
const differently = capabilityMatrix.filter((c) => c.builtDifferently);
const findings = [
  `${extracted.length} of ${orgs.length} orgs extracted; ${marketsFound} of ${eng.marketsExpected} markets found in the extracted orgs.`,
  `${n(total, 'custom component', 'custom components')} classified: ${VERDICTS.map((v) => `${share(v)}% ${V[v].toLowerCase()}`).join(', ')}.`,
  extracted.length > 1
    ? `${n(differently.length, 'business capability is', 'business capabilities are')} built in more than one org with different custom objects${differently.length ? ` (${differently.map((c) => c.capability.toLowerCase()).join(', ')})` : ''}.`
    : 'Cross-org comparison starts once a second org is extracted.',
  `${n(items.filter((i) => i.verdict === 'retire').length, 'component is', 'components are')} unused and can be retired before any move.`,
  `${n(items.filter((i) => i.verdict === 'review').length, 'component is', 'components are')} not matched to a known capability and ${items.filter((i) => i.verdict === 'review').length === 1 ? 'goes' : 'go'} on the workshop agenda.`,
];

const fitGap = {
  owner: 'Assessment agent', generatedBy: 'src/generators/emit-assessment.js',
  client: eng.client, sampleData: eng.sampleData, note: eng.note, marketsExpected: eng.marketsExpected,
  verdicts: V, findings, orgs: orgSummary, capabilities: capabilityMatrix,
  items: items.sort((a, b) => a.org.localeCompare(b.org) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
};

/* ---------------------------------------------------------------- report */

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const row = (cells) => `| ${cells.map(esc).join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const lbl = (r) => orgs.find((o) => o.region === r).label;
const ex = orgSummary.filter((o) => o.extracted);

const report = [
  `# ${eng.client}: Salesforce org assessment`, '',
  'Owner: Assessment agent · generated by `src/generators/emit-assessment.js` from the as-is extraction of each org. Do not edit; re-run the agent.', '',
  eng.sampleData ? `> ${eng.note}` : '', '',
  '## Summary', '', ...findings.map((f) => `- ${f}`), '',
  '## Orgs and markets', '',
  table(['Org', 'Status', 'Edition', 'Markets', 'Customers with a market'], orgSummary.map((o) => o.extracted
    ? [o.label, 'Extracted', o.edition, `${o.markets.length}: ${o.markets.map((m) => m.name).join(', ')}`, sum(o.markets, (m) => m.customers)]
    : [o.label, 'Not yet extracted', '', '', ''])), '',
  '## As-is: what each org has built', '',
  table(['Measure', ...ex.map((o) => o.label)], [
    ['Custom objects', ...ex.map((o) => o.counts.customObjects)],
    ['Custom fields (all objects)', ...ex.map((o) => o.counts.customFields)],
    ['Custom fields on standard objects', ...ex.map((o) => o.counts.fieldsOnStandard)],
    ['Apex classes (excluding tests)', ...ex.map((o) => o.counts.apexClasses)],
    ['Apex triggers', ...ex.map((o) => o.counts.triggers)],
    ['Lines of Apex (classes and triggers)', ...ex.map((o) => o.counts.apexLines)],
    ['Flows', ...ex.map((o) => o.counts.flows)],
    ['Validation rules', ...ex.map((o) => o.counts.validationRules)],
    ['Installed packages', ...ex.map((o) => o.counts.packages)],
    ['Records in custom objects', ...ex.map((o) => o.counts.customRecords)],
    ['Outbound integrations (Apex callouts)', ...ex.map((o) => o.integrations.calloutClasses.length)],
  ]), '',
  '## The same capability, built per org', '',
  'Each row is a business capability; each cell lists the components that implement it in that org. "Built differently" means two or more orgs use different custom objects for the same need.', '',
  table(['Area', 'Capability', ...ex.map((o) => o.label), 'Built differently', 'Standard feature', 'Verdict'], capabilityMatrix.map((c) => [
    c.area, c.capability, ...ex.map((o) => (c.perOrg[o.region] || []).join(', ') || '—'), c.builtDifferently ? 'Yes' : 'No', c.standard, V[c.verdict]])), '',
  '## Fit-gap by org', '',
  table(['Verdict', ...ex.map((o) => o.label), 'All orgs'], VERDICTS.map((v) => [V[v], ...ex.map((o) => o.verdicts[v]), items.filter((i) => i.verdict === v).length])), '',
  ...VERDICTS.flatMap((v) => {
    const xs = items.filter((i) => i.verdict === v);
    if (!xs.length) return [];
    return [`### ${V[v]} (${xs.length})`, '', table(['Org', 'Type', 'Component', 'Why'], xs.map((i) => [lbl(i.org), i.kind, i.name, i.reason])), ''];
  }),
  '## Method and limits', '',
  '- Read-only: describe, SOQL counts and the Tooling API, with the permissions of one integration user per org. No record contents leave the org; the as-is files hold component names, counts and fill rates only.',
  '- Each component is matched to a capability by name, then by the objects its code reads or writes (`src/agents/assessment/capabilities.json`). The verdict is the capability\'s default, overridden to Retire when a component is unused (no records, field filled on under 1% of records, or inactive).',
  '- Not yet covered: page layouts and Lightning pages, reports and dashboards by usage, profiles and sharing, email templates. These are listed in the gap register of the Extraction agent for the migration and are added here in the next iteration.',
  '- Verdicts are proposals for the workshop. Licence fit (Consumer Goods Cloud, Trade Promotion Management, Revenue Cloud) is confirmed with the client before any verdict becomes a decision.', '',
].join('\n');

/* ---------------------------------------------------------------- architecture */

const architecture = [
  `# ${eng.client}: assessment architecture and target direction`, '',
  'Owner: Assessment agent · generated by `src/generators/emit-assessment.js`. Do not edit; re-run the agent.', '',
  '## Principles', '',
  '1. **Standard before custom.** Each capability is first matched to a standard Salesforce or Consumer Goods Cloud feature; custom build stays only where no standard feature fits.',
  '2. **Configuration before code.** Approvals, roll-ups and thresholds move from Apex to configuration that the business can change without a release.',
  '3. **One definition per business concept.** A store visit, a promotion or a tax ID is modelled once and shared by every org, so reporting and integrations work across regions.',
  '4. **Retire before you move.** Unused objects, fields and automation are removed first; nothing unused is rebuilt.',
  '5. **Integrations through one layer.** Outbound calls use named credentials through the integration layer; no endpoints or secrets in code.',
  '6. **Data stays in the client environment.** The agents run there, read-only, with one least-privilege integration user per org; outputs hold names and counts, not records.',
  '7. **Reviewed and repeatable.** Every output is generated from the extraction, versioned, and approved at a review gate before it is used.', '',
  '## How the assessment runs', '',
  '```mermaid',
  'flowchart TB',
  '  subgraph Client["Client environment"]',
  ...orgs.map((o) => `    ${o.region}[("${o.label} org")]`),
  '    subgraph Agents["Assessment agent"]',
  '      X["As-is extraction<br/>read-only, per org"] --> C["Classify against<br/>capability catalogue"] --> G["Fit-gap, comparison,<br/>report"]',
  '    end',
  ...orgs.map((o) => `    ${o.region} -- "integration user<br/>read-only" --> X`),
  '    G --> R{{"Review gate"}} --> H["HTML console<br/>and report"]',
  '  end',
  '  H --> W["Workshop:<br/>confirm verdicts"]',
  '```', '',
  '## How a verdict is reached', '',
  '```mermaid',
  'flowchart TD',
  '  A["Custom component"] --> U{"Used?<br/>records, fill rate, active"}',
  `  U -- "no" --> RT["${V.retire}"]`,
  '  U -- "yes" --> M{"Matches a known<br/>capability?"}',
  `  M -- "no" --> RV["${V.review}"]`,
  '  M -- "yes" --> S{"Standard feature<br/>covers it?"}',
  `  S -- "yes" --> AD["${V.adopt}"]`,
  '  S -- "partly" --> CF{"Logic expressible<br/>as configuration?"}',
  `  CF -- "yes" --> CO["${V.configure}"]`,
  `  CF -- "no" --> KP["${V.keep}"]`,
  '```', '',
  '## Target direction', '',
  'One global core shared by all regional orgs: the data model and configuration are built once, versioned, and deployed to every org through one pipeline. Regions keep only what is truly local (tax formats, market lists). Whether the three orgs later merge into one is a separate decision; a shared core makes either path cheaper.', '',
  '```mermaid',
  'flowchart TB',
  '  subgraph Core["Global core (one source, one pipeline)"]',
  '    DM["Data model:<br/>customer, product, visit,<br/>promotion, order"]',
  '    STD["Standard features:<br/>Consumer Goods Cloud,<br/>Sales Cloud, TPM"]',
  '    CFG["Configuration:<br/>approvals, roll-ups,<br/>global value sets"]',
  '  end',
  '  subgraph Orgs["Regional orgs"]',
  ...orgs.map((o) => `    T${o.region}["${o.label}<br/>local: tax rules, markets"]`),
  '  end',
  '  Core -- "CI/CD deploy" --> Orgs',
  '  subgraph Int["Integration layer"]',
  '    API["APIs with named credentials"]',
  '  end',
  '  Orgs <--> API',
  '  API <--> ERP[("ERP:<br/>orders, credit")]',
  '  API <--> DIST[("Distributor feeds:<br/>stock, claims")]',
  '  MDM[("Master data:<br/>customers, products")] --> API',
  '  Orgs --> AN["Cross-region reporting"]',
  '```', '',
  '## What moves where', '',
  table(['Verdict', 'Goes to', 'Components'], VERDICTS.map((v) => [V[v], { adopt: 'Standard features in the global core', configure: 'Configuration in the global core', keep: 'Custom, built once in the global core', retire: 'Removed before the move', review: 'Workshop agenda' }[v], items.filter((i) => i.verdict === v).length])), '',
].join('\n');

/* ---------------------------------------------------------------- write */

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'fit-gap.json'), `${JSON.stringify(fitGap, null, 2)}\n`);
fs.writeFileSync(path.join(DIR, 'assessment-report.md'), report);
fs.writeFileSync(path.join(DIR, 'architecture.md'), architecture);

const bundle = { ...fitGap, report, architecture };
// On the Org Compiler server the bundle is a file served to the console; in the repository it is embedded in it.
if (process.env.BUNDLE_DIR) fs.writeFileSync(path.join(process.env.BUNDLE_DIR, 'assessment-bundle.json'), JSON.stringify(bundle));
else if (fs.existsSync(P.CONSOLE)) {
  let html = fs.readFileSync(P.CONSOLE, 'utf8');
  const a = html.indexOf('/*ASSESS-START*/'), b = html.indexOf('/*ASSESS-END*/');
  if (a >= 0 && b > a) {
    html = html.slice(0, a + 16) + JSON.stringify(bundle).replace(/<\//g, '<\\/') + html.slice(b);
    fs.writeFileSync(P.CONSOLE, html);
  }
}
console.log(`assessment: ${extracted.length}/${orgs.length} orgs, ${total} components classified (${VERDICTS.map((v) => `${v} ${items.filter((i) => i.verdict === v).length}`).join(', ')}), ${capabilityMatrix.length} capabilities -> ${P.rel(DIR)}`);
