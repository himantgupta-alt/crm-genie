# ADR-012: Host on Azure Container Apps and Azure Database for PostgreSQL

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

The platform will grow to many domains, with web traffic, scheduled jobs and event handlers; the client wants no servers to run and zone-level resilience.

## Decision

Run domain services, jobs and the Salesforce sync on a zone-redundant Azure Container Apps environment, and data on PostgreSQL Flexible Server with zone-redundant high availability.

## Consequences

One hosting model for every domain, with scale-to-demand and event-driven jobs; containers keep the option to move to Kubernetes or another cloud.

## Applies to (2)

- `Azure Container Apps`
- `Azure Database for PostgreSQL`
