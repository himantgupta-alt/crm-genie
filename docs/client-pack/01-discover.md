# Discover: what is in the org?

## 1. Purpose and scope

We read the whole Salesforce org, read-only, and list everything in it. We also list what Salesforce does not hand over, so nothing surprises us at go-live.

## 2. The agents in this phase

### 2.1 Extraction agent

<div class="agent">

**What it does**

Reads the whole org through the Salesforce CLI and APIs: objects, fields, rules, flows, code, security, 88 kinds of configuration and every record.

**What it produces**

- Schema, rules and data files
- Full metadata copy (force-app)
- `gap-register.md`, with evidence from the org

</div>

## 3. Inputs

- Read-only access to the org through the Salesforce CLI, REST and Bulk APIs
- 88 kinds of configuration requested in one retrieve manifest
- Usage data: login history, scheduled jobs, report and template usage

## 4. Outputs and results

| Area | Found |
|---|---|
| Objects described | 505 |
| Fields | 9,857 |
| Relationships | 1,933 |
| Validation rules | 8 |
| Automations (flows, triggers, jobs, routing rules) | 10 |
| Profiles and permission sets | 47 |
| Reports · dashboards · email templates | 30 · 2 · 28 |

## 5. The module in the org

| Object | Salesforce name | Role |
|---|---|---|
| Subscription | `Subscription__c` | in scope |
| Subscription Line | `Subscription_Line__c` | in scope |
| Account | `Account` | reference data the module links to |
| Contact | `Contact` | reference data the module links to |
| Opportunity | `Opportunity` | reference data the module links to |
| Product | `Product2` | reference data the module links to |

Record counts per object are in Agent 04 - Migrate, section 4.

## 6. What Salesforce keeps, and how we handle it

Salesforce does not hand everything over. This register is the one place we track each item; the document in the last column holds the detail.

| Item | In this org | How we handle it | Detail in |
|---|---|---|---|
| Vendor package code | 2 packages | We take the settings and data, record the behaviour as tests, then rebuild, replace or retain each package | Agent 02 - Design, section 6 |
| Passwords and secrets | never exported | Users move to single sign-on; each integration owner issues a new credential | Agent 03 - Build, section 5 |
| Systems that call in | 4 sources in login history | We keep them running through a Salesforce-compatible connection until each one moves | Agent 03 - Build, section 5 |
| History with time limits | 171 field history tables | We archive it from week one and load it with no time limit | Agent 04 - Migrate, section 6 |
| Work in progress at go-live | 0 approvals, 0 paused flows, 3 scheduled jobs | We finish each one before the freeze, or carry it over | Agent 04 - Migrate, section 7 |
| Built-in platform behaviour | 12 behaviours | We build each one into the platform once and test it in both systems | Agent 05 - Validate, section 7 |

## 7. Review gate and items to confirm

**What a person checks before the next phase starts**

- The inventory is complete for the module and its reference data
- Every item in section 6 has an owner and a route

**What we ask you to confirm**

- Which vendor packages are still in use, and who owns them
- Which other systems connect to Salesforce
- How long history must be kept for compliance

## 8. Where the artifacts live

| Artifact | Location |
|---|---|
| Schema, rules and data | `adlc/1-discover/extraction` |
| Full metadata copy | `adlc/1-discover/extraction/metadata/force-app/main/default` |
| Inventory and gap register | `adlc/1-discover/extraction/inventory` |
