# ADR-004: Cross-object formulas become views

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Generated columns cannot read another table.

## Decision

Expose them through a view that joins the parent records.

## Consequences

Always current; reads go through the view.

## Applies to (1)

- `Subscription_Line__c.Account_Name__c`
