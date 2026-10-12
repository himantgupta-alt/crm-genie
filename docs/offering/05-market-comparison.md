# Market Comparison

Owner: Ascendion engagement team · Status: draft for discussion · illustrative figures

A summary of how comparable offerings are packaged, based on public web pages opened on 2026-10-12. Public pages
describe marketing packaging only; actual engagements may differ. Where a page did not state something, it is
marked "not stated".

## 1. Comparable offerings

| Category | Provider and offering | Packaging (as published) | Duration (as published) |
|---|---|---|---|
| Org health / assessment | Salesforce, Org Health Assessment page (content describes an Annual Technical Health Review) | Technical analysis of the environment with recommendations; included in the Signature Success Plan | Not stated on the page opened |
| Org health / assessment | Techforce Services, Salesforce Health Check | Three steps (exploration, diagnosis, recommendations); covers reports, automation, code, security, performance, data quality; delivers an org health score, prioritised issues and a phased remediation roadmap; pricing not stated | 1-3 weeks |
| Org health / assessment | VALiNTRY360, Salesforce Health Check | 48-hour mini-scan or full audit; eight-dimension scorecard, risk register, code and data quality summaries, 30/60/90-day roadmap; pricing not stated | Full audit 8-10 business days |
| Org consolidation / merge | Techila Global Services, Salesforce Org Consolidation | Five phases: discover and assess, design target org, migrate and merge, rehearse and cut over, rationalise and run; architect sign-off on each merge / migrate / retire call; complimentary initial audit | Initial audit within 15 days; full engagement not stated |
| Org consolidation / merge | Ateko, Org Mergers and Migrations | Four components: merger assessment, multi-org strategy and roadmap, implementation, post-merger support | Not stated |
| Org merge tooling | Metazoa Snapshot (product) | Metadata deployment across many metadata types, data migration with external-ID matching, dependency analysis; recommends a six-step merge process | Product, not a service |
| Multi-org tooling | Odaseva (blog on splitting and stitching orgs) | Tooling and approach for splitting, "stitching" to a shared core model, and merging orgs; business-intent driven | Not stated |
| Consumer Goods Cloud package | Cloud Creations, Consumer Goods Accelerator | Fixed-price quick start: kickoff and process review, accounts and contacts, retail stores and product categories, visit planning, maps with limited routes, one training webinar | About 8 weeks |
| Consumer Goods Cloud implementation | Cloud Odyssey, Consumer Goods Cloud Implementation | Consulting, end-to-end implementation, migration and integrations (ERP, supply chain), support and maintenance; no fixed package published | Not stated |
| Consumer Goods Cloud implementation | Customertimes, CPG solutions | Outcome-based solutions (retail execution, trade promotion, orders, analytics) on Consumer Goods Cloud plus own products (offline mobile app, image recognition for shelf audits, order pricing); consultative, no fixed package published | Not stated |
| Exit / replatforming | Konversational, Replatform | Moves CRM and service workloads, including Salesforce, to ServiceNow customer service modules, standard-first rebuild; no phases or pricing published | Not stated |

Other observations from search results (pages not opened, so not cited by link): several smaller partners publish
health-check price bands in the low tens of thousands of US dollars for 2-4 weeks of work, and Salesforce
Admins announced that Salesforce Optimizer is being retired in favour of a tool called Org Check.

## 2. Patterns in how the market packages this work

- **Assessments are short and fixed.** One to four weeks, single org, ending in a scored report and a roadmap.
  They are usually sold as a door-opener to remediation work.
- **Consolidation is sold as a phased service** with an assessment front end and architect sign-off on each
  merge / migrate / retire decision, often supported by third-party metadata and data tools.
- **Consumer Goods Cloud packages are implementation-led.** Either a small fixed-price quick start with tight scope,
  or a bespoke implementation supported by the partner's own products.
- **Moving off Salesforce is offered mainly as a move to another vendor's packaged platform**, rather than to the
  client's own cloud.

## 3. What this offering does differently

Stated factually, with the limits noted.

| Area | This offering | Limit or caveat |
|---|---|---|
| Multi-org from the start | Discovery reads every agreed org with the same scripts and compares them capability by capability | Requires read-only access to every org, set up in week 0 |
| Discovery as the initial offer | A fixed-price Discovery of 3 / 4 / 6 weeks (S / M / L) with one Discovery Report (appendix per org), an interactive explorer and a fit-gap, comparable in length to the published health checks but covering every org | Week 0 access depends on the client; workshop time is not reduced by the agents |
| Client keeps the artifacts | Approved outputs are pushed to the client's git and removed from Ascendion's side with a dated deletion certificate | Hosting-provider backups expire on the provider's schedule, stated on the certificate |
| Decision per component | Every custom component gets a verdict (adopt standard, replace with configuration, keep and harmonise, retire, review) with a reason, rather than a score | Verdicts are proposals; regional leads confirm them in workshops |
| One fact base end to end | The inventory and model from Discovery feed Design, Build and Migrate directly, instead of a report that is re-analysed later | Depends on the client choosing to continue after gate A0 |
| Target can be the client's own cloud | Custom modules can be rebuilt on the client's cloud with Salesforce record IDs kept, not only moved to another packaged product | Standard capabilities are better served by adopting standard features; the offering recommends that where it fits |
| Evidence before switch-over | A parity check compares calculated values and rule outcomes with Salesforce before each domain moves | Parity covers what is captured as test cases; built-in platform behaviour is listed and tested explicitly |
| Human gates with an audit record | Each phase ends with a recorded approve / reject / stop decision; generated proposals stay unreviewed until approved | Gate turnaround depends on client reviewers |
| Repeatable runs | Most generation is deterministic, so a phase can be re-run after a change and the output compared | Proven on a reference module in a demonstration org; not yet run on a full enterprise org, which the pilot at the start of the fixed-price Discovery is designed to test |

What it does not do differently: the delivery still needs experienced architects, functional consultants, data and
integration specialists, UAT and change management. Most elapsed time goes to review, data movement, integration
re-pointing, testing and cutover, as in any comparable programme.

## Sources (opened 2026-10-12)

- https://www.salesforce.com/eu/services/success-plans/accelerators/org-health-assessment/
- https://www.techforceservices.com/salesforce-health-check-services/
- https://valintry360.com/salesforce-health-check-services
- https://techilaservices.com/services/salesforce-org-consolidation
- https://ateko.com/en/services/salesforce/org-mergers-migrations/
- https://www.metazoa.com/best-practices-salesforce-org-mergers/
- https://www.odaseva.com/blog/salesforce-multi-org-management-splitting-and-stitching-orgs/
- https://www.cloudcreations.com/quickstart/consumer-goods-quick-start-package/
- https://cloudodyssey.com/salesforce-consumer-goods-cloud-implementation-services/
- https://www.customertimes.com/industries/consumer-packaged-goods
- https://www.konversational.com/implementation/replatform
