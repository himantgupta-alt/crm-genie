# Agents

The migration runs as a workflow of eight agents in six standard transformation phases (Discover, Design, Build, Migrate,
Validate, Go-live), with a review gate after each phase.
Each agent is a folder with a spec and an entry point:

```
agents/
  workflow.json          phases, agents per phase, review gates
  run.js                 runs the workflow (node agents/run.js --list shows every agent)
  lib/claude.js          Claude client shared by the LLM agents
  extraction/            agent.json + index.js
  modelling/             agent.json + index.js
  schema/                agent.json + index.js
  logic/                 agent.json + index.js + prompt.md
  security/              agent.json + index.js
  data-load/             agent.json + index.js
  verification/          agent.json + index.js
  repair/                agent.json + index.js + prompt.md
```

`agent.json` states the agent's role, inputs, tools, outputs, completion check and what the reviewer
checks at the gate. `index.js` runs the agent and returns its status and a summary for the gate.

| Phase | Agent | Type | Calls | Produces |
|---|---|---|---|---|
| 1 Discover | Extraction | Deterministic | `src/generators/extract-schema.js`, `extract-logic.js`, `export-data.js`, `extract-inventory.js`, Salesforce CLI | `output/schema`, `output/logic`, `output/data`, `output/inventory` (gap register) |
| 2 Design | Modelling | Deterministic | `normalise-blueprint.js`, `validate-blueprint.js`, `formula.js`, `emit-docs.js` | `adlc/2-design/modelling/blueprint/blueprint.json`, `docs/HLD.md`, `docs/LLD.md` (with diagrams) |
| 3 Build | Schema | Deterministic | `emit-postgres.js --parts runtime,tables,views,rollups` | `adlc/3-build/000–030` |
| 3 Build | Logic | Claude for Apex, deterministic for rules | `logic/prompt.md`; `emit-postgres.js --parts guards,translations` | `adlc/3-build/logic/translations/`, `adlc/3-build/040–050` |
| 3 Build | Security | Deterministic | `emit-postgres.js --parts security` | `adlc/3-build/060_security.sql` |
| 4 Migrate | Data load | Deterministic | `src/app/scripts/load.js` | Loaded target database |
| 5 Validate | Verification | Deterministic | `src/verification/run.js` + `cases.json` | `src/verification/report.json` |
| 5 Validate | Repair (on failure) | Claude | `repair/prompt.md` | Proposed generator patch |
| 6 Go-live | CI/CD pipeline | Pipeline | `.github/workflows/crm-genie.yml` | App deployed to Azure App Service |

The deterministic agents do most of the work: the same input gives the same output, so results are
repeatable and reviewable. Claude is used where code must be understood and rewritten (Apex) and where a
failed check must be diagnosed. LLM output is never applied without a reviewer's approval, and every
change is then tested by the Verification agent and the pipeline.

## Running the workflow

```
cd agents && npm install
node run.js --list          # agents and what they do
node run.js                 # Design → Go-live, asks for approval at each gate
node run.js --from discover # include extraction (needs: sf org login web --alias myorg)
node run.js --to validate   # stop after a phase
node run.js --yes           # approve every gate automatically (CI)
node run.js --dry-run       # LLM agents save their prompts without calling Claude
```

LLM agents use `ANTHROPIC_API_KEY` (or an `ant auth login` profile) and the model in `AGENT_MODEL`
(default `claude-opus-5-5`). Without credentials they run as a dry run.

Each run writes `src/agents/runs/<run-id>/` (git-ignored, because it can contain org data): `run.json` with
every agent's result and every gate decision (reviewer, time, comment), and the exact prompts and
responses of the LLM agents.

## Review gates

At each gate the reviewer approves, rejects with a comment (the phase re-runs), or stops the run. Logic
agent translations are written with `"reviewed": false` until approved. A Repair agent patch is applied
with `git apply` only after approval, and only to the generator (`src/generators/`).

## Large data volumes

One process is enough for this demo org (about 400 rows). For a large org the Data load agent works as a
coordinator with parallel workers (details in `data-load/agent.json`, `scaling`):

- **Plan**: the coordinator orders objects by dependency (from the blueprint's relations) and splits each
  large object into partitions by ID range or date.
- **Extract**: Bulk API 2.0 with PK chunking, several objects in parallel within the org's API limits;
  files staged in cloud storage.
- **Load**: one worker per partition, workers at the same dependency level in parallel, PostgreSQL COPY in
  batches; write-time rules deferred during the load; indexes built afterwards; very large tables partitioned.
- **Keep in sync**: Change Data Capture or SystemModstamp watermarks apply changes until cutover; the
  final delta runs during a short write freeze per domain.
- **Reconcile**: row counts, ID checksums and sampled field comparisons per object and partition; derived
  values checked by the Verification agent.
- **Files**: attachments (ContentVersion) move separately to blob storage.

## What stays in Salesforce

A few things cannot be extracted through any Salesforce API, by design. The Extraction agent lists them
in `adlc/1-discover/extraction/inventory/gap-register.md`, with counts from the org and a planned route for each
(the same six items as slide 4 of the deck):

| Item | How it is covered | Evidence (Extraction) | Working document · owner |
|---|---|---|---|
| Vendor (managed package) code | Package settings exported as data; behaviour captured as tests; rebuild or replace agreed per package | `packages.json` | `adlc/ (owning agent folders)/packages.md` · Modelling |
| Passwords, tokens, private keys | Users move to single sign-on; integration owners issue new credentials from the cutover checklist | `namedCredentials.json`, `remoteSites.json`, `connectedApps.json`, `apiOnlyUsers.json` | `adlc/ (owning agent folders)/credentials.md` · Security |
| Systems that call into Salesforce | Login history per application and integration user; Salesforce-compatible API during the move | `loginsByApplication.json` | `adlc/ (owning agent folders)/credentials.md` · Security |
| History with retention limits | Audit trail, login and field history archived from week one; retention agreed with compliance | `retention.json`, `fieldHistory.json` | `adlc/ (owning agent folders)/history-archive.md` · Data load |
| Built-in platform behaviour | Captured once in the translation playbook; compared with the org by the Verification agent | `src/verification/cases.json` | `adlc/ (owning agent folders)/platform-behaviour.md` · Verification |
| Work in progress at go-live | Pending approvals, paused flows and scheduled jobs listed; completed before the freeze or carried over | `pendingApprovals.json`, `pausedFlows.json`, `scheduledJobs.json`, `asyncJobs.json` | `adlc/ (owning agent folders)/work-in-progress.md` · Data load |

Evidence files are in `adlc/1-discover/extraction/inventory/`. The working documents are written by
`src/generators/emit-cutover.js` (no org connection needed) when the owning agent runs, and are
reviewed at that agent's gate.

To keep this list short: `coverage.json` compares every metadata type the org offers with the manifest;
report, template and login usage show what is still in use; the shadow run turns any differences into
tests; the remaining client-input items are covered in one assessment workshop.

## Status for the Subscription domain

- Translated: `SubscriptionService.applyDefaults` (produced with `logic/prompt.md` in an interactive Claude
  session on 2026-10-01, before the runner existed).
- Pending: `SubscriptionService.handleStatusChange` and `OpportunityService.createSubscriptionsForWonDeals`.
  Both write to objects outside the migrated family (Task, and Subscription from Opportunity), so the
  Logic agent is expected to report them as blocked until those objects are in scope.
- The two generator fixes found by the first verification runs (auto-numbering in system context,
  checkboxes never null) are in the history of `src/generators/emit-postgres.js`.
