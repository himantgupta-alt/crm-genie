# High-level design: Subscription domain

Prepared 2026-10-07 from blueprint `fc71a1458dce`. Every diagram below is generated from the org’s own metadata; when the org changes, we regenerate this document.

## 1. Scope

|  |  |
|---|---|
| Source | Salesforce org, 505 objects described |
| Domain in scope | Subscription, Subscription Line |
| Reference objects | Account, Contact, Opportunity, Product |
| Target | PostgreSQL on Azure, services and admin app, released by CI/CD |
| Data | Account 22 · Contact 20 · Opportunity 31 · Product 17 · Subscription 107 · Subscription Line 219 |

## 2. How we move it

Six phases, one or more agents per phase, a review gate after each phase. A failed check goes to the Repair agent, whose fix is applied only after approval.

```mermaid
flowchart LR
  SF[("Salesforce org<br/>metadata and data")]
  P0["1 Discover<br/><small>Extraction</small>"]
  SF --> P0
  P1["2 Design<br/><small>Modelling</small>"]
  P0 --> P1
  P2["3 Build<br/><small>Schema<br/>Logic<br/>Security</small>"]
  P1 --> P2
  P3["4 Migrate<br/><small>Data load</small>"]
  P2 --> P3
  P4["5 Validate<br/><small>Verification</small>"]
  P3 --> P4
  P5["6 Go-live<br/><small>CI/CD pipeline</small>"]
  P4 --> P5
  P5 --> AZ[("Azure<br/>PostgreSQL + App Service")]
  P4 -. "fails" .-> R["Repair agent"] -. "fix, after approval" .-> P2
  classDef phase fill:#F3F1FC,stroke:#6666CC,color:#1F1F2E;
  class P0,P1,P2,P3,P4,P5 phase;
```

## 3. Business processes

### 3.1 Subscription lifecycle

Statuses come from the Status picklist; the notes come from the validation rules that guard each status.

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Active
  Active --> Suspended
  Suspended --> Active
  Active --> Renewed
  Renewed --> [*]
  Draft --> Cancelled
  Active --> Cancelled
  Suspended --> Cancelled
  Cancelled --> [*]
  note right of Active
    needs MRR above zero
  end note
  note right of Cancelled
    needs a cancellation reason<br/>cannot be reactivated
  end note
```

### 3.2 Won deal becomes a subscription

When an opportunity is marked Closed Won, a subscription is created for the account, once per deal.

```mermaid
sequenceDiagram
  autonumber
  actor Rep as Sales rep
  participant O as Opportunity
  participant S as OpportunityService
  participant Sub as Subscription
  Rep->>O: set stage to Closed Won
  O->>S: after update: createSubscriptionsForWonDeals()
  S->>Sub: any subscription already created for this deal?
  alt none yet
  S->>Sub: insert subscription (term 12 months)
  else already exists
    S-->>O: skip (no duplicates)
  end
  Sub-->>Rep: subscription visible on the account
```

### 3.3 Saving a subscription

What happens, in Salesforce’s order, every time a subscription is saved: defaults, validation, status handling, the at-risk alert, and totals on the parent.

```mermaid
sequenceDiagram
  autonumber
  actor U as User or integration
  participant SF as Subscription
  participant SubscriptionService as SubscriptionService
  U->>SF: create or update a subscription
  SF->>SubscriptionService: before save: applyDefaults()
  SF->>SF: validation rules (4)
  Note right of SF: Active Requires MRR<br/>Cancellation Reason Required<br/>End Date After Start Date<br/>No Reactivation After Cancel
  SF->>SubscriptionService: after save: handleStatusChange()
  SubscriptionService-->>SF: insert Task
  participant Flow as Flow
  SF->>Flow: Subscription At Risk Alert
  Note right of Flow: when AND( Health_Score__c #lt; 50, Status__c = Active )
  Flow-->>SF: create Task
  SF-->>U: saved, or the first failing rule’s message
```

### 3.4 Subscription At Risk Alert

Raises a check-in task when an active subscription drops below the at-risk health threshold.

```mermaid
flowchart TD
  START(["Subscription created or updated<br/>after save"])
  FILTER{{"AND( Health Score #lt; 50, Status = Active )"}}
  START --> FILTER
  FILTER -- "no" --> SKIP(["no action"])
  Create_Health_Check_Task["create Task<br/><small>Create Health Check Task</small>"]
  FILTER -- "yes" --> Create_Health_Check_Task
  classDef el fill:#F3F1FC,stroke:#6666CC,color:#1F1F2E;
```

### 3.5 Renewal reminders

A scheduled job raises a renewal task before each active subscription ends.

```mermaid
flowchart TD
  A(["Nightly schedule"]) --> B["Find active subscriptions<br/>ending within 30 days"]
  B --> C{"Any found?"}
  C -- "yes" --> D["Create a renewal task<br/>for each owner"]
  C -- "no" --> E(["Done"])
  D --> E
  classDef job fill:#EAFBF5,stroke:#2CDCAA,color:#1F1F2E;
  class A,B,D job;
```

### 3.6 Case routing and escalation

Assignment rules route each new case by country, service level and account type; escalation rules raise cases that miss their target time (outside the subscription domain; listed for completeness).

```mermaid
flowchart TD
  S(["New case"])
  C0{{"BillingCountry = US<br/>SLA = Gold, Platinum<br/>Type contains Customer"}}
  S --> C0
  C0 -- "yes" --> R0["assign to assigned user"]
  C1{{"BillingCountry = US<br/>SLA = Silver, Bronze<br/>Type contains Customer"}}
  C0 -- "no" --> C1
  C1 -- "yes" --> R1["assign to assigned user"]
  C2{{"BillingCountry ≠ US<br/>SLA = Gold, Platinum<br/>Type contains Customer"}}
  C1 -- "no" --> C2
  C2 -- "yes" --> R2["assign to assigned user"]
  C3{{"BillingCountry ≠ US<br/>SLA = Silver, Bronze<br/>Type contains Customer"}}
  C2 -- "no" --> C3
  C3 -- "yes" --> R3["assign to assigned user"]
  C4{{"Type contains Partner"}}
  C3 -- "no" --> C4
  C4 -- "yes" --> R4["assign to assigned user"]
  C4 -- "no" --> N(["no change"])
```

| Escalation rule | Applies when |
|---|---|
| 1 | BillingCountry = US; SLA = Platinum; Priority = High |
| 2 | BillingCountry = US; SLA = Platinum; Priority = Medium,Low |
| 3 | BillingCountry = US; SLA = Gold; Priority = High |
| 4 | BillingCountry = US; SLA = Gold; Priority = Medium,Low |
| 5 | BillingCountry = US; SLA = Silver |
| 6 | BillingCountry = US; SLA = Bronze |
| 7 | BillingCountry ≠ US; SLA = Gold,Platinum |
| 8 | BillingCountry ≠ US; SLA = Silver,Bronze |

## 4. Data model

```mermaid
erDiagram
  Account {
    varchar id PK
    varchar name
    text type
    varchar billing_country
    text customer_priority
    text sla
    text active
    numeric numberof_locations
    text upsell_opportunity
    varchar sla_serial_number
  }
  Contact {
    varchar id PK
    varchar name
    text level
    varchar languages
  }
  Opportunity {
    varchar id PK
    varchar name
    text stage_name
    numeric amount
    text delivery_installation_status
    varchar tracking_number
    varchar order_number
    varchar current_generators
    varchar main_competitors
    text loss_reason
  }
  Product {
    varchar id PK
    varchar name
  }
  Subscription {
    varchar id PK
    varchar subscription_number
    varchar account_id FK
    boolean auto_renew
    varchar cancellation_reason
    date end_date
    numeric health_score
    numeric monthly_recurring_revenue
    date start_date
    text status
  }
  SubscriptionLine {
    varchar id PK
    varchar line_number
    varchar subscription_id FK
    numeric quantity
    numeric unit_price
    varchar account_name
    numeric line_total
  }
  Account |o--o{ Contact : "Account ID"
  Account |o--o{ Opportunity : "Account ID"
  Contact |o--o{ Opportunity : "Contact ID"
  Subscription ||--|{ SubscriptionLine : "Subscription"
  Product |o--o{ SubscriptionLine : "Product"
  Account ||--|{ Subscription : "Account"
  Contact |o--o{ Subscription : "Primary Contact"
  Opportunity |o--o{ Subscription : "Source Opportunity"
```

## 5. Security

Each Salesforce profile or permission set becomes a database role. Field-level security becomes column grants. Subscriptions inherit access from their account, as in Salesforce.

```mermaid
flowchart LR
  subgraph SFS["Salesforce"]
    profile_Admin["Profile: Admin"]
    profile_Analytics_Cloud_Integration_User["Profile: Analytics Cloud Integration User"]
    permissionSet_Subscription_Management["Permission set: Subscription_Management"]
    OWD["Account sharing<br/>(org-wide default)"]
  end
  subgraph PG["PostgreSQL"]
    PG_profile_Admin["role admin"]
    PG_profile_Analytics_Cloud_Integration_User["role analytics cloud integration user"]
    PG_permissionSet_Subscription_Management["role subscription_management"]
    RLS["row-level security<br/>can_access_account()"]
    COL["column grants<br/>(field-level security)"]
  end
  profile_Admin --> PG_profile_Admin
  PG_profile_Admin --> COL
  profile_Analytics_Cloud_Integration_User --> PG_profile_Analytics_Cloud_Integration_User
  PG_profile_Analytics_Cloud_Integration_User --> COL
  permissionSet_Subscription_Management --> PG_permissionSet_Subscription_Management
  PG_permissionSet_Subscription_Management --> COL
  OWD --> RLS
  SUB["Subscription and lines<br/>inherit access from the account"] --> RLS
```

## 6. Data migration

Records load parent first, in dependency order, keeping every Salesforce record ID.

```mermaid
flowchart LR
  subgraph L0["Level 1"]
    Account["Account<br/><small>22 rows</small>"]
    Product2["Product<br/><small>17 rows</small>"]
  end
  subgraph L1["Level 2"]
    Contact["Contact<br/><small>20 rows</small>"]
  end
  subgraph L2["Level 3"]
    Opportunity["Opportunity<br/><small>31 rows</small>"]
  end
  subgraph L3["Level 4"]
    Subscription__c["Subscription<br/><small>107 rows</small>"]
  end
  subgraph L4["Level 5"]
    Subscription_Line__c["Subscription Line<br/><small>219 rows</small>"]
  end
  L0 --> L1
  L1 --> L2
  L2 --> L3
  L3 --> L4
```

## 7. Status and open items

| Item | Status |
|---|---|
| Formulas and roll-ups | 6 generated and checked against Salesforce values |
| Validation rules | 6 compiled (checks and guards) |
| Apex translated | SubscriptionService.applyDefaults |
| Automations still to translate | OpportunityTrigger, SubscriptionTrigger, SubscriptionRenewalBatch |
| Items Salesforce keeps | see the gap register (output/inventory/gap-register.md) |
