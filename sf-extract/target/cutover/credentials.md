# Credentials and integrations checklist

Prepared by our team from the org inventory. Owner: **Security agent**; we review it at that phase's gate.

Salesforce never exports passwords, tokens or keys. We move users to the company login (single sign-on, matched by Federation ID), or a new password on day one. For every integration, the owner issues a new credential; we store it in Azure Key Vault, test it, and switch on an agreed date. We find the systems that call into Salesforce from login history and keep them running through a Salesforce-compatible connection until each one moves.

## Outbound: named credentials

_None in this org._

## Outbound: remote sites

| Site | Endpoint | Active | Owner | New credential | Tested | Switch date |
|---|---|---|---|---|---|---|
| ApexDevNet | http://www.apexdevnet.com | true | | | | |

## Connected apps (OAuth clients)

_None in this org._

## Inbound: who calls Salesforce (login history)

| Application | Login type | Logins | Users | Last login | Owner | New credential | Tested | Switch date |
|---|---|---|---|---|---|---|---|---|
| Salesforce CLI | Remote Access 2.0 | 6 | 1 | 2026-10-06 | | | | |
| orgfarm_app_1 | Remote Access 2.0 | 3 | 1 | 2026-09-22 | | | | |
| Browser | Remote Access Client | 3 | 1 | 2026-10-01 | | | | |

## API-only users (integration accounts)

| User | Profile | Last login | Active | Owner | New credential | Tested | Switch date |
|---|---|---|---|---|---|---|---|
| i…@00d000000000001eaf | Analytics Cloud Integration User | — | true | | | | |
| i…@00d000000000001eaf | Analytics Cloud Security User | — | true | | | | |
