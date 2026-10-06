# Rollout plan, timeline and risks

Written 24 Sep 2026. Companion to `HANDOFF.md` and the approach deck
(https://claude.ai/code/artifact/d9d1466a-4d52-47b0-9db5-2cc8c2f48cf2). All durations below are
**estimates, not measurements** — the POC has not yet run against a real enterprise org. The real
per-client number comes from a Phase 1 run on that client's sandbox (automatable vs assisted ratio).

## 1. Model training — not needed

Claude is used off the shelf through the agent crew; nothing is fine-tuned.

- **The knowledge lives in the client's org.** Each agent receives its slice of the extracted
  blueprint (one object, one rule, one Apex class). Every org differs, so a model trained on one
  client would not transfer.
- **Tests decide correctness.** Generated code merges only when its tests pass and the parity
  harness matches Salesforce's own answers.
- **Improvement comes from a growing playbook.** When the repair agent keeps fixing the same class
  of problem (e.g. blank-as-zero), add a rule or template to the generator — versioned code, no
  training cost.

What must be built: the translation playbook, templates, a library of worked examples, the test
and parity harness.

## 2. Timeline

Agent compute is hours to a few days even on an enterprise org. The months go to human review,
data movement, integration rewiring, UAT and cutover.

Assumed "mid-size enterprise" org: ~150 custom objects, 300 flows, 50k lines of Apex,
20 integrations, 50M records, 1,500 reports.

| Work | Duration | Notes |
|---|---|---|
| Finish the POC (one object family end to end, then the demo) | 6–8 weeks | Phase 2a onward from `HANDOFF.md` |
| Productise (all 10 stages, agent crew, admin shell) | 4–6 months | One-time, reused for every client |
| Per client: assess (Phase 1 on their sandbox) | 1–2 weeks | Produces the real estimate |
| Per client: generate and review | 6–12 weeks | Apex and flows dominate review time |
| Per client: data load and parity | 4–8 weeks | Runs alongside review |
| Per client: shadow run | 4–8 weeks | Salesforce stays live; target follows via CDC |
| Per client: cutover, domain by domain | 3–6 months | Paced by integrations and licence renewal |

Roughly **6–12 months per mid-size enterprise client**; the first client will take longer.
Traditional manual migrations of that size typically run 12–24 months.

## 3. Data challenges

- **Volume and API limits** — daily API and Bulk limits mean a large extraction takes days, not
  minutes. Needs chunked extraction plus Change Data Capture to stay in sync while it runs.
- **Files and attachments** — often terabytes; ContentVersion needs its own migration path and storage plan.
- **Dirty history** — duplicates, orphans, rows that break today's validation rules or hold
  inactive picklist values. The loader must flag these, not reject or drop them.
- **Missing history** — field history retention is limited unless extended; recycle bin holds
  deletes for 15 days. Agree with the client what "all the data" means.
- **Encrypted fields** — Shield Platform Encryption needs a decrypt/re-encrypt plan.
- **Personal data and compliance** — DPA, data-residency decision, controlled staging. Our own
  `output/` already contains real names and emails from the trial org.
- **Ids, timezones, currency** — 15 vs 18 character Ids, org-timezone dates, dated exchange rates
  and rounding. Small mismatches finance catches first.
- **Final cutover window** — last sync and write freeze per domain; hours, but rehearsed.

Beyond data: managed packages (source not retrievable), report volume, and admins moving from
clicks to pull requests remain the largest risks.

## 4. Rollout plan

### Track A — our product

1. **Weeks 0–8, finish the POC** — normaliser → DDL + security for the Subscription family →
   parity harness → live 8-step demo (deck section 17).
2. **Months 2–4, pilot client** — sandbox with production metadata, Phase 1 run, agree exit
   thresholds (≥90% validation rules and ≥60% flows auto-translated). Deliver one object family
   through to the parity report.
3. **Months 4–8, productise** — full agent crew, per-agent git worktrees, Salesforce-compatible
   facade, admin shell.

### Track B — each client

1. **Assess (2 weeks)** — Phase 1 run, managed-package inventory, report count, renewal date.
   `output/inventory/gap-register.md` is the workshop agenda: what stays in Salesforce (package code,
   secrets, inbound callers, expiring history, platform behaviour, work in progress) and the route for
   each. Start the history archive in week one. Go / walk-away decision.
2. **Build and prove (2–4 months)** — generate, review, load, hit parity thresholds.
3. **Shadow (1–2 months)** — Salesforce remains system of record; daily divergence reports.
4. **Move reporting first** — dashboards repoint to Postgres so the business trusts the numbers
   before writes move.
5. **Cut over by domain** — Leads → Cases → Opportunities, each with its own rollback, reverse
   sync to Salesforce until the last integration moves.
6. **Decommission** — reduce seats, final contractual export, archive, switch off at renewal.
