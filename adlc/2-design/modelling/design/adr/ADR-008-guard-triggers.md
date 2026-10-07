# ADR-008: Rules needing the previous row or a parent record become BEFORE-trigger guards

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

PRIORVALUE, ISCHANGED and cross-object rules cannot be CHECK constraints.

## Decision

Generate BEFORE INSERT OR UPDATE triggers that raise the Salesforce message.

## Consequences

Same behaviour as Salesforce; order of guards follows Salesforce’s order of execution.

## Applies to (2)

- `Subscription_Line__c.Parent_Not_Cancelled`
- `Subscription__c.No_Reactivation_After_Cancel`
