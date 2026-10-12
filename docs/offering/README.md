# Salesforce Assess-to-Go-live Offering

Owner: Ascendion engagement team · Status: draft for discussion · illustrative figures

## Summary

This folder describes, in draft, how Ascendion would offer an end-to-end Salesforce transformation to a consumer
goods company that runs several regional Salesforce orgs that have drifted apart. The engagement starts with a
fixed-price assessment: automation reads every org (read-only), produces an as-is analysis, a fit-gap of
standard features against custom build, and a cross-org comparison, and people review the results in workshops.
Delivery then follows six phases - Discover, Design, Build, Migrate, Validate, Go-live - each closed by a human
review gate, followed by hypercare. Custom-built modules that the assessment marks for moving are rebuilt on the
client's own cloud; capabilities that a standard Salesforce feature already covers are adopted or harmonised. The
example client throughout is the fictional Brightwell Consumer Goods (illustrative). All sizes, durations and
efforts are illustrative and are re-baselined from the assessment results.

## Contents

| File | What it covers |
|---|---|
| [01-offering-overview.md](01-offering-overview.md) | Problem, outcomes, scope, phases, deliverables per phase, review gates |
| [02-engagement-sizes.md](02-engagement-sizes.md) | Small, Medium and Large models: parameters, weeks per phase, team, effort, sizing questionnaire |
| [03-team-and-roles.md](03-team-and-roles.md) | Ascendion roles, phases, allocation per size, onshore/offshore split, client-side roles |
| [04-commercials-and-assumptions.md](04-commercials-and-assumptions.md) | Commercial models, assumptions, dependencies, risks, exclusions, acceptance criteria |
| [05-market-comparison.md](05-market-comparison.md) | How comparable offerings are packaged, and what this offering does differently |

## Related material in this repository

- Approach and phase names: `src/agents/README.md`, `src/agents/workflow.json`
- Assessment automation: `src/agents/assessment/agent.json`
- Client pack for the reference module: `docs/client-pack/`
- Timeline estimates and data challenges: `docs/ROLLOUT-PLAN.md`
