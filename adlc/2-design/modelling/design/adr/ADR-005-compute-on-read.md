# ADR-005: Date-dependent formulas are computed when read

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

A stored value using TODAY() would be wrong tomorrow.

## Decision

Compute in the view using app.today(), evaluated in the org’s time zone.

## Consequences

Matches Salesforce, which also evaluates on read.

## Applies to (1)

- `Subscription__c.Days_To_Renewal__c`
