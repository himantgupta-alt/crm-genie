# ADR-010: Apex translations are proposed by the Logic agent and merged only after review

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Apex can do anything; deterministic templates cannot cover it.

## Decision

The Logic agent drafts a translation with tests; it is marked reviewed:false until a person approves it at the gate.

## Consequences

Speed of generation with human accountability; nothing generated merges unchecked.

## Applies to (2)

- `apex-trigger:OpportunityTrigger`
- `apex-trigger:SubscriptionTrigger`
