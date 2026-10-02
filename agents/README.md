# Agents

The migration runs as a workflow of agents in six stages, with a review gate after each stage. The
workflow is defined in `workflow.json`; `run.js` executes it.

| Stage | Agent | Type | Implementation | Produces |
|---|---|---|---|---|
| 1 Extract | Extraction agent | Deterministic | `sf-extract/scripts/extract-schema.js`, `extract-logic.js`, `export-data.js`, Salesforce CLI | `output/schema`, `output/logic`, `output/data` |
| 2 Model | Modelling agent | Deterministic | `sf-extract/scripts/normalise-blueprint.js`, `validate-blueprint.js`, `formula.js` | `blueprint/blueprint.json` |
| 3 Build | Logic agent | LLM (Claude) for Apex, deterministic for rules | `llm/logic-agent.js` + `prompts/logic-agent.md`; rule compilation in `scripts/sql-expr.js` | `blueprint/translations/`, `target/db/040_guards.sql` |
| 3 Build | Schema agent | Deterministic | `sf-extract/scripts/emit-postgres.js` | `target/db/010–030` |
| 3 Build | Security agent | Deterministic | `sf-extract/scripts/emit-postgres.js` (security section) | `target/db/060_security.sql` |
| 4 Migrate | Data load agent | Deterministic | `sf-extract/target/app/scripts/load.js` | Loaded target database |
| 5 Verify | Verification agent | Deterministic | `sf-extract/target/parity/run.js` + `cases.json` | `target/parity/report.json` |
| 5 Verify | Repair agent | LLM (Claude), on failure only | `llm/repair-agent.js` + `prompts/repair-agent.md` | Proposed generator patch for review |
| 6 Deploy | CI/CD pipeline | Pipeline | `.github/workflows/crm-genie.yml` | Deployed app on Azure App Service |

Most of the work is deterministic: the same input always gives the same output, which makes the result
reviewable and repeatable. Claude is used where code has to be understood and rewritten (Apex) and where
a failed check has to be diagnosed. LLM output is never applied without a reviewer's approval, and every
change is then tested by the Verification agent and the pipeline.

## Running the workflow

```
cd agents && npm install
node run.js                 # Model → Deploy, asks for approval at each gate
node run.js --from extract  # include extraction (needs: sf org login web --alias myorg)
node run.js --to verify     # stop after a stage
node run.js --yes           # approve every gate automatically (CI)
node run.js --dry-run       # LLM agents save their prompts without calling Claude
```

LLM agents use `ANTHROPIC_API_KEY` (or an `ant auth login` profile) and the model in `AGENT_MODEL`
(default `claude-opus-5-5`). Without credentials they run as a dry run.

Each run writes `agents/runs/<run-id>/` (git-ignored, because it can contain org data):

- `run.json`: every agent's status and outputs, every gate decision with reviewer, time and comment
- `logic/*.prompt.md`, `logic/*.response.md`: the exact prompt sent to Claude and its response
- `repair.md`, `repair.patch`: the Repair agent's diagnosis and proposed patch

## Review gates

At each gate the reviewer approves, rejects with a comment (the stage re-runs), or stops the run.
Translations from the Logic agent are written with `"reviewed": false` in
`blueprint/translations/index.json` until a reviewer approves them. A Repair agent patch is applied with
`git apply` only after approval, and is limited to the generator (`sf-extract/scripts/`), never to
generated files.

## Status for the Subscription domain

- Translated: `SubscriptionService.applyDefaults` (produced with `prompts/logic-agent.md` in an
  interactive Claude session on 2026-10-01, before the runner existed).
- Pending: `SubscriptionService.handleStatusChange` and `OpportunityService.createSubscriptionsForWonDeals`.
  Both write to objects outside the migrated family (Task, and Subscription from Opportunity), so the
  Logic agent is expected to report them as blocked until those objects are in scope.
- The two generator fixes found during the first verification runs (auto-numbering in system context,
  checkboxes never null) are in the git history of `sf-extract/scripts/emit-postgres.js`.
