# ADR-018: Each object has exactly one master at any time; Salesforce and Azure coexist through the change feed

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Domains move over months while the rest of the org stays on Salesforce; two systems writing the same record would diverge.

## Decision

A system-of-record matrix names the master of every object per wave. Salesforce changes stream through the Pub/Sub API into Event Hubs and update read copies; Azure writes back only fields that remaining Salesforce features still read. The gateway routes each API call to the current master.

## Consequences

No conflicting writes; each wave is reversible; integrations follow the master without code changes.

## Applies to (3)

- `Event Hubs`
- `Salesforce sync`
- `API Management`
