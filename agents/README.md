# Agents

The migration runs as a workflow of eight agents in six stages, with a review gate after each stage.
Each agent is a folder with a spec and an entry point:

```
agents/
  workflow.json          stages, agents per stage, review gates
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

| Stage | Agent | Type | Calls | Produces |
|---|---|---|---|---|
| 1 Extract | Extraction | Deterministic | `sf-extract/scripts/extract-schema.js`, `extract-logic.js`, `export-data.js`, Salesforce CLI | `output/schema`, `output/logic`, `output/data` |
| 2 Model | Modelling | Deterministic | `normalise-blueprint.js`, `validate-blueprint.js`, `formula.js` | `blueprint/blueprint.json` |
| 3 Build | Schema | Deterministic | `emit-postgres.js --parts runtime,tables,views,rollups` | `target/db/000–030` |
| 3 Build | Logic | Claude for Apex, deterministic for rules | `logic/prompt.md`; `emit-postgres.js --parts guards,translations` | `blueprint/translations/`, `target/db/040–050` |
| 3 Build | Security | Deterministic | `emit-postgres.js --parts security` | `target/db/060_security.sql` |
| 4 Migrate | Data load | Deterministic | `target/app/scripts/load.js` | Loaded target database |
| 5 Verify | Verification | Deterministic | `target/parity/run.js` + `cases.json` | `target/parity/report.json` |
| 5 Verify | Repair (on failure) | Claude | `repair/prompt.md` | Proposed generator patch |
| 6 Deploy | CI/CD pipeline | Pipeline | `.github/workflows/crm-genie.yml` | App deployed to Azure App Service |

The deterministic agents do most of the work: the same input gives the same output, so results are
repeatable and reviewable. Claude is used where code must be understood and rewritten (Apex) and where a
failed check must be diagnosed. LLM output is never applied without a reviewer's approval, and every
change is then tested by the Verification agent and the pipeline.

## Running the workflow

```
cd agents && npm install
node run.js --list          # agents and what they do
node run.js                 # Model → Deploy, asks for approval at each gate
node run.js --from extract  # include extraction (needs: sf org login web --alias myorg)
node run.js --to verify     # stop after a stage
node run.js --yes           # approve every gate automatically (CI)
node run.js --dry-run       # LLM agents save their prompts without calling Claude
```

LLM agents use `ANTHROPIC_API_KEY` (or an `ant auth login` profile) and the model in `AGENT_MODEL`
(default `claude-opus-5-5`). Without credentials they run as a dry run.

Each run writes `agents/runs/<run-id>/` (git-ignored, because it can contain org data): `run.json` with
every agent's result and every gate decision (reviewer, time, comment), and the exact prompts and
responses of the LLM agents.

## Review gates

At each gate the reviewer approves, rejects with a comment (the stage re-runs), or stops the run. Logic
agent translations are written with `"reviewed": false` until approved. A Repair agent patch is applied
with `git apply` only after approval, and only to the generator (`sf-extract/scripts/`).

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

## Status for the Subscription domain

- Translated: `SubscriptionService.applyDefaults` (produced with `logic/prompt.md` in an interactive Claude
  session on 2026-10-01, before the runner existed).
- Pending: `SubscriptionService.handleStatusChange` and `OpportunityService.createSubscriptionsForWonDeals`.
  Both write to objects outside the migrated family (Task, and Subscription from Opportunity), so the
  Logic agent is expected to report them as blocked until those objects are in scope.
- The two generator fixes found by the first verification runs (auto-numbering in system context,
  checkboxes never null) are in the history of `sf-extract/scripts/emit-postgres.js`.
