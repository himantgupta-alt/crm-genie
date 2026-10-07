# Test plan

Owner: Testing · written by hand; reviewed at the Validate gate (G5).

## Scope

The Subscription domain (Subscription, Subscription Line) with its reference objects (Account, Contact,
Opportunity, Product), as listed in `adlc/3-build/manifest.json`. Out of scope until their families move:
Task-creating automations, the Opportunity-to-Subscription service, the renewal job (pending cases).

## Levels

| Level | Assets | Automated | Blocks release |
|---|---|---|---|
| Unit and contract | `src/generators/test/`, blueprint schema | yes | yes |
| Functional | `functional/test-cases.md` | yes (parity cases) | yes |
| Data reconciliation | `data-reconciliation/checks.md` | yes | yes |
| Security | `security/access-matrix.csv` | partly (`security.*` cases) | yes |
| Smoke | `src/verification/app-smoke.mjs` | yes | yes |
| User acceptance | `uat/scenarios.md` | no, signed by business users | before go-live |
| Agent quality | `agent-evals/` | partly | before an agent change is adopted |

## Entry and exit criteria

- **Entry:** blueprint validates; SQL generated; data loaded with zero rejected rows.
- **Exit (per domain):** all automated cases pass; every calculated value matches Salesforce; no open P1
  defects; security matrix confirmed; UAT signed off; coverage gaps accepted in writing.

## Environments

- **CI:** in-memory PostgreSQL (PGlite) with the exported data; runs on every push.
- **Shared test:** the Azure environment (`adlc/6-go-live/infra`), loaded with `load_db.ps1`.
- **Side-by-side:** Salesforce and the new system in parallel before cutover; differences become new cases.

## Defects

- A failing automated case is logged with its parity case ID and goes to the Repair agent; fixes target the
  generator, never the output, and are approved at the gate.
- Priority: P1 wrong data, wrong access or a broken rule; P2 wrong behaviour with a workaround; P3 cosmetic.

## Metrics

Cases passed / total, values matched / total, elements covered / in scope (`coverage.md`), open defects by
priority, repair attempts per defect.
