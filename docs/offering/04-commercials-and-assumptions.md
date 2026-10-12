# Commercials and Assumptions

Owner: Ascendion engagement team · Status: draft for discussion · illustrative figures

No rates or prices are stated in this document. Effort is in person-weeks (see
[02-engagement-sizes.md](02-engagement-sizes.md)); rates are per the Ascendion rate card and shown as [rate].

## 1. Commercial models

| Stage | Model | Basis | Notes |
|---|---|---|---|
| 1a Discover: Discovery and assessment (initial offer) | Fixed price | S 13 / M 25 / L 56 person-weeks x [blended rate] | Fixed deliverables and duration (see [06-discovery-offer.md](06-discovery-offer.md)); ends at gate A0 with a re-baselined estimate |
| Delivery, option 1 | Time and materials | Actual effort x [role rate] per Ascendion rate card | Suits uncertain scope; capped per phase with change control |
| Delivery, option 2 | Capacity-based | Agreed team (pod) per quarter x [pod rate] | Suits multi-wave programmes; backlog prioritised by the product owner |
| Delivery, optional | Milestone holdback | [x]% of each phase's fees released at its gate | Ties payment to gate acceptance |
| Hypercare | Fixed duration | S 4 / M 6 / L 8 weeks at agreed team size x [rate] | Can roll into a managed-service agreement |

Expenses, travel and third-party licences are charged as [per agreement].

## 2. Assumptions

- The client provides read-only access to each org (production and a full sandbox) through an integration user,
  OAuth app, network rules and runner during week 0, before Discovery week 1 (checklist in
  [06-discovery-offer.md](06-discovery-offer.md), section 4.4).
- Salesforce API limits allow extraction within the planned windows; additional limits are purchased if needed.
- One target cloud and one landing zone, provided or approved by the client before Build.
- The client's licences for the standard features named in adopt-standard verdicts are in place or on the
  workshop agenda.
- Gate reviews happen within five working days of the request.
- Regional business leads are available for Discovery workshops and UAT as planned.
- Test data and environments for each integrated system, including the ERP, are available in Build.
- Durations assume the size bands in [02-engagement-sizes.md](02-engagement-sizes.md); a different measured size at
  gate A0 triggers re-estimation.

## 3. Dependencies

| Dependency | Owner | Needed by |
|---|---|---|
| Org access, integration user, OAuth app, runner | IT security | Discovery, week 0 |
| Market list and capability priorities | Product owner | Discovery, week 0 |
| Licence and package contracts, renewal dates | Procurement | Discovery, week 2 |
| Target landing zone, network, identity | Enterprise / cloud architect | Design |
| ERP and middleware test environments | ERP owner | Build |
| Client git repository, vault and data classification of Discovery outputs | IT security, engineering | Discovery, week 0 |
| Data retention and residency decisions | Data owners, legal | Wave discovery (1b) |
| Freeze windows per domain | Product owner, regional leads | Go-live planning |

## 4. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Managed-package source cannot be retrieved | Rebuild effort higher than estimated | Package settings exported as data; behaviour captured as tests; rebuild, replace or retain decided per package at G2 |
| Translation rate below plan for Apex and flows | Build effort rises | Measured in Discovery; estimate re-baselined at A0; repeat patterns added to generator rules |
| Large data volume and API limits | Migrate overruns | Bulk extraction in partitions; change capture to stay in sync; history archive started in week one |
| Dirty or inconsistent historical data | Reconciliation failures | Loader flags, not drops, failing rows; data owners decide at G4 |
| Systems calling Salesforce not all known | Outage at cutover | Login history per application and integration user; transition interface until each caller moves |
| Regions disagree on a harmonised process | Design delays | Decision rights agreed at kickoff; product owner arbitrates; open items tracked on the workshop list |
| Admin and user adoption | Benefits not realised | Change and training lead from Discovery; reporting moved first so numbers are trusted |
| Licence renewal falls mid-programme | Paying for both platforms | Wave plan aligned to renewal dates; reduce seats per domain |
| Automation unproven at full enterprise scale | Estimates less certain | Fixed-price Discovery, starting with a pilot on one client sandbox, calibrates them before delivery is committed |
| Access lead time, API limits, metadata not exposed | Discovery starts late or is incomplete | See [06-discovery-offer.md](06-discovery-offer.md), section 7.3 |

## 5. Change control

Changes to scope, size band or assumptions are raised as change requests with effort impact in person-weeks and
approved by the product owner and engagement lead before work starts.

## 6. Out of scope

- New functionality beyond what exists today, unless agreed by change request
- Salesforce and third-party licence costs and negotiation
- Re-implementation of the ERP or middleware platforms themselves
- Rebuilding managed-package functionality where the decision is to replace with another product (selection
  support only)
- Data cleansing beyond flagging and agreed rules; business data remediation is a client activity
- Translation of training material into local languages (unless agreed)
- Ongoing run and support after hypercare (available as a separate managed service)
- Content and records outside the agreed orgs (email archives, file shares)

## 7. Acceptance criteria per phase

| Phase | Accepted when |
|---|---|
| 1a Discovery and assessment | Every agreed org extracted or its absence explained; the 13 discovery documents per org and the explorer passed the review gate; every custom component has a verdict and a reason; markets match the agreed list; workshop list closed or owned; re-baselined estimate presented; handover and deletion certificate complete |
| 1b Wave discovery | Inventory complete for the wave; every gap-register item has an owner and a route |
| 2 Design | HLD, LLD and decisions approved by the architecture board; package and integration routes agreed; wave plan signed |
| 3 Build | All generated and translated code reviewed; unit and conventions checks pass; access model approved by IT security |
| 4 Migrate | Row counts and ID checksums reconcile per object; sampled field comparisons pass; history archive loaded |
| 5 Validate | Parity results meet agreed thresholds; no open severity 1 or 2 defects; UAT signed by regional leads |
| 6 Go-live | Cutover checklist signed per domain; rollback rehearsed; Salesforce read-only for moved domains |
| Hypercare | No open severity 1 incidents for [n] consecutive weeks; run book handed over; licence reduction plan agreed |
