# ADR-015: The platform is split into business domains around a shared core customer domain

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Every Salesforce cloud hangs off the same accounts, contacts, users and products, and the org moves module by module.

## Decision

Group objects into domains (core customer, sales, service, subscriptions, activities and later modules), each owning its objects. Any domain may reference the core; other domains are reached only through their published read views and events.

## Consequences

Modules move and change independently; new Salesforce clouds become new domains without touching existing ones.

## Applies to (5)

- `Core customer`
- `Sales`
- `Service`
- `Subscriptions`
- `Activities`
