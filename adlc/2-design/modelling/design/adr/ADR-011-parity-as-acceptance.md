# ADR-011: Behaviour is accepted only when it matches Salesforce’s own values

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Reviewing generated code line by line does not scale.

## Decision

The Verification agent recomputes every calculated value against what Salesforce stored and replays rule cases; CI blocks release on any mismatch.

## Consequences

Correctness is measured, not asserted; new behaviours need new cases.

## Applies to (1)

- `adlc/5-validate/verification/cases.json`
