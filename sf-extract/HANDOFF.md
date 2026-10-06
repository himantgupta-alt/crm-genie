# Salesforce → client-owned stack: project state

Last updated 21 Sep 2026. Read this first after a restart, then `output/logic/business-logic.md`
and `output/schema/schema-summary.md` for what the org currently contains.

## Goal

Prove that a Salesforce org can be read as a specification, compiled into software the client
owns, and shown to behave identically — using **only Claude and the Salesforce CLI**. No
third-party CRM (Twenty / Open Mercato were assessed and rejected). The model is a build-time
compiler; it never sits in the runtime data path.

Approach deck (19 slides): https://claude.ai/code/artifact/d9d1466a-4d52-47b0-9db5-2cc8c2f48cf2
Republish with the same file path or that URL to update it in place.

Timeline, data risks and rollout plan (no model training needed): `ROLLOUT-PLAN.md`.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Extract schema, rules, automations, data | **Done** — pipeline runs end to end |
| 2a | Normalise to a vendor-neutral blueprint (IR) + client vocabulary map | **Done** 1 Oct 2026 |
| 2b | Emit Postgres DDL, RLS, services, rules, tests | **Subscription family done**; Task-creating automations pending |
| 3 | Dependency-ordered data load + parity harness | **Subscription family: PARITY OK** (326/326 values, 17/17 cases) |
| 4 | API, admin shell, natural-language layer | Not started |
| 5 | Strangler cutover behind a Salesforce-compatible facade | Not started |

## Org

- Developer Edition trial, CLI alias **`myorg`** (default org), API 67.0
- Instance: `https://demo-org-dev-ed.develop.my.salesforce.com`
- Username: `demo.user@example.com`, Org Id `00D000000000001EAF`
- Login persists. If it ever expires: `sf org login web --instance-url <instance> --alias myorg --set-default`.
  The browser callback on this laptop worked only when the command ran in the background — the
  first foreground attempt timed out while holding port 1717.
- Production equivalent later: Connected App + JWT bearer flow, no interactive login.

## Repo layout (`C:\SALESFORCE\sf-extract`)

```
scripts/
  lib.js               shared auth helper — reuses the global CLI's @salesforce/core, no stored tokens
  extract-schema.js    describeGlobal + describe → output/schema/**, also writes manifest/package.xml
  extract-logic.js     parses force-app/ → output/logic/** (rules, flows, apex, permissions)
  export-data.js       per-object CSV export; REST under 50k rows, Bulk API above
  extract-inventory.js what metadata cannot carry → output/inventory/** + gap-register.md
  run-all.sh           all five stages in order
  seed-metadata.js     POC seeding: writes the Subscription domain metadata into force-app/
  seed-data.apex       POC seeding: creates records through the real triggers/flows/rules
manifest/package.xml   generated: all business objects + 34 wildcard metadata types
force-app/             retrieved org metadata (18 MB) + the seeded POC metadata
output/schema/         objects/*.json, relationships.json, index.json, schema-summary.md
output/logic/          validationRules, formulaFields, flows, apex, permissions, … + business-logic.md
output/data/           one CSV per object + _export-report.json
```

## How to re-run

```bash
cd /c/SALESFORCE/sf-extract
bash scripts/run-all.sh          # ~12 min; exceeds a 600s foreground limit, run in background
```

Individual stages: `node scripts/extract-schema.js`, `sf project retrieve start --manifest
manifest/package.xml --target-org myorg`, `node scripts/extract-logic.js`, `node scripts/export-data.js`.

## Current extraction results (after seeding, 18 Sep 2026)

- 505 objects described (was 501 before seeding), 1,920+ relationships
- 8 validation rules, 6 formula/roll-up fields, 2 flows, 6 Apex files, 47 profiles/permission sets
- 838 data rows across 41 objects — 47 subscriptions, 69 lines, 122 history rows
- Known, harmless gaps: 65 non-customisable standard objects return no metadata file; 4 system
  tables refuse bulk export (ContentDocumentLink, ContentFolderItem, PendingOrderSummary,
  PermissionSetLicense)

## What was seeded into the org, and why each item exists

Every element was chosen to break a naive translation — this is the difficulty the Phase 2
generator must handle.

| Seeded | Translation problem it forces |
|---|---|
| `Subscription__c` master-detail to Account, `Subscription_Line__c` master-detail to Subscription | FK + ON DELETE CASCADE, and sharing inherited from the parent |
| `Total_Line_Value__c` (sum), `Line_Count__c` (count) | roll-ups → trigger-maintained columns with a recompute backstop |
| `Account_Name__c` = `Subscription__r.Account__r.Name` | two-hop cross-object formula → join or view, not a generated column |
| `Days_To_Renewal__c` = `End_Date__c - TODAY()` | non-immutable formula → cannot be a STORED generated column |
| `Annual_Value__c` = `MRR__c * 12` | the easy case: compiles to a generated column |
| `No_Reactivation_After_Cancel` (PRIORVALUE + ISCHANGED) | needs the old row → service guard, impossible as a CHECK |
| `Parent_Not_Cancelled` (reads `Subscription__r.Status__c`) | cross-object validation → join at write time |
| `Loss_Reason_Required_When_Lost`, `Closed_Won_Requires_Amount` | row-local CHECK constraints |
| `SubscriptionService.handleStatusChange` with a static recursion guard | no Postgres equivalent by default; trigger depth guard required |
| `OpportunityService` (creates a subscription on Closed Won, idempotent) | cross-aggregate write → outbox consumer |
| `SubscriptionRenewalBatch` (Batchable + Schedulable) | governor-limit-shaped batching → cron worker, must be re-bounded |
| `Subscription At Risk Alert` record-triggered flow | after-save automation → in-transaction hook or async consumer |
| `Subscription_Management` permission set | FLS + object CRUD → column privileges and RLS |

Apex tests: `SubscriptionServiceTest`, 5 tests, all passing, 85% org-wide coverage.
Re-seed data any time with `sf apex run --file scripts/seed-data.apex --target-org myorg`
(it deletes prior seeded subscriptions first, so it is idempotent).

## Salesforce gotchas already paid for — do not rediscover

1. **Metadata deploys roll back entirely** on any single component failure. A "39/40 components"
   result deployed nothing.
2. `formulaTreatBlanksAs` accepts only `BlankAsZero` or `BlankAsBlank`. `BlankAsNull` fails the
   whole deploy and the error surfaces on unrelated components.
3. Permission sets **cannot** carry `fieldPermissions` for required or master-detail fields, and
   a detail object's permissions require read on its master object.
4. **Never reuse an inserted sObject for a later update** — it still holds the non-reparentable
   master-detail field, and DML rejects it as inaccessible. Re-query first. This failed only
   inside Apex tests, not in anonymous Apex.
5. Permission set assignment does not reach an already-running test invocation; run tests after.
6. `sf org display` no longer prints secrets; scripts use `@salesforce/core` auth instead.

## Session 1 Oct 2026 — moved to a new laptop, Phase 2a done, first family at parity

**Toolchain (portable, no admin), all under `C:\SALESFORCE\tools`** (git-ignored, reinstall per machine):
Node 24.21.0, MinGit 2.56.0, `sf` CLI 2.152.14 (`npm i -g` into the portable Node). Nothing is on PATH;
prefix each shell with `$env:Path = "C:\SALESFORCE\tools\node;C:\SALESFORCE\tools\git\cmd;$env:Path"`.
No bash (so `run-all.sh` needs Git Bash or running stages individually). **The org login did not move:**
run `sf org login web --instance-url <instance> --alias myorg --set-default` before any org stage.
Repo is git (`C:\SALESFORCE`, `core.autocrlf=false`, no remote); one snapshot commit, work since uncommitted.

**Extractor fixes** (`scripts/extract-logic.js`, re-run from local `force-app/`, no org needed): flows now
keep `filterFormula` and record-create field values; formula fields keep `treatBlanksAs`; permissions keep
full FLS (`fieldAccess`); new `output/logic/objectSettings.json` (sharing model, auto-number format,
restricted picklists, lookup delete behaviour, master-detail reparenting). Phase 1 outputs otherwise identical.

**Phase 2a** — `node scripts/normalise-blueprint.js` → `blueprint/blueprint.json` (505 entities, 9,857 fields,
1,933 relations) + `normalise-report.md`. Deterministic (`contentHash`). Contract frozen in
`blueprint/blueprint.schema.json`; gate with `node scripts/validate-blueprint.js` (schema + referential
integrity). Formula parser `scripts/formula.js`, tests `node --test "scripts/test/*.test.js"` (9 pass).
Client vocabulary: `blueprint/vocabulary.overrides.json`. Identifiers > 63 chars are hash-shortened.

**Phase 2b/3 first slice** — `node scripts/emit-postgres.js` → `target/db/*.sql` (Subscription family +
reference tables Account/Contact/Opportunity/Product2). Strategies: generated columns (BlankAsZero),
`TODAY()` via `app.today()` in views, cross-object formula via view, roll-ups trigger-maintained with a
recompute backstop, 6 CHECKs, 2 BEFORE-trigger guards, RLS from ControlledByParent → Account OWD, one role
per profile/permission set with column-level grants (FLS). Agent-translated Apex lives in
`blueprint/translations/` (applyDefaults so far, `reviewed: false`). Parity: `cd target; npm install;
node parity/run.js` (PGlite = real Postgres 18 in Node) → `target/parity/report.md`.
Bugs the harness caught and fixed: auto-number needed SECURITY DEFINER; checkboxes must be NOT NULL.

**Open for this family:** Task-creating automations (At-Risk flow, handleStatusChange, renewal batch),
OpportunityService outbox, org replay of the rule cases (needs login) — listed in `target/db/manifest.json`.

## CRM Genie on Azure + pipeline (1 Oct 2026)

The target state runs in Azure: **https://crmgenie-app-hg01.azurewebsites.net** (in-app sign-in).
- **Azure** (sub Ascendion Production, RG `AZAP-agentic-finance`, centralindia; separate from Revenue Genie /
  Cash Forecasting): `crmgenie-pg-hg01` (Postgres 17 Flexible B1ms, db `crm`), `crmgenie-app-plan` (B1),
  `crmgenie-app-hg01` (Node 22). ~USD 30–35/month. Infra: `target/infra/main.bicep` + `deploy.ps1`
  (`-WhatIf` first), `load_db.ps1 -Recreate`, `deploy_app.ps1`. Live parity on Azure: 326/326.
- **App** `target/app`: Express + pg; every request runs `SET LOCAL ROLE` for the chosen persona, so FLS,
  sharing and rules are enforced by Postgres. "Open in Salesforce" links for side-by-side demos.
- **Sign-in**: Entra/Easy Auth was blocked (tenant denies app registration to this account, same as Cash
  Forecasting), so in-app sign-in (`app/auth.js`, scrypt hashes, signed HttpOnly cookie, rate limit).
  Users `demo`, `guest`; passwords in `C:\SALESFORCE\.secrets\crmgenie-user-*.txt` (git-ignored). Add a
  user in `infra/common.ps1` `$AppUsers` and re-run `deploy.ps1`. `deploy_auth.ps1` is ready if a tenant
  admin creates the app registration later.
- **GitHub**: private `himantgupta-alt/crm-genie`, branch `main` (clean history; the full local snapshot
  incl. the whole org export stays on local branch `snapshot-local`, never pushed). Workflow
  `.github/workflows/crm-genie.yml`: tests → blueprint rebuild+validate (must equal committed) → DDL re-emit
  (must equal committed) → parity harness → app smoke (27 checks) → deploy via publish profile secret
  `AZURE_WEBAPP_PUBLISH_PROFILE` → /health. Only 6 org CSVs are versioned (see root `.gitignore`).
- **Gotchas**: Windows PowerShell adds a BOM to text piped into native tools (broke password hashing once);
  PS 5.1 + `$ErrorActionPreference='Stop'` turns az stderr warnings into failures (scripts check exit codes);
  app settings change → restart the site and allow ~30 s before testing.

## Session 6 Oct 2026 — wider extraction and the gap register

- **Manifest** (`extract-schema.js`): 88 wildcard types (was 34) — integrations (named/external credentials,
  remote sites, connected apps, External Services), Service Cloud (entitlements, Omni-Channel), security
  policies, translations, report types, Agentforce prompt templates, settings. Types the org does not offer
  are dropped via describeMetadata instead of failing the retrieve. **Reports, dashboards, email templates
  and documents are folder-based** and a `*` returns none of them, so each folder is listed first
  (this org: 30 reports, 2 dashboards, 28 templates listed; 6 reports and 28 templates retrieved — the rest
  sit in Salesforce-managed Enablement folders the user cannot read, recorded in the register).
  `--manifest-only` rewrites only the manifest. Retrieve brought 18 new folders into `force-app/`
  (settings, translations, report types, entitlements, Omni-Channel, security policies, email, reports).
  PowerShell `>` adds a BOM to `retrieve-result.json`; the inventory reader strips it.
- **Inventory** (`extract-inventory.js`, read-only, stage 5 of `run-all.sh`) → `output/inventory/`: org facts,
  limits, installed packages, named credentials, remote sites, connected apps, login sources (inbound
  callers), scheduled jobs, pending approvals, paused flows, report/dashboard/template usage dates,
  retention reach, encrypted fields, file volume, and `coverage.json` (metadata types the org offers that
  are not requested — 187 today, mostly Data Cloud/AI). Writes **`gap-register.md`**, the assessment agenda.
  Each query is optional; anything the edition lacks is marked "not offered by this org".
  `activeUsers.json` / `apiOnlyUsers.json` hold usernames and are git-ignored.
- **Deck**: new slide 4 "What stays in Salesforce, and how we cover it" (six items + four ways to keep the gap
  small). Demo Extraction step shows the inventory and the gap register as an artifact.
- **Working documents per gap** (`scripts/emit-cutover.js`, local files only) → `target/cutover/`:
  `packages.md` (Modelling), `credentials.md` (Security), `work-in-progress.md` + `history-archive.md`
  (Data load), `platform-behaviour.md` (Verification: 7 of 12 behaviours tested). Each agent writes its file
  when it runs; listed in its `agent.json` outputs and shown in the demo at that agent's gate.
- **Org drift**: a full describe on 6 Oct found 512 objects / 1,964 relations (was 505 / 1,933) — new standard
  objects from a Salesforce release. Not committed, so the blueprint and CI baseline stay unchanged; a
  re-extract plus blueprint/DDL regeneration is its own change.

## Next step (was Phase 2a — steps 1–3 below are now done for the Subscription family)

Build the blueprint normaliser and take **one object family end to end**:

1. `scripts/normalise-blueprint.js` — fold `output/schema` + `output/logic` into a single
   versioned `blueprint.json`: entities, fields with physical types, typed relations, derivations
   as expression trees, constraints, automations as event-condition-action, security, vocabulary.
   Freeze its JSON schema; it is the contract every later stage reads.
2. Emit Postgres DDL for `Subscription__c` + `Subscription_Line__c`, including the roll-up
   triggers, the two hard validation rules and RLS from the permission set.
3. Stand up the parity harness against that family: load the 47 + 69 rows, replay the rule cases,
   compare against the org's own answers.

Then the agent crew from deck section 09 (extractor, cartographer, schema smith, logic translator,
security compiler, loader, parity auditor, repair agent), each with narrow tools, machine-checkable
done criteria, isolated git worktrees and bounded repair attempts.

## Open decisions

- Node vs Python for the generated service layer
- Claude Agent SDK vs a hand-rolled Messages API tool loop for the backend
- How much of the admin shell ships inside the POC
- Target cloud, and who hosts it
- POC exit thresholds (deck section 13 proposes ≥90% of validation rules and ≥60% of flows
  auto-translated) — these are proposals, not measurements

## Not yet done

- `C:\SALESFORCE` is **not a git repository**, so none of this is version-controlled. Worth
  `git init` before Phase 2 starts generating code.
- `output/` contains real user names and email addresses from the org — keep it out of any
  repository you share.
