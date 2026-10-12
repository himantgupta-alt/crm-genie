# Build: what replaces it?

## 1. Purpose and scope

We generate the database, the business rules, the services and the access model for Subscription Management from the design. An engineer reviews every output before it merges.

## 2. The agents in this phase

### 2.1 Schema agent

<div class="agent">

**What it does**

Generates the database: tables, keys, required fields, drop-down values, formulas and roll-up totals.

**What it produces**

- Tables (`010_tables.sql`)
- Calculated views (`020_views.sql`)
- Roll-up totals (`030_rollups.sql`)

</div>

### 2.2 Logic agent

<div class="agent">

**What it does**

Turns validation rules into database checks, and proposes translations of custom code (Apex), drafted with a language model, for an engineer to approve.

**What it produces**

- Rule checks (`040_guards.sql`)
- Translated code (`050_translations.sql`)

</div>

### 2.3 Security agent

<div class="agent">

**What it does**

Turns profiles, permission sets and sharing into database roles, field-level access and row-level security.

**What it produces**

- Roles and access (`060_security.sql`)
- `credentials.md`

</div>

## 3. Inputs

- The blueprint and the design from Agent 02
- The original Apex code, for translation

## 4. Outputs and results

| Agent | Scripts | Result | Design in |
|---|---|---|---|
| Schema | 4: `000_runtime.sql`, `010_tables.sql`, `020_views.sql`, `030_rollups.sql` | 6 tables, 6 calculated fields | LLD, sections 1 and 2 |
| Logic | 2: `040_guards.sql`, `050_translations.sql` | 6 business rules; custom code translation in progress (1 of 6 automations started) | LLD, sections 3 and 4 |
| Security | 1: `060_security.sql` | 3 profiles and permission sets become database roles | LLD, section 6 |

Each script names the agent that owns it and where it came from. We generate every script again on each change and compare.

## 5. Credentials and integrations

Salesforce never exports passwords, tokens or keys. We move users to single sign-on, matched by Federation ID. For each integration, the owner issues a new credential; we store it in Azure Key Vault, test it, and switch on an agreed date. We keep the systems that call in running through a Salesforce-compatible connection until each one moves.

| Application calling in | Login type | Last login | Owner |
|---|---|---|---|
| Browser | Application | 2026-10-05 | to confirm |
| Salesforce CLI | Remote Access 2.0 | 2026-10-06 | to confirm |
| orgfarm_app_1 | Remote Access 2.0 | 2026-09-22 | to confirm |
| Browser | Remote Access Client | 2026-10-01 | to confirm |

## 6. Review gate and items to confirm

**What a person checks before the next phase starts**

- Each translated piece of Apex does what the original does
- Each role can do exactly what it can do in Salesforce today

**What we ask you to confirm**

- Who owns each integration in section 5
- The date each integration switches to its new credential

## 7. Where the artifacts live

| Artifact | Location |
|---|---|
| Schema scripts | `adlc/3-build/schema/sql` |
| Logic scripts and translations | `adlc/3-build/logic/sql` |
| Security scripts and credentials checklist | `adlc/3-build/security` |
