# ADR-004: Cross-object formulas become views

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Generated columns cannot read another table.

## Decision

Expose them through a view that joins the parent records.

## Consequences

Always current; reads go through the view.

## Applies to (1)

- `Subscription_Line__c.Account_Name__c`
