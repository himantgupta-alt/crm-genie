# ADR-002: Keep the 18-character Salesforce ID as the primary key

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Integrations, reports and users hold Salesforce IDs; a migration that renumbers records breaks them.

## Decision

Every table keeps the Salesforce ID as its key; new records get IDs in the same format from the runtime.

## Consequences

Links, bookmarks and the compatibility API keep working; keys are text, not integers.

## Applies to (6)

- `Account.Id`
- `Contact.Id`
- `Opportunity.Id`
- `Product2.Id`
- `Subscription__c.Id`
- `Subscription_Line__c.Id`
