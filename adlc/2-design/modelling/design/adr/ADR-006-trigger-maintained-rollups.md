# ADR-006: Roll-up summaries are trigger-maintained columns with a recompute job

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Roll-ups must be filterable and fast, and correct after bulk loads.

## Decision

Statement-level triggers keep totals current; a recompute function rebuilds them after loads and as a safety net.

## Consequences

Fast reads; load mode defers triggers and recomputes once.

## Applies to (2)

- `Subscription__c.Line_Count__c`
- `Subscription__c.Total_Line_Value__c`
