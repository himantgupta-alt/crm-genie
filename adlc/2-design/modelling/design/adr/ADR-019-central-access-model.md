# ADR-019: One access model for every domain, enforced by row-level security

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Salesforce sharing (role hierarchy, sharing rules, teams, territories) is org-wide; rebuilding it per module would drift.

## Decision

A shared access schema holds groups, the role hierarchy, teams, territories and share tables; every domain’s row-level security policies call the same functions; profiles and permission sets become Entra app roles and database roles.

## Consequences

Users see the same records in every module, through every client of the data; new domains inherit the model.

## Applies to (2)

- `access schema`
- `row-level security`
