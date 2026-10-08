# ADR-001: A vendor-neutral blueprint is the contract between extraction and generation

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Extractors speak Salesforce; generators speak PostgreSQL. Coupling them directly makes every new source or target a rewrite.

## Decision

All generators read only the blueprint (JSON, validated against blueprint.schema.json, content-hashed). Extraction never talks to generation.

## Consequences

Re-runs are deterministic and diffable; a new target needs one emitter. The schema must evolve with care (versioned).

## Applies to (1)

- `adlc/2-design/modelling/blueprint/blueprint.json`
