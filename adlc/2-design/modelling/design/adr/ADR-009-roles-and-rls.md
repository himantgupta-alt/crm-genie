# ADR-009: Profiles and permission sets become roles; sharing becomes row-level security

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Access must be enforced where the data lives, not only in the app.

## Decision

One database role per profile or permission set, column grants for field-level security, RLS policies for sharing; the app sets the role per request.

## Consequences

Any client of the database gets the same access rules; policies are tested by parity cases.

## Applies to (3)

- `profile:Admin`
- `profile:Analytics Cloud Integration User`
- `permissionSet:Subscription_Management`
