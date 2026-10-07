# Engineering principles

Owner: Engineering standards · applies to all code in `src/` and everything agents generate.

## Design

- **Single responsibility (S of SOLID).** One generator, one output family; one agent, one job and one output
  folder. If a module needs "and" to describe it, split it.
- **Open for extension, closed for modification (O).** New targets or constructs are new emitters or new
  strategies keyed off the blueprint, not edits scattered through existing ones.
- **Depend on contracts, not implementations (D).** Generators depend on the blueprint schema, never on
  Salesforce APIs; the app depends on the database contract (roles, views), not on generator internals.
- **Separation of concerns.** Extraction reads; modelling decides; building writes code; verification judges.
  No phase reaches into another phase's job.
- **KISS.** Prefer the plain construct (a CHECK constraint, a view) over a clever one. Clever code is a review cost.
- **YAGNI.** Generate what the org actually uses. Unused constructs are listed, not built.
- **DRY, with judgement.** One source of truth for each fact (paths in `src/paths.js`, structure in the
  blueprint). Duplicate only when it removes coupling between phases.

## Behaviour

- **Deterministic.** Same inputs, byte-identical outputs: sorted listings, no timestamps in artifacts, content
  hashes on contracts. This is what makes CI's "regenerate and diff" check possible.
- **Idempotent.** Every generator and loader can be re-run safely; re-running is how we recover.
- **Fail fast, fail loudly.** Validate inputs at the boundary (blueprint schema, manifest hash) and stop with a
  message that names the fix.
- **Least privilege.** Read-only access to the source org; one database role per Salesforce profile; agents
  write only inside their own folder (enforced by the runner).
- **Explicit over implicit.** Blank-as-zero, time zones, rounding and order of execution are written down in
  code and in the playbook, never assumed.

## Change

- **Small, reviewable steps.** One concern per commit; generated output in a separate commit from generator changes
  when practical.
- **Leave a trail.** Every generated artifact names its owner, generator and source; every design choice has an ADR.
- **Make the right thing the easy thing.** If a rule matters, turn it into a check in CI.
