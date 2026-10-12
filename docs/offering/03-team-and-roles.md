# Team and Roles

Owner: Ascendion engagement team · Status: draft for discussion · illustrative figures

## 1. Ascendion roles

Phases: A = Discovery and assessment (phase 1a, the initial offer), D = wave discovery (phase 1b), Ds = Design, B = Build, M = Migrate, V = Validate, G = Go-live, H = Hypercare.

| Role | Responsibilities | Phases |
|---|---|---|
| Engagement lead | Single point of accountability; steering committee; commercial and scope control; chairs gate reviews | All |
| Solution architect | End-to-end target architecture; route per capability (adopt standard, harmonise, move to client cloud, retire); design authority at G2 | A, D, Ds, B, V, G |
| Salesforce technical architect | Org analysis, Apex and flow review, metadata harmonisation, managed-package decisions, Salesforce-side cutover (read-only switch, licence reduction) | A, D, Ds, B, V, G |
| Consumer Goods Cloud functional consultant | Maps custom build to standard Consumer Goods Cloud features (visits, retail execution, orders, promotions); runs fit-gap workshops with regional leads; UAT scenarios | A, Ds, B, V |
| Data migration lead | Data strategy, load order, history archive, reconciliation, cutover delta and freeze plan; owns G4 | A, D, Ds, M, V, G |
| Integration architect | Inventory of inbound and outbound callers; ERP and middleware re-pointing; transition interface during the move; credential renewal plan | A, D, Ds, B, V, G |
| Platform / cloud engineer | Target environments on the client's cloud, infrastructure as code, CI/CD pipeline, monitoring, backup and recovery | Ds, B, M, V, G, H |
| QA / test lead | Test strategy, parity thresholds, regression and performance tests, UAT coordination; owns G5 evidence | Ds, B, V, G, H |
| Change and training lead | Stakeholder map, communications, training material per market, admin transition from point-and-click to pull requests | A, Ds, V, G, H |
| PMO | Plan, RAID log, gate scheduling, status reporting, resource and dependency tracking | All |
| Agent operations / automation engineer | Configures and runs the assessment and migration automation against each org; manages read-only access, run records and gate evidence; maintains generator rules and templates; triages failed checks | All |
| Developers (pool) | Review and complete generated code and translated Apex; build what automation does not cover; fix defects | B, V, G, H |
| Data engineers (pool) | Extraction at volume, partitioned loads, change capture until cutover, reconciliation scripts | M, V, G |

## 2. Allocation per size (peak, during Build and Migrate)

Values are FTE. Where a role has more than one person, the number is headcount x FTE.

| Role | Small | Medium | Large |
|---|---|---|---|
| Engagement lead | 0.5 | 1.0 | 1.0 |
| Solution architect | 1.0 | 1.0 | 2 x 1.0 |
| Salesforce technical architect | 1.0 | 2 x 1.0 | 3 x 1.0 |
| Consumer Goods Cloud functional consultant | 0.5 | 1.0 | 2 x 1.0 |
| Data migration lead | 1.0 | 1.0 | 1.0 |
| Integration architect | 0.5 | 1.0 | 2 x 1.0 |
| Platform / cloud engineer | 1.0 | 2 x 1.0 | 3 x 1.0 |
| QA / test lead and testers | 1.0 | 2 x 1.0 | 4 x 1.0 |
| Change and training lead | 0.5 | 1.0 | 2 x 1.0 |
| PMO | 0.5 | 1.0 | 2 x 1.0 |
| Agent operations / automation engineer | 1.0 | 1.0 | 2 x 1.0 |
| Developers | 2 x 1.0 | 4 x 1.0 | 6 x 1.0 |
| Data engineers | 0.5 | 2 x 1.0 | 3 x 1.0 |
| **Peak team (FTE)** | **11** | **20** | **33** |

Discovery team (phase 1a, the initial offer): engagement lead, solution architect, Salesforce technical
architect, Consumer Goods Cloud functional consultant and agent operations engineer, with data migration and
integration leads part-time in Medium and Large. Average FTE is 4 / 6 / 9 for Small / Medium / Large, plus week 0
setup support of 1 / 1 / 2 person-weeks, giving 13 / 25 / 56 person-weeks. The FTE per role is in
[06-discovery-offer.md](06-discovery-offer.md), section 3.2.

## 3. Onshore / offshore split

| Role | Onshore (client region) | Offshore |
|---|---|---|
| Engagement lead | 100% | 0% |
| Solution architect | 70% | 30% |
| Salesforce technical architect | 40% | 60% |
| Consumer Goods Cloud functional consultant | 70% | 30% |
| Data migration lead | 50% | 50% |
| Integration architect | 50% | 50% |
| Platform / cloud engineer | 20% | 80% |
| QA / test lead and testers | 20% | 80% |
| Change and training lead | 80% | 20% |
| PMO | 50% | 50% |
| Agent operations / automation engineer | 20% | 80% |
| Developers and data engineers | 0% | 100% |
| **Blended, by effort** | **about 30%** | **about 70%** |

Onshore presence is weighted to workshops, gate reviews, UAT and cutover weekends. The split is adjusted where
data residency or client policy requires work on client data to stay in region.

## 4. Client-side roles

| Client role | Responsibilities | Indicative time |
|---|---|---|
| Product owner | Owns scope and priorities; approves gates A0 to G6; resolves cross-region conflicts | 50-100% |
| Regional business leads (one per market or region) | Confirm how each region works today; decide harmonise or keep; confirm retire candidates; UAT sign-off | 10-20%, higher in Discovery workshops and Validate |
| IT security | Read-only access to orgs (integration user, OAuth app, network rules, vault); data classification; countersigns the Discovery deletion certificate; data protection and residency decisions; access model and credentials review | 10-20%, higher in Discovery week 0 |
| ERP owner | ERP interface contracts, test environments, cutover coordination for orders and master data | 10-30% |
| Enterprise / cloud architect | Target landing zone, standards, network and identity integration | 10-20% |
| Salesforce administrators (per org) | Org knowledge, sandbox refreshes, transition to the new release process | 20-50% |
| Data owners and finance | Data quality decisions, retention rules, reconciliation sign-off | 5-10%, higher in Migrate |
| Procurement / licence owner | Salesforce and package contracts, renewal dates, licence reduction | As needed |
