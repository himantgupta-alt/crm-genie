# Testing standards

Owner: Engineering standards · used by the Verification and Repair agents and by CI.

| Layer | What it proves | Where | Blocks release |
|---|---|---|---|
| Unit | Parsers and compilers behave (formula parser, SQL expression compiler) | `src/generators/test/` | yes |
| Contract | The blueprint matches its schema and has no dangling references | `validate-blueprint.js` | yes |
| Regeneration | Same inputs give the committed outputs (blueprint, SQL, documents, index) | CI "regenerate and diff" steps | yes |
| Golden master (parity) | Every calculated value matches what Salesforce stored; every rule case gives Salesforce's outcome | `src/verification/run.js` | yes |
| Security parity | Each role can read and edit exactly what the org allows | `security.*` cases in `cases.json` | yes |
| Smoke | The deployed app signs in, reads, writes and enforces rules | `src/verification/app-smoke.mjs` | yes |
| Conventions | Layout, headers, secrets and personal-data rules | `check-conventions.js` | yes |

## Rules

- **Salesforce is the oracle.** Expected values come from the org's own data or its own Apex tests, not from
  what we think the answer should be.
- **Every behaviour gets a case.** A new rule, automation or platform behaviour is not done until a parity case covers it.
- **Deterministic tests.** In-memory PostgreSQL (PGlite), fixed data, `app.today()` pinned to the export date.
- **A failing case is a defect, not noise.** It goes to the Repair agent, whose fix targets the generator, never the output.
- **Pending is visible.** Cases not yet implementable are reported as pending, never deleted.
