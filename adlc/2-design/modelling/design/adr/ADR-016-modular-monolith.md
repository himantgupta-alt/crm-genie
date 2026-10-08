# ADR-016: Start as a modular monolith: one deployable and one database, one schema per domain

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Salesforce saves related records in one transaction; splitting every domain into its own service and database from day one would lose that and add operational cost.

## Decision

Deploy all domains as modules of one service on one PostgreSQL server, one schema per domain; enforce boundaries with schema permissions and contract tests. Split a domain into its own service or server only when its scale or release cadence requires it.

## Consequences

Integrity inside a domain stays transactional; boundaries are real, so a later split needs no redesign.

## Applies to (2)

- `Domain services`
- `PostgreSQL`
