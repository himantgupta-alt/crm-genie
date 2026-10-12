# Salesforce Discovery-to-Go-live Offering

Owner: Ascendion engagement team · Status: draft for discussion · illustrative figures

## Summary

This folder describes, in draft, how Ascendion would offer an end-to-end Salesforce transformation to a consumer
goods company that runs several regional Salesforce orgs that have drifted apart.

**The initial offer is Discovery only**, at a fixed price: 3, 4 or 6 weeks for a Small, Medium or Large estate,
after a client-dependent week 0 for access and setup. Using an agent-assisted approach, scripts read every org
read-only and generate 13 discovery documents per org (as-is profile, customised versus standard, data model,
validation rules, business processes, code, packages, security, integrations, user interface, reports and usage,
technical debt), an interactive Discovery explorer, a cross-org comparison and a fit-gap of standard features
against custom build. Ascendion architects review every output, and the client's regional owners confirm it in
workshops. Approved artifacts are handed over to the client's git and removed from Ascendion's side with a dated
deletion certificate. The assessment is part of Discover; it is not a separate phase. See
[06-discovery-offer.md](06-discovery-offer.md).

After the Discovery readout, delivery can follow in phases - wave discovery, Design, Build, Migrate, Validate,
Go-live - each closed by a human review gate, followed by hypercare. Custom-built modules that Discovery marks for
moving are rebuilt on the client's own cloud; capabilities that a standard Salesforce feature already covers are
adopted or harmonised. The example client throughout is the fictional Brightwell Consumer Goods (illustrative).
All sizes, durations and efforts are illustrative and are re-baselined from the Discovery results.

## Contents

| File | What it covers |
|---|---|
| [06-discovery-offer.md](06-discovery-offer.md) | **Start here.** The initial offer: Discovery scope, deliverables by file name, timeline with and without the agents, what is needed to connect to the client's orgs, how the documents are produced, handover and removal, feasibility, commercials |
| [01-offering-overview.md](01-offering-overview.md) | Problem, outcomes, scope, phases, deliverables per phase, review gates |
| [02-engagement-sizes.md](02-engagement-sizes.md) | Small, Medium and Large models: parameters, weeks per phase, team, effort, sizing questionnaire |
| [03-team-and-roles.md](03-team-and-roles.md) | Ascendion roles, phases, allocation per size, onshore/offshore split, client-side roles |
| [04-commercials-and-assumptions.md](04-commercials-and-assumptions.md) | Commercial models, assumptions, dependencies, risks, exclusions, acceptance criteria |
| [05-market-comparison.md](05-market-comparison.md) | How comparable offerings are packaged, and what this offering does differently |
| [07-team-email-discovery-pointers.txt](07-team-email-discovery-pointers.txt) | Plain-text email for the team: what we need from the client to connect, and what Discovery delivers (ready to paste) |

## Related material in this repository

- Approach and phase names: `src/agents/README.md`, `src/agents/workflow.json`
- Discovery and assessment agents: `src/agents/assessment/agent.json`, `src/agents/extraction/agent.json`
- Discovery outputs: `adlc/1-discover/assessment/`
- Client pack for the reference module: `docs/client-pack/`
- Timeline estimates and data challenges: `docs/ROLLOUT-PLAN.md`
