# CRM Genie (POC)

Proof of concept: the Subscription module from our Salesforce Developer org, moved to PostgreSQL and a small
Node.js web app on Azure by a workflow of agents, with a review gate after every phase.

## Layout

| Folder | What it holds |
|---|---|
| [`adlc/`](adlc/README.md) | **Everything the agents produce**, one folder per phase and agent, each with a generated README |
| `adlc/1-discover/extraction/` | Org metadata, schema, rules, data, inventory and gap register |
| `adlc/2-design/modelling/` | Blueprint, design documents (HLD, LLD, ADRs, diagrams), vendor packages |
| `adlc/3-build/schema · logic · security/` | Numbered SQL migrations, Apex translations, credentials checklist |
| `adlc/4-migrate/data-load/` | History archive plan, work in progress at go-live |
| `adlc/5-validate/verification · repair/` | Parity cases and report, platform behaviour, repair proposals |
| `adlc/6-go-live/` | Infrastructure as code (Bicep, PowerShell); the pipeline is in `.github/workflows/` |
| `src/` | The code: `paths.js`, `generators/`, `agents/`, `app/`, `verification/`, `console/`, `salesforce-seed/` |
| `docs/` | Working notes (`HANDOFF.md`) and the rollout plan |
| `presentations/` | The approach deck |

Conventions and patterns: [`src/CONVENTIONS.md`](src/CONVENTIONS.md). Design: [HLD](adlc/2-design/modelling/design/HLD.md),
[LLD](adlc/2-design/modelling/design/LLD.md), [ADRs](adlc/2-design/modelling/design/adr/README.md).

## Status

Migrated: Subscription and Subscription Line, their formulas and roll-ups, six validation rules, one Apex method
(`applyDefaults`), profile and permission set access.

Not migrated yet: the flow and Apex that create Tasks, the Opportunity-to-Subscription logic, and the nightly
renewal job.

## Checks and deployment

Every push to `main` runs `.github/workflows/crm-genie.yml`: unit tests; blueprint, SQL, document and index
regeneration (must match what is committed); the conventions check; a comparison against the Salesforce data;
and an app smoke test. If they pass, the app is deployed to Azure App Service.

To run the same checks locally (from the repository root):

```
node --test "src/generators/test/*.test.js"
node src/generators/normalise-blueprint.js && node src/generators/validate-blueprint.js
node src/generators/emit-postgres.js && node src/generators/emit-cutover.js
node src/generators/emit-docs.js && node src/generators/emit-adlc-index.js
node src/generators/check-conventions.js
cd src/verification && npm ci && node run.js && node app-smoke.mjs
```

Agents: `cd src/agents && npm install && node run.js --list`. Azure setup and other notes: `docs/HANDOFF.md`.
