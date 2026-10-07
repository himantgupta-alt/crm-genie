# PostgreSQL standards

Owner: Engineering standards · used by the Schema, Logic, Security and Data load agents.

## Naming

- `snake_case` for schemas, tables, columns, functions; table names singular (`subscription`, `subscription_line`).
- Columns take the blueprint vocabulary name; foreign keys end in `_id`; booleans read as a statement (`auto_renew`).
- Constraints, triggers and policies are named after what they implement: `active_requires_mrr` (a Salesforce
  rule), `guard_no_reactivation_after_cancel`, `rls_subscription_read`.

## Migrations

- Numbered `NNN_purpose.sql`, applied in order from `adlc/3-build/manifest.json`; each number has one owning agent.
- Each migration starts with its provenance header; never edit generated SQL by hand.
- Migrations rebuild the schema from the blueprint; rollback is the previous release. Data changes are separate from schema changes.

## Integrity

- Every table has a primary key; we keep the 18-character Salesforce ID (ADR-002).
- Required fields are `NOT NULL`; checkboxes are `NOT NULL DEFAULT false`; picklists are validated against their values.
- Master-detail is `ON DELETE CASCADE`; lookups follow the org's delete behaviour (`SET NULL` or `RESTRICT`).
- Row-local rules are `CHECK` constraints; rules needing the previous row or a parent are `BEFORE` trigger guards (ADR-007, ADR-008).

## Derived data

- Row-local formulas: `GENERATED ALWAYS AS (...) STORED`, with blank-as-zero written as `COALESCE`.
- Cross-object formulas: views. Date-dependent formulas: computed on read with `app.today()` in the org time zone.
- Roll-ups: trigger-maintained columns plus a recompute function; bulk loads defer triggers and recompute once.

## Triggers

- Statement-level where possible; row-level only when the row matters.
- Guard against recursion (depth check) where a trigger writes to a table that fires it again.
- Keep trigger bodies short; call named functions.

## Security

- One role per Salesforce profile or permission set; grants at column level for field-level security.
- Row-level security enabled on every business table; policies mirror the org's sharing model.
- Functions that must bypass RLS (auto-numbers, recompute) are `SECURITY DEFINER` with a fixed `search_path`.

## Performance

- Index every foreign key and every column used by a policy or a common filter; create indexes after bulk loads.
- Partition very large tables by date or ID range; keep transactions short.
