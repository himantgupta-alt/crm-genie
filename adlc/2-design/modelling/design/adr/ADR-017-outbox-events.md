# ADR-017: Domains talk through events written with a transactional outbox

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

A change in one domain often triggers work in another, for example a won opportunity creating a subscription.

## Decision

A domain writes its change and an outbox row in one transaction; a relay publishes it to Service Bus as a CloudEvent; consumers are idempotent. Cases where Salesforce did both in one save are listed and covered by parity tests.

## Consequences

No lost or duplicate side effects; cross-domain effects are eventually consistent within seconds.

## Applies to (2)

- `Service Bus`
- `outbox tables`
