# Documentation standards

Owner: Engineering standards · used by the Modelling agent; applies to every document we hand over.

## Structures we use

- **HLD: arc42.** 1 introduction and goals, 2 constraints, 3 context and scope, 4 solution strategy, 5 building
  blocks, 6 runtime, 7 deployment, 8 cross-cutting concepts, 9 decisions, 10 quality, 11 risks, 12 glossary.
- **Diagrams: C4.** Level 1 system context and level 2 containers in the HLD; runtime sequences and flows for
  business processes; an ER diagram for data; a deployment view from the infrastructure code.
- **Decisions: ADRs** (Nygard): context, decision, consequences, and the elements each decision applies to.
  One ADR per design strategy; superseded ADRs are kept and marked, never deleted.
- **LLD:** tables, calculated fields, rules, automations with order of execution, services, security, load
  order, migrations, patterns, verification cases, traceability matrix.

## Rules

- **Generated from the source.** Diagrams and tables come from the blueprint and metadata, so they cannot drift
  from the system. Hand-written text explains intent; it does not restate the model.
- **Traceable.** Every Salesforce element in scope appears in the traceability matrix with its decision,
  artifact and test.
- **Plain language.** Short sentences, active voice, "we" for our team; define a term the first time; no
  marketing claims, no unverifiable numbers.
- **Owned.** Every document names its owner agent and generator in its first lines.
- **Reviewable.** Markdown with Mermaid diagrams: renders on GitHub and in the Org Compiler console, diffs in git.
