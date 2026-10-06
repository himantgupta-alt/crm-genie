# CRM Genie (POC)

Proof of concept: the Subscription module from our Salesforce Developer org, moved to PostgreSQL and a small Node.js web app on Azure.

## Contents

| Folder | What it holds |
|---|---|
| `agents/` | Workflow definition, agent catalog, prompts for the LLM agents, and the runner (`agents/README.md`) |
| `sf-extract/scripts/` | Extraction from Salesforce, blueprint builder, SQL generator |
| `sf-extract/output/` | Extracted schema, rules and the data used for testing |
| `sf-extract/output/inventory/` | What metadata cannot carry (packages, integrations, jobs, usage, retention) and `gap-register.md` |
| `sf-extract/blueprint/` | Intermediate model of the org (generated) |
| `sf-extract/target/db/` | Generated PostgreSQL schema (generated) |
| `sf-extract/target/app/` | Web app (Express + pg) |
| `sf-extract/target/parity/` | Checks that compare results with the Salesforce data |
| `sf-extract/target/infra/` | Azure deployment (Bicep and PowerShell) |
| `sf-extract/demo/` | Migration console used in demos |

## Status

Migrated: Subscription and Subscription Line objects, their formulas and roll-ups, six validation rules, one Apex method (`applyDefaults`), profile and permission set access.

Not migrated yet: the flow and Apex that create Tasks, the Opportunity-to-Subscription logic, and the nightly renewal job.

## Checks and deployment

Every push to `main` runs `.github/workflows/crm-genie.yml`: unit tests, blueprint and SQL regeneration (must match what is committed), a comparison against the Salesforce data, and an app smoke test. If they pass, the app is deployed to Azure App Service.

To run the same checks locally:

```
cd sf-extract/target
npm ci
node parity/run.js
node parity/app-smoke.mjs
```

Azure setup and other working notes are in `sf-extract/HANDOFF.md`.
