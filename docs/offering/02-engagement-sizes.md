# Engagement Sizes

Owner: Ascendion engagement team · Status: draft for discussion · illustrative figures

Three engagement models. The size is proposed from the questionnaire in section 4 before the assessment, and
confirmed or changed at gate A0 using the measured inventory and the share of components the automation could
handle without manual rework. Figures are illustrative and not a quotation.

## 1. Size parameters

| Parameter | Small | Medium | Large |
|---|---|---|---|
| Salesforce orgs | 2-3 | 4-6 | 7 or more |
| Markets / countries | up to 5 | 6-15 | 16 or more |
| Users (all orgs) | up to 1,000 | 1,000-5,000 | over 5,000 |
| Custom objects (all orgs) | up to 75 | 76-250 | over 250 |
| Lines of Apex (all orgs) | up to 25,000 | 25,000-100,000 | over 100,000 |
| Integrations (inbound and outbound) | up to 10 | 11-30 | over 30 |
| Data volume (records / files) | up to 10M / 0.5 TB | 10M-100M / 0.5-5 TB | over 100M / over 5 TB |
| Managed packages in use | up to 5 | 6-15 | over 15 |
| Waves (business domains) | 1-2 | 3-4 | 5-8 |

## 2. Duration in weeks per phase

Migrate overlaps Build and Validate, so it does not add to the elapsed total. Go-live includes the shadow run
and the domain-by-domain cutover.

| Phase | Small | Medium | Large |
|---|---|---|---|
| 0 Assess (fixed price) | 3 | 4 | 6 |
| 1 Discover | 2 | 3 | 4 |
| 2 Design | 3 | 5 | 8 |
| 3 Build | 6 | 10 | 16 |
| 4 Migrate (overlapping) | 4 | 8 | 14 |
| 5 Validate | 3 | 6 | 10 |
| 6 Go-live | 2 | 6 | 12 |
| Hypercare | 4 | 6 | 8 |
| **Elapsed total** | **23 weeks** | **40 weeks** | **64 weeks** |

## 3. Team shape and effort

Effort is average Ascendion FTE in the phase multiplied by its weeks. Client effort is not included.

| Phase | Small: FTE x weeks = person-weeks | Medium: FTE x weeks = person-weeks | Large: FTE x weeks = person-weeks |
|---|---|---|---|
| 0 Assess | 4 x 3 = 12 | 6 x 4 = 24 | 9 x 6 = 54 |
| 1 Discover | 5 x 2 = 10 | 8 x 3 = 24 | 12 x 4 = 48 |
| 2 Design | 6 x 3 = 18 | 10 x 5 = 50 | 16 x 8 = 128 |
| 3 Build | 9 x 6 = 54 | 16 x 10 = 160 | 26 x 16 = 416 |
| 4 Migrate (additional data team) | 2 x 4 = 8 | 4 x 8 = 32 | 7 x 14 = 98 |
| 5 Validate | 7 x 3 = 21 | 13 x 6 = 78 | 22 x 10 = 220 |
| 6 Go-live | 7 x 2 = 14 | 11 x 6 = 66 | 18 x 12 = 216 |
| Hypercare | 3 x 4 = 12 | 5 x 6 = 30 | 8 x 8 = 64 |
| **Total effort** | **149 person-weeks** | **464 person-weeks** | **1,244 person-weeks** |
| Peak team (Build plus Migrate) | 11 | 20 | 33 |
| Of which assessment (fixed price) | 12 | 24 | 54 |

Role-by-role allocation per size is in [03-team-and-roles.md](03-team-and-roles.md), section 2.

## 4. Sizing questionnaire

Score each parameter 1, 2 or 3 from the client's answers, then add the scores.

| # | Question to the client | 1 point | 2 points | 3 points |
|---|---|---|---|---|
| 1 | How many Salesforce orgs are in scope? | 2-3 | 4-6 | 7+ |
| 2 | How many markets or countries use them? | up to 5 | 6-15 | 16+ |
| 3 | How many active users in total? | up to 1,000 | 1,000-5,000 | 5,000+ |
| 4 | How many custom objects in total? | up to 75 | 76-250 | 250+ |
| 5 | Approximate lines of Apex in total? | up to 25k | 25k-100k | 100k+ |
| 6 | How many systems integrate with Salesforce? | up to 10 | 11-30 | 30+ |
| 7 | Total records / file storage? | up to 10M / 0.5 TB | 10M-100M / 0.5-5 TB | 100M+ / 5 TB+ |
| 8 | How many managed packages are in use? | up to 5 | 6-15 | 15+ |

| Total score | Proposed size |
|---|---|
| 8-12 | Small |
| 13-19 | Medium |
| 20-24 | Large |

Override rules:

- Any single parameter at 3 points moves a Small to at least Medium.
- Shield Platform Encryption, regulated personal data across borders, or more than one ERP instance adds one
  size step to Design and Migrate only.
- If the client cannot answer questions 4, 5 or 8, propose the Assess phase alone and size the rest at gate A0.

## 5. What changes the estimate at gate A0

- Share of validation rules and flows that the automation translates without manual rework (the reference plan
  targets at least 90% of validation rules and 60% of flows).
- Number of managed packages that must be rebuilt rather than replaced or retained.
- Number of reports and dashboards that must be re-pointed.
- Volume of files and history that must move, and the API limits of each org.
- Number of review items left open after the assessment workshops.
