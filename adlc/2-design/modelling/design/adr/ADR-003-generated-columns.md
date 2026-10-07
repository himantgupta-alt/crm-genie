# ADR-003: Row-local formulas become stored generated columns

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Formulas that read only their own row are pure functions of the row.

## Decision

Compile them to GENERATED ALWAYS AS … STORED, with blank-as-zero made explicit.

## Consequences

Always correct, indexable, no application code; formulas using TODAY() cannot use this (see ADR-005).

## Applies to (2)

- `Subscription_Line__c.Line_Total__c`
- `Subscription__c.Annual_Value__c`
