# Offering Overview

Owner: Ascendion engagement team · Status: draft for discussion · illustrative figures

## 1. The problem

Brightwell Consumer Goods (illustrative) runs Salesforce in several regions, each in its own org. Over the years
the orgs have drifted apart:

- **Same capability, built several ways.** Visit planning, order capture, promotions and account hierarchies are
  each implemented differently per region, often as custom objects, flows and Apex rather than standard features.
- **Heavy custom build.** Much of what was built predates, or duplicates, standard Salesforce and Consumer Goods
  Cloud features. Every release must be regression-tested across all of it.
- **Licence and run cost.** Each org carries its own licences, managed packages, admins, release process and
  integrations to the ERP. Cost grows with every region, while reporting across regions needs manual work.
- **No single view of what exists.** Nobody can say with evidence which custom components are used, which
  duplicate a standard feature, and which are unique to one market.

## 2. Outcomes

| Outcome | How it is evidenced |
|---|---|
| A fact base of every org | As-is report per org: components, counts, fill rates, markets (no record contents) |
| A decision per custom component | Fit-gap register: adopt standard, replace with configuration, keep and harmonise, retire, or review |
| A target agreed by the business | Signed-off target design and wave plan per business domain |
| Custom modules moved to the client's cloud | Modules rebuilt on the client's cloud, records loaded with Salesforce IDs kept |
| Proof before switch-over | Parity report: calculated values and rule outcomes compared with Salesforce |
| Lower run cost | Licence and package reduction plan, executed at renewal dates |

## 3. Scope

The initial offer is Discovery only (the first two items below), at a fixed price; its scope, deliverables and
timeline are in [06-discovery-offer.md](06-discovery-offer.md). The remaining items are proposed after the
Discovery readout.

**In scope**

- Read-only Discovery and assessment of all agreed Salesforce orgs (production plus one full sandbox each)
- Fit-gap of custom build against standard Salesforce and Consumer Goods Cloud features the client is licensed for
- Cross-org comparison, capability by capability, and target design
- For modules marked to move: rebuild on the client's cloud (database, business rules, security, services),
  data migration, parity validation, cutover by domain
- For capabilities that stay on Salesforce: harmonisation design and adoption of standard features (build effort
  sized separately where large)
- Integration re-pointing for systems that call Salesforce, including the ERP
- Testing, training, cutover and hypercare

Exclusions are listed in [04-commercials-and-assumptions.md](04-commercials-and-assumptions.md), section 6.

## 4. How the work is done

Automation does the repetitive reading and generation; people make every decision.

- **Read-only extraction.** Scripts read each org through the Salesforce CLI and APIs (metadata, describe calls,
  record counts, Tooling API). Nothing is written to the client's orgs.
- **Deterministic generation.** Most outputs (inventory, model, database schema, security, load scripts) are
  produced by generators that give the same output for the same input, so results are repeatable and reviewable.
- **Reviewed proposals.** Where a proposal step is used (Apex translation, fixes after a failed check), its
  output is marked unreviewed until a named person approves it, and it is then re-tested.
- **Review gates.** Each phase ends with a gate. The reviewer approves, rejects with a comment (the phase
  re-runs), or stops. Every decision is recorded with reviewer, time and comment.
- **Handover and removal.** Approved artifacts are pushed to the client's git, and removed from Ascendion's side
  with a dated deletion certificate (see [06-discovery-offer.md](06-discovery-offer.md), section 6).

The automation has been proven on a reference module in a demonstration org (see `docs/client-pack/`). It has
not yet been run against a full enterprise org, so the first client's Discovery, starting with a pilot on one
org, also calibrates the estimates.

## 5. Phases, deliverables and gates

| Phase | Question | Main deliverables | Gate |
|---|---|---|---|
| 1a Discover: Discovery and assessment (initial offer) | What do the orgs contain, and what should happen to each part? | 13 discovery documents per org; Discovery explorer; assessment report with cross-org comparison; fit-gap register; workshop list; target direction; re-baselined estimate | A0 Discovery sign-off (go / re-scope / stop) |
| 1b Discover: wave discovery | What exactly is in scope for this wave? | Inventory detail for the wave; gap register (what Salesforce does not hand over) with owner and route; managed-package decisions for the wave | G1 Inventory complete, every gap item owned |
| 2 Design | What does it mean, and what replaces it? | Platform-independent model; HLD and LLD; decisions (ADRs); package decisions; wave and cutover plan | G2 Design approved by architecture and business |
| 3 Build | Build the replacement | Database schema, business rules, translated Apex (reviewed), security and access, services; integration credentials checklist | G3 Generated and translated code reviewed, tests pass |
| 4 Migrate | How does the data move? | Load plan in dependency order; history archive; loaded target with Salesforce IDs kept; reconciliation report | G4 Counts and checksums reconcile per object |
| 5 Validate | Does it behave the same? | Parity report against Salesforce; platform-behaviour cases; repair log; UAT sign-off | G5 Parity thresholds met, UAT signed |
| 6 Go-live | How does it go live? | CI/CD release; shadow run; reporting first; module switch per domain; rehearsed rollback; cutover checklist | G6 Cutover checklist signed per domain |
| Hypercare | Is it stable? | Incident log and fixes; run-book handover; decommission and licence reduction plan | Exit: agreed stability criteria met |

Phase 1a runs once for all orgs. Phases 1b to 6 repeat per wave (one business domain or group of domains per wave). Migrate runs alongside Build
and Validate; Go-live proceeds domain by domain, with Salesforce kept read-only for a domain until it has moved.

## 6. What the client reviews at each gate

| Gate | Client reviewer | Typical checks |
|---|---|---|
| A0 | Product owner, regional business leads, IT | Discovery documents per org reviewed; every org extracted or its absence explained; markets match the agreed list; adopt-standard verdicts name a licensed feature; retire candidates confirmed unused; review items on the workshop agenda |
| G1 | Product owner, IT security | Inventory complete for the wave; packages in use and owners named; integrations listed; retention rules agreed |
| G2 | Architecture board, ERP owner | Target design, data residency, package and integration decisions |
| G3 | IT security, client developers | Access model, credentials checklist, code review outcomes |
| G4 | Data owners, finance | Reconciliation per object; history archive; currency and date handling |
| G5 | Regional business leads | Parity results; UAT outcome; open defects accepted or fixed |
| G6 | Product owner, operations | Freeze window, rollback rehearsal, cutover checklist, licence renewal date |
