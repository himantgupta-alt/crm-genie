# Brightwell Consumer Goods: Salesforce org assessment

Owner: Discovery agent · Fit-gap sub-agent, from the as-is of each org. Do not edit; run discovery again.

> Fictional company and sample markets, built in three Developer Edition orgs for the demo.

## Summary

- 1 of 3 orgs extracted; 14 of 37 markets found in the extracted orgs.
- 80 custom components classified: 44% adopt standard, 9% replace with configuration, 41% retain, 0% harmonise, 3% retire, 4% review with business.
- Cross-org comparison starts once a second org is extracted.
- 2 components are unused and can be retired before any move.
- 3 components are not matched to a known capability and go on the workshop agenda.

## Orgs and markets

| Org | Status | Edition | Markets | Customers with a market |
| --- | --- | --- | --- | --- |
| Europe | Extracted | Developer Edition | 14: United Kingdom, Ireland, France, Germany, Netherlands, Belgium, Spain, Portugal, Italy, Poland, Sweden, Denmark, Switzerland, Austria | 56 |
| APAC | Not yet extracted |  |  |  |
| Americas & LATAM | Not yet extracted |  |  |  |

## As-is: what each org has built

| Measure | Europe |
| --- | --- |
| Custom objects | 11 |
| Custom fields (all objects) | 115 |
| Custom fields on standard objects | 39 |
| Apex classes (excluding tests) | 8 |
| Apex triggers | 6 |
| Lines of Apex (classes and triggers) | 409 |
| Flows | 1 |
| Validation rules | 13 |
| Installed packages | 2 |
| Records in custom objects | 1637 |
| Outbound integrations (Apex callouts) | 1 |

## The same capability, built per org

Each row is a business capability; each cell lists the components that implement it in that org. "Built differently" means two or more orgs use different custom objects for the same need.

| Area | Capability | Europe | Built differently | Standard feature | Verdict |
| --- | --- | --- | --- | --- | --- |
| Retail execution | Store visits | Store_Visit__c, StoreVisitLegacyHandler, StoreVisitService, StoreVisitTrigger | No | Consumer Goods Cloud: Visit and Retail Store, with visit tasks on the mobile app | Adopt standard |
| Retail execution | Visit tasks | Visit_Task__c | No | Consumer Goods Cloud: action plan templates create the tasks of each visit (assessment, inventory and price checks) | Adopt standard |
| Retail execution | Shelf checks and in-store audits | Shelf_Check__c, ShelfCheckTrigger | No | Consumer Goods Cloud: assessment tasks and retail store KPIs recorded during a visit | Adopt standard |
| Retail execution | Store assortment and must-stock lists | Store_Assortment__c | No | Consumer Goods Cloud: product assortments assigned to retail store groups | Adopt standard |
| Trade promotion management (TPM) | Trade promotions and deals | Promotion_Product__c, Trade_Promotion__c, TradePromotionService, TradePromotionTrigger, Trade_Promotion__c.Budget_Required_To_Submit, Trade_Promotion__c.End_After_Start | No | Consumer Goods Cloud Trade Promotion Management: promotion planning, funds and post-event analysis | Adopt standard |
| Trade promotion management (TPM) | Trade funds | Trade_Fund__c, Trade_Fund__c.Amount_Positive | No | Trade Promotion Management: funds with allocated, committed and spent amounts kept by the platform | Adopt standard |
| Trade promotion management (TPM) | Distributor and customer claims | Promotion_Claim__c, PromotionClaimService, PromotionClaimTrigger, Promotion_Claim__c.Claim_Positive | No | Trade Promotion Management: claims and payments checked against promotion funds | Adopt standard |
| Trade promotion management (TPM) | Promotion approval | TradePromotionApproval | No | Approval processes or Flow approval orchestration, with the threshold held as configuration | Replace with configuration |
| Sales performance | Sales targets | Sales_Target__c | No | Collaborative Forecasts with quotas by user, territory or product family | Replace with configuration |
| Customer master | Market and channel segmentation | Account.Customer_Channel__c, Account.Customer_Tier__c, Account.Market__c, Account.Store_Format__c | No | Global value sets shared by all orgs, with Enterprise Territory Management for market ownership | Replace with configuration |
| Customer master | Customer tax registration | Account.VAT_Number__c, Account.VAT_Format | No | No standard tax ID field on Account: keep one global field with per-market format rules | Retain |
| Customer master | ERP customer key | Account.Legacy_ERP_Code__c | No | Keep as an external ID field so integrations can upsert by the ERP key | Retain |
| Customer master | Contact consent | Contact.Consent_Date__c, Contact.GDPR_Consent__c | No | Individual and contact point consent objects with data use purposes | Adopt standard |
| Product master | Product attributes | Product2.Brand__c, Product2.Case_Size__c, Product2.Category__c, Product2.EAN__c | No | Keep as fields on Product, owned by the product master (one definition for all orgs) | Retain |
| Other | Subscriptions | Subscription_Line__c, Subscription__c, OpportunityService, SubscriptionRenewalBatch, SubscriptionService, OpportunityTrigger, SubscriptionTrigger, Subscription_At_Risk_Alert, Subscription__c.Active_Requires_MRR, Subscription__c.Cancellation_Reason_Required, Subscription__c.End_Date_After_Start_Date, Subscription__c.No_Reactivation_After_Cancel, Subscription_Line__c.Parent_Not_Cancelled, Subscription_Line__c.Quantity_Must_Be_Positive | No | Revenue Cloud subscription management | Adopt standard |
| Platform | Roll-ups between related records | Declarative Lookup Rollup Summaries Tool | No | Roll-up summary fields where the relationship is master-detail, record-triggered flows elsewhere | Replace with configuration |
| Customer master | Account and contact management | Account.Active__c, Account.CustomerPriority__c, Account.NumberofLocations__c, Account.Old_Segment__c, Account.SLAExpirationDate__c, Account.SLASerialNumber__c, Account.SLA__c, Account.UpsellOpportunity__c, Account.Won_Opportunity_Amount__c, Account.Won_Opportunity_Count__c, Contact.Languages__c, Contact.Level__c | No | Accounts, contacts, person accounts and duplicate management | Review with business |
| Product master | Product definition | — | No | Products and product families | Review with business |
| Product master | Pricing with price books | — | No | Standard and custom price books with price book entries | Review with business |
| Sales performance | Lead management | Lead.CurrentGenerators__c, Lead.NumberofLocations__c, Lead.Primary__c, Lead.ProductInterest__c, Lead.SICCode__c | No | Capture, assign and convert leads | Review with business |
| Sales performance | Opportunity management | Opportunity.CurrentGenerators__c, Opportunity.DeliveryInstallationStatus__c, Opportunity.Loss_Reason__c, Opportunity.MainCompetitors__c, Opportunity.OrderNumber__c, Opportunity.TrackingNumber__c, Opportunity.Closed_Won_Requires_Amount, Opportunity.Loss_Reason_Required_When_Lost | No | Opportunities with stages, contact roles and products | Review with business |
| Sales performance | Campaign management | — | No | Campaign hierarchies and campaign members with statuses | Review with business |
| Service | Case management | Case.EngineeringReqNumber__c, Case.PotentialLiability__c, Case.Product__c, Case.SLAViolation__c | No | Case intake, assignment and escalation rules | Review with business |
| Service | Entitlements and service levels | — | No | Entitlements with milestones | Review with business |
| Service | Work orders | — | No | Work orders from work type templates | Review with business |

## Fitment heatmap

Each org is assessed in its own implementation context. Codes: NS native standard, CS configured standard, ES extended standard, DC differentiating custom, TD technical-debt candidate, RV requires validation. Customisation is not automatically technical debt; it becomes a concern when cost, complexity or risk is out of proportion to the business value.

| Area | Capability / process | Europe |
| --- | --- | --- |
| Retail execution | Store visits | TD technical-debt candidate |
| Retail execution | Visit tasks | TD technical-debt candidate |
| Retail execution | Shelf checks and in-store audits | TD technical-debt candidate |
| Retail execution | Store assortment and must-stock lists | TD technical-debt candidate |
| Trade promotion management (TPM) | Trade promotions and deals | TD technical-debt candidate |
| Trade promotion management (TPM) | Trade funds | TD technical-debt candidate |
| Trade promotion management (TPM) | Distributor and customer claims | TD technical-debt candidate |
| Trade promotion management (TPM) | Promotion approval | TD technical-debt candidate |
| Sales performance | Sales targets | TD technical-debt candidate |
| Customer master | Market and channel segmentation | ES extended standard |
| Customer master | Customer tax registration | ES extended standard |
| Customer master | ERP customer key | ES extended standard |
| Customer master | Contact consent | ES extended standard |
| Product master | Product attributes | ES extended standard |
| Other | Subscriptions | TD technical-debt candidate |
| Platform | Roll-ups between related records | CS configured standard |
| Customer master | Account and contact management | ES extended standard |
| Product master | Product definition | NS native standard |
| Product master | Pricing with price books | NS native standard |
| Sales performance | Lead management | ES extended standard |
| Sales performance | Opportunity management | RV requires validation |
| Sales performance | Campaign management | CS configured standard |
| Service | Case management | ES extended standard |
| Service | Entitlements and service levels | CS configured standard |
| Service | Work orders | CS configured standard |
| Other | Not matched to a capability | RV requires validation |

## Standard processes: model in use, set-up and fitment by step

For each standard process with records or custom work: which model holds its records (core Salesforce or an installed package), the set-up held as records on each step, and why each step has its fitment code.

### Customer master: Account and contact management

- Europe: Runs on the Core Salesforce. Core Salesforce: 78 accounts, 20 contacts, 8 users, 18 user roles, 3 duplicate rules, 3 matching rules. Fitment ES: The standard is extended: fields Account.Active__c, Account.CustomerPriority__c, Account.NumberofLocations__c, Account.Old_Segment__c and 8 more; set up as records: 44 profiles.

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Record companies and people | ES | 44 profiles | The standard is extended: fields Account.Active__c, Account.CustomerPriority__c, Account.NumberofLocations__c, Account.Old_Segment__c and 8 more; set up as records: 44 profiles. |
| Person accounts for consumers | NS | none | Nothing custom and no records on this step: it looks unused in this org. |
| Prevent duplicates | NS | none | Nothing custom; the standard is used as delivered (3 duplicate rules, 3 matching rules). |

### Product master: Product definition

- Europe: Runs on the Core Salesforce. Core Salesforce: 27 product2s. Fitment NS: Nothing custom; the standard is used as delivered (27 product2s).

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Create products | NS | none | Nothing custom; the standard is used as delivered (27 product2s). |
| Categorise products | NS | none | Nothing custom and no records on this step: it looks unused in this org. |

### Product master: Pricing with price books

- Europe: Runs on the Core Salesforce. Core Salesforce: 2 pricebook2s, 34 pricebook entries. Fitment NS: Nothing custom; the standard is used as delivered (2 pricebook2s, 34 pricebook entries).

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Standard price book | NS | none | Nothing custom; the standard is used as delivered (2 pricebook2s). |
| Custom price books per segment or region | NS | none | Nothing custom and no records on this step: it looks unused in this org. |
| Price book entries | NS | none | Nothing custom; the standard is used as delivered (34 pricebook entries). |

### Sales performance: Lead management

- Europe: Runs on the Core Salesforce. Core Salesforce: 22 leads. Fitment ES: The standard is extended: fields Lead.CurrentGenerators__c, Lead.NumberofLocations__c, Lead.Primary__c, Lead.ProductInterest__c and 1 more.

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Capture and assign leads | ES | none | The standard is extended: fields Lead.CurrentGenerators__c, Lead.NumberofLocations__c, Lead.Primary__c, Lead.ProductInterest__c and 1 more. |
| Convert leads | NS | none | Nothing custom and no records on this step: it looks unused in this org. |

### Sales performance: Opportunity management

- Europe: Runs on the Core Salesforce. Core Salesforce: 31 opportunities, 0 opportunity contact roles, 0 opportunity line items. Fitment RV: To validate before a verdict: Opportunity.Closed_Won_Requires_Amount, Opportunity.Loss_Reason_Required_When_Lost. The standard is set up as records: 4 campaigns.

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Work opportunities through stages | RV | 4 campaigns | To validate before a verdict: Opportunity.Closed_Won_Requires_Amount, Opportunity.Loss_Reason_Required_When_Lost. The standard is set up as records: 4 campaigns. |
| Add products to opportunities | NS | none | Nothing custom and no records on this step: it looks unused in this org. |

### Sales performance: Campaign management

- Europe: Runs on the Core Salesforce. Core Salesforce: 4 campaigns, 0 campaign members, 12 campaign member status, 94 flow records. Fitment CS: Nothing custom; the standard is configured, set up as records: 94 flow record versions, 2 record types.

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Plan campaigns and track members | CS | 94 flow record versions, 2 record types | Nothing custom; the standard is configured, set up as records: 94 flow record versions, 2 record types. |

### Service: Case management

- Europe: Runs on the Core Salesforce. Core Salesforce: 26 cases, 26 case history2s. Fitment ES: The standard is extended: fields Case.EngineeringReqNumber__c, Case.PotentialLiability__c, Case.Product__c, Case.SLAViolation__c.

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Take in cases | ES | none | The standard is extended: fields Case.EngineeringReqNumber__c, Case.PotentialLiability__c, Case.Product__c, Case.SLAViolation__c. |
| Assign and escalate | NS | none | Nothing custom and no records on this step: it looks unused in this org. |

### Service: Entitlements and service levels

- Europe: Runs on the Core Salesforce. Core Salesforce: 1 entitlement, 0 service contracts, 0 case milestones. Fitment CS: Nothing custom; the standard is configured, set up as records: 1 business hours, 3 milestone types, 1 sla process.

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Entitlements and milestones | CS | 1 business hours, 3 milestone types, 1 sla process | Nothing custom; the standard is configured, set up as records: 1 business hours, 3 milestone types, 1 sla process. |

### Service: Work orders

- Europe: Set up, not yet used. Core Salesforce: 0 work orders, 0 work order line items, 0 work types. Fitment CS: Nothing custom; the standard is configured, set up as records: 1 business hours.

| Step | Europe: fitment | Europe: set-up records | Europe: why |
| --- | --- | --- | --- |
| Plan field work | CS | 1 business hours | Nothing custom; the standard is configured, set up as records: 1 business hours. |

## Fit-gap by org

| Disposition | Europe | All orgs |
| --- | --- | --- |
| Adopt standard | 35 | 35 |
| Replace with configuration | 7 | 7 |
| Retain | 33 | 33 |
| Harmonise | 0 | 0 |
| Retire | 2 | 2 |
| Review with business | 3 | 3 |

### Adopt standard (35)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Apex class | OpportunityService | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Apex class | PromotionClaimService | Trade Promotion Management: claims and payments checked against promotion funds | Low | Medium term | High |
| Europe | Apex class | StoreVisitService | Consumer Goods Cloud: Visit and Retail Store, with visit tasks on the mobile app | Low | Medium term | High |
| Europe | Apex class | SubscriptionRenewalBatch | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Apex class | SubscriptionService | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Apex class | TradePromotionService | Consumer Goods Cloud Trade Promotion Management: promotion planning, funds and post-event analysis | Medium | Medium term | High |
| Europe | Apex trigger | OpportunityTrigger | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Apex trigger | PromotionClaimTrigger | Trade Promotion Management: claims and payments checked against promotion funds | Low | Medium term | Medium |
| Europe | Apex trigger | ShelfCheckTrigger | Consumer Goods Cloud: assessment tasks and retail store KPIs recorded during a visit | Low | Medium term | Medium |
| Europe | Apex trigger | StoreVisitTrigger | Consumer Goods Cloud: Visit and Retail Store, with visit tasks on the mobile app | Low | Medium term | Medium |
| Europe | Apex trigger | SubscriptionTrigger | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Apex trigger | TradePromotionTrigger | Consumer Goods Cloud Trade Promotion Management: promotion planning, funds and post-event analysis | Low | Medium term | Medium |
| Europe | Custom field | Contact.Consent_Date__c | Individual and contact point consent objects with data use purposes. Note: filled on 0% of 20 records. | Low | Medium term | High |
| Europe | Custom field | Contact.GDPR_Consent__c | Individual and contact point consent objects with data use purposes. Note: filled on 0% of 20 records. | Low | Medium term | High |
| Europe | Custom object | Promotion_Claim__c | Trade Promotion Management: claims and payments checked against promotion funds | Medium | Medium term | High |
| Europe | Custom object | Promotion_Product__c | Consumer Goods Cloud Trade Promotion Management: promotion planning, funds and post-event analysis | Medium | Medium term | High |
| Europe | Custom object | Shelf_Check__c | Consumer Goods Cloud: assessment tasks and retail store KPIs recorded during a visit | Medium | Medium term | High |
| Europe | Custom object | Store_Assortment__c | Consumer Goods Cloud: product assortments assigned to retail store groups | Medium | Medium term | High |
| Europe | Custom object | Store_Visit__c | Consumer Goods Cloud: Visit and Retail Store, with visit tasks on the mobile app | Medium | Medium term | High |
| Europe | Custom object | Subscription__c | Revenue Cloud subscription management | Medium | Medium term | High |
| Europe | Custom object | Subscription_Line__c | Revenue Cloud subscription management | Medium | Medium term | High |
| Europe | Custom object | Trade_Fund__c | Trade Promotion Management: funds with allocated, committed and spent amounts kept by the platform | Medium | Medium term | High |
| Europe | Custom object | Trade_Promotion__c | Consumer Goods Cloud Trade Promotion Management: promotion planning, funds and post-event analysis | Medium | Medium term | High |
| Europe | Custom object | Visit_Task__c | Consumer Goods Cloud: action plan templates create the tasks of each visit (assessment, inventory and price checks) | Medium | Medium term | High |
| Europe | Flow | Subscription_At_Risk_Alert | Revenue Cloud subscription management | Low | Medium term | Medium |
| Europe | Validation rule | Promotion_Claim__c.Claim_Positive | Trade Promotion Management: claims and payments checked against promotion funds | Low | Medium term | High |
| Europe | Validation rule | Subscription__c.Active_Requires_MRR | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Validation rule | Subscription__c.Cancellation_Reason_Required | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Validation rule | Subscription__c.End_Date_After_Start_Date | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Validation rule | Subscription__c.No_Reactivation_After_Cancel | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Validation rule | Subscription_Line__c.Parent_Not_Cancelled | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Validation rule | Subscription_Line__c.Quantity_Must_Be_Positive | Revenue Cloud subscription management | Low | Medium term | High |
| Europe | Validation rule | Trade_Fund__c.Amount_Positive | Trade Promotion Management: funds with allocated, committed and spent amounts kept by the platform | Low | Medium term | High |
| Europe | Validation rule | Trade_Promotion__c.Budget_Required_To_Submit | Consumer Goods Cloud Trade Promotion Management: promotion planning, funds and post-event analysis | Low | Medium term | High |
| Europe | Validation rule | Trade_Promotion__c.End_After_Start | Consumer Goods Cloud Trade Promotion Management: promotion planning, funds and post-event analysis | Low | Medium term | High |

### Replace with configuration (7)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Apex class | TradePromotionApproval | Approval processes or Flow approval orchestration, with the threshold held as configuration | Low | Quick win | High |
| Europe | Custom field | Account.Customer_Channel__c | Global value sets shared by all orgs, with Enterprise Territory Management for market ownership | Low | Quick win | High |
| Europe | Custom field | Account.Customer_Tier__c | Global value sets shared by all orgs, with Enterprise Territory Management for market ownership | Low | Quick win | High |
| Europe | Custom field | Account.Market__c | Global value sets shared by all orgs, with Enterprise Territory Management for market ownership | Low | Quick win | High |
| Europe | Custom field | Account.Store_Format__c | Global value sets shared by all orgs, with Enterprise Territory Management for market ownership | Low | Quick win | High |
| Europe | Custom object | Sales_Target__c | Collaborative Forecasts with quotas by user, territory or product family | Medium | Quick win | High |
| Europe | Installed package | Declarative Lookup Rollup Summaries Tool | Roll-up summary fields where the relationship is master-detail, record-triggered flows elsewhere | Medium | Quick win | High |

### Retain (33)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Custom field | Account.Active__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.CustomerPriority__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.Legacy_ERP_Code__c | Keep as an external ID field so integrations can upsert by the ERP key | Low | Strategic | High |
| Europe | Custom field | Account.NumberofLocations__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.SLA__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.SLAExpirationDate__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.SLASerialNumber__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.UpsellOpportunity__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.VAT_Number__c | No standard tax ID field on Account: keep one global field with per-market format rules | Low | Strategic | High |
| Europe | Custom field | Account.Won_Opportunity_Amount__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Account.Won_Opportunity_Count__c | Extends Account, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Case.EngineeringReqNumber__c | Extends Case, the standard object of "Take in cases". | Low | Strategic | Medium |
| Europe | Custom field | Case.PotentialLiability__c | Extends Case, the standard object of "Take in cases". | Low | Strategic | Medium |
| Europe | Custom field | Case.Product__c | Extends Case, the standard object of "Take in cases". | Low | Strategic | Medium |
| Europe | Custom field | Case.SLAViolation__c | Extends Case, the standard object of "Take in cases". | Low | Strategic | Medium |
| Europe | Custom field | Contact.Languages__c | Extends Contact, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Contact.Level__c | Extends Contact, the standard object of "Record companies and people". | Low | Strategic | Medium |
| Europe | Custom field | Lead.CurrentGenerators__c | Extends Lead, the standard object of "Capture and assign leads". | Low | Strategic | Medium |
| Europe | Custom field | Lead.NumberofLocations__c | Extends Lead, the standard object of "Capture and assign leads". | Low | Strategic | Medium |
| Europe | Custom field | Lead.Primary__c | Extends Lead, the standard object of "Capture and assign leads". | Low | Strategic | Medium |
| Europe | Custom field | Lead.ProductInterest__c | Extends Lead, the standard object of "Capture and assign leads". | Low | Strategic | Medium |
| Europe | Custom field | Lead.SICCode__c | Extends Lead, the standard object of "Capture and assign leads". | Low | Strategic | Medium |
| Europe | Custom field | Opportunity.CurrentGenerators__c | Extends Opportunity, the standard object of "Work opportunities through stages". | Low | Strategic | Medium |
| Europe | Custom field | Opportunity.DeliveryInstallationStatus__c | Extends Opportunity, the standard object of "Work opportunities through stages". | Low | Strategic | Medium |
| Europe | Custom field | Opportunity.Loss_Reason__c | Extends Opportunity, the standard object of "Work opportunities through stages". | Low | Strategic | Medium |
| Europe | Custom field | Opportunity.MainCompetitors__c | Extends Opportunity, the standard object of "Work opportunities through stages". | Low | Strategic | Medium |
| Europe | Custom field | Opportunity.OrderNumber__c | Extends Opportunity, the standard object of "Work opportunities through stages". | Low | Strategic | Medium |
| Europe | Custom field | Opportunity.TrackingNumber__c | Extends Opportunity, the standard object of "Work opportunities through stages". | Low | Strategic | Medium |
| Europe | Custom field | Product2.Brand__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Custom field | Product2.Case_Size__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Custom field | Product2.Category__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Custom field | Product2.EAN__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Validation rule | Account.VAT_Format | No standard tax ID field on Account: keep one global field with per-market format rules | Low | Strategic | High |

### Retire (2)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Apex class | StoreVisitLegacyHandler | Nothing refers to it (no code, Lightning component, Visualforce page or flow) and it is no entry point (screen, flow, batch, schedule or API); usage logs are not available in this org, so confirm it is unused. | Low | Quick win | Medium |
| Europe | Custom field | Account.Old_Segment__c | Filled on 0% of 78 records. | Low | Quick win | Medium |

### Review with business (3)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Installed package | Developer Edition | Not matched to a known capability; confirm owner and purpose in the workshop. | Low | Immediate | Low |
| Europe | Validation rule | Opportunity.Closed_Won_Requires_Amount | Custom logic on Opportunity in "Work opportunities through stages"; check whether the standard feature or configuration already covers it. | Low | Immediate | Medium |
| Europe | Validation rule | Opportunity.Loss_Reason_Required_When_Lost | Custom logic on Opportunity in "Work opportunities through stages"; check whether the standard feature or configuration already covers it. | Low | Immediate | Medium |

## Method and limits

- Read-only: describe, SOQL counts and the Tooling API, with the permissions of one integration user per org. No record contents leave the org; the as-is files hold component names, counts and fill rates only.
- Each component is matched to a capability by name, then by the objects its code reads or writes (`src/agents/assessment/capabilities.json`). The verdict is the capability's default, overridden to Retire when a component is unused (no records, field filled on under 1% of records, or inactive).
- Flows are placed on a process step by their definition: the records they create, start from and change (`kb/capabilities/processes.json`); a flow that only reads is placed on the capability without a step. A name is used only when a flow works on nothing but common objects (accounts, tasks, users).
- Components that work only on records of an installed package that holds no standard process object are kept under "Other products", named after that package, unless their records place them on a process step. A name prefix shared by many components across several business areas is flagged as a kit to confirm.
- For every step, the records that hang off its standard objects and what they point to (templates, definitions) are read from the org's own relationships and counted, with the package (or core Salesforce) that holds them; a step configured only through records is "configured standard", not "nothing custom". Objects that components of many business areas point to (accounts, users, activities) are treated as common and never place a component.
- Not yet covered: page layouts and Lightning pages, reports and dashboards by usage, profiles and sharing, email templates. These are listed in the gap register of the Extraction agent for the migration and are added here in the next iteration.
- Verdicts are proposals for the workshop. Licence fit (Consumer Goods Cloud, Trade Promotion Management, Revenue Cloud) is confirmed before any verdict becomes a decision.
