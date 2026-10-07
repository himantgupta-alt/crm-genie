# Evals

Owner: Testing (with the Verification agent) · the test assets testing teams use from the first day of an
engagement. Most files here are generated from the blueprint and parity cases by
`src/generators/emit-evals.js`, so they stay in step with the system; [test-plan.md](test-plan.md) is written by hand.

| Folder | What it is | Who uses it |
|---|---|---|
| [functional/](functional/test-cases.md) | Every behaviour as a numbered test case with steps and expected results (also as CSV for test tools) | QA engineers |
| [data-reconciliation/](data-reconciliation/checks.md) | Row counts, Salesforce IDs and every calculated field checked against the org | Data and QA teams |
| [security/](security/README.md) | Expected access per role and object, from the org's profiles and permission sets | Security testers |
| [uat/](uat/scenarios.md) | Business scenarios in Given/When/Then with a sign-off line | Business users |
| [agent-evals/](agent-evals/README.md) | Golden sets and seeded faults that measure the AI agents themselves, with a reviewer rubric | AI/platform team |
| [traceability.csv](traceability.csv), [coverage.md](coverage.md) | Each Salesforce element linked to its tests; what has no test yet | Test managers |

## How tests run

- **Automated:** `node src/verification/run.js` runs every automated case and compares every calculated value
  with Salesforce's own; `node src/verification/app-smoke.mjs` tests the running app. Both run in CI on every
  change and block release on failure.
- **Manual:** functional cases and UAT scenarios can be run in the app by hand; the CSV imports into test
  management tools.
- **Adding a test:** add a case to `adlc/5-validate/verification/cases.json` and re-run `emit-evals.js`; the
  catalogue, traceability and coverage update themselves.

Standards: [`../kb/testing-standards.md`](../kb/testing-standards.md).
