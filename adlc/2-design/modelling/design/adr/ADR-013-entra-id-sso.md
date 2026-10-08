# ADR-013: Staff sign in with Entra ID, portal users with Entra External ID; services use managed identities

Status: Accepted · Owner: Modelling agent · Blueprint `49f2c22e6c8f`

## Context

Salesforce passwords cannot be exported, and stored service credentials are a leading cause of breaches.

## Decision

OpenID Connect sign-in through Entra ID for staff (matched by Federation ID) and Entra External ID for customer and partner portal users; services reach Key Vault, the database and the event bus with managed identities; integrations use OAuth 2.0 through API Management.

## Consequences

No passwords to migrate or rotate; conditional access and MFA come from the client tenant.

## Applies to (4)

- `Microsoft Entra ID`
- `Entra External ID`
- `Key Vault`
- `API Management`
