# ADR-014: Data services are reachable only on private endpoints; the edge is Front Door with WAF

Status: Accepted · Owner: Modelling agent · Blueprint `fc71a1458dce`

## Context

Customer and revenue data must not be reachable from the internet.

## Decision

PostgreSQL and Key Vault have private endpoints in a spoke virtual network; the app uses VNet integration; public traffic enters only through Front Door with the Web Application Firewall.

## Consequences

One controlled entry point; deployments and administration go through the pipeline or a bastion.

## Applies to (3)

- `Front Door`
- `Virtual network`
- `Private endpoints`
