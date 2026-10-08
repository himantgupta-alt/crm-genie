# ADR-020: Build on open standards so the platform is portable

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

The client wants to avoid trading one vendor lock-in for another.

## Decision

PostgreSQL for data, OCI containers for compute, OpenAPI 3 for APIs, CloudEvents for events, OpenID Connect and OAuth 2.0 for identity; only infrastructure templates and managed-service wiring are Azure-specific.

## Consequences

The platform can move to another cloud by rewriting infrastructure templates, not the application.

## Applies to (4)

- `PostgreSQL`
- `containers`
- `OpenAPI`
- `CloudEvents`
