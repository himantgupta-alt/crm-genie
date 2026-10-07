# ADR-007: Row-local validation rules become CHECK constraints

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Rules that read only the row being saved can be enforced by the database itself.

## Decision

Compile to CHECK constraints named after the rule, keeping the Salesforce error message in the mapping.

## Consequences

Enforced for every writer, including integrations and loads.

## Applies to (6)

- `Opportunity.Closed_Won_Requires_Amount`
- `Opportunity.Loss_Reason_Required_When_Lost`
- `Subscription_Line__c.Quantity_Must_Be_Positive`
- `Subscription__c.Active_Requires_MRR`
- `Subscription__c.Cancellation_Reason_Required`
- `Subscription__c.End_Date_After_Start_Date`
