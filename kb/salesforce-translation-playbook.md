# Salesforce translation playbook

Owner: Engineering standards · used by the Modelling, Schema, Logic and Security agents. Each row is a rule the
generator applies; the ADR column links the decision.

## Structure

| Salesforce construct | Target pattern | Traps | ADR |
|---|---|---|---|
| Object | table, primary key = 18-character Salesforce ID | 15- vs 18-character IDs: store 18, match case-insensitively on input | ADR-002 |
| Picklist (restricted) | text column + validation against values | inactive values still appear in history: allow on load | — |
| Multi-select picklist | junction table | semicolon-joined strings lose data silently | — |
| Master-detail | `NOT NULL` FK, `ON DELETE CASCADE`, sharing inherited from parent | the security emitter must read it too | ADR-009 |
| Lookup | FK with the org's delete behaviour | some lookups block deletion | — |
| Polymorphic lookup (WhoId, WhatId) | `(type, id)` pair, partial indexes | no real FK possible | — |

## Derived values

| Construct | Target pattern | Traps | ADR |
|---|---|---|---|
| Formula, row-local | generated column, stored | blank-as-zero vs blank-as-blank: write `COALESCE` explicitly | ADR-003 |
| Formula, cross-object | view joining the parent | generated columns cannot read other tables | ADR-004 |
| Formula using `TODAY()`/`NOW()` | computed on read, org time zone | a stored value is wrong tomorrow | ADR-005 |
| Roll-up summary | trigger-maintained column + recompute | bulk loads: defer, then recompute once; rounding must match the org | ADR-006 |

## Rules and automation

| Construct | Target pattern | Traps | ADR |
|---|---|---|---|
| Validation rule, row-local | `CHECK` constraint named after the rule | keep the Salesforce message for the UI | ADR-007 |
| Validation rule with `PRIORVALUE`/`ISCHANGED` or a parent field | `BEFORE` trigger guard | a CHECK cannot see the old row | ADR-008 |
| Apex trigger | service hook in the same transaction, translated and reviewed | static recursion guards need a depth check | ADR-010 |
| Record-triggered flow, before save | synchronous hook | must run before validation | — |
| Record-triggered flow, after save | hook or outbox consumer | choosing async changes behaviour | — |
| Batch / scheduled Apex | scheduled worker | governor limits disappear: re-check unbounded queries | — |
| Assignment / escalation rules | ordered rule definitions + scheduler | first match wins; order matters | — |
| Approval process | explicit state machine | in-flight approvals at cutover | — |

## Platform behaviour (no metadata describes it)

- **Order of execution:** before triggers → system validation → custom validation → duplicate rules → after
  triggers → assignment → workflow/flows → roll-ups → sharing. Rebuild it explicitly.
- **Time zones:** date fields are org-time-zone dates; convert once, at load.
- **Currency:** dated exchange rates and the org's rounding.
- **Owner change cascades, lead conversion, merge:** implemented once in the platform and covered by parity cases.

## Security

| Construct | Target pattern | ADR |
|---|---|---|
| Profile, permission set | database role | ADR-009 |
| Field-level security | column grants; read-only fields have no UPDATE grant | ADR-009 |
| Org-wide defaults, sharing rules, role hierarchy | row-level security policies; materialised access where hierarchies are deep | ADR-009 |
