# Knowledge base

Owner: Engineering standards · reusable for any org; not specific to one org.

The standards our agents and engineers follow. Each agent spec (`src/agents/<agent>/agent.json`) lists the
pages it follows under `kb`; the two agents that use a language model (Logic, Repair) receive those pages in their prompts, and reviewers
use [review-checklists.md](review-checklists.md) at every gate. The guardrails that bound what agents may do
are in [`../guardrails/`](../guardrails/README.md).

| Page | Covers | Used by |
|---|---|---|
| [engineering-principles.md](engineering-principles.md) | SOLID, DRY, KISS, YAGNI, separation of concerns, determinism, idempotency, least privilege | all agents, all code |
| [secure-coding.md](secure-coding.md) | OWASP Top 10 mapped to this stack, secrets, personal data, dependencies | all agents, all code |
| [postgres-standards.md](postgres-standards.md) | naming, migrations, constraints, triggers, row-level security, indexes | Schema, Logic, Security, Data load |
| [nodejs-standards.md](nodejs-standards.md) | structure, errors, async, configuration, logging, dependencies | generators, app, agents |
| [testing-standards.md](testing-standards.md) | unit, golden-master parity, contract, smoke; what blocks a release | Verification, Repair, CI |
| [documentation-standards.md](documentation-standards.md) | arc42, C4, ADRs, traceability, plain language | Modelling |
| [salesforce-translation-playbook.md](salesforce-translation-playbook.md) | each Salesforce construct, its target pattern, and the traps | Modelling, Schema, Logic, Security |
| [fit-gap-method.md](fit-gap-method.md) | function-level fit-gap: verdicts, ratings, quick wins, cross-cutting checks, order of execution, Retail and TPM mapping | Discovery, Modelling, Logic, Repair |
| [packages/](packages/README.md) | installed packages: how to assess any package, and guides for Consumer Goods Cloud, CPQ and Billing, Field Service, Salesforce Maps and Marketing, each from official Salesforce sources confirmed by `src/generators/verify-kb-sources.js` | Discovery, reviewers at the Discover gate |
| [review-checklists.md](review-checklists.md) | what a reviewer checks at each gate | reviewers at G1–G6 |

How the knowledge base grows: when the Repair agent fixes the same kind of problem twice, the lesson becomes a
rule in the playbook or a check in `src/generators/check-conventions.js`.
