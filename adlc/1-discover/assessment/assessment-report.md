# Brightwell Consumer Goods: Salesforce org assessment

Owner: Discovery agent · Fit-gap sub-agent, from the as-is of each org. Do not edit; run discovery again.

> Fictional company and sample markets, built in three Developer Edition orgs for the demo.

## Summary

- 1 of 3 orgs extracted; 14 of 37 markets found in the extracted orgs.
- 80 custom components classified: 44% adopt standard, 9% replace with configuration, 9% retain, 0% harmonise, 3% retire, 36% review with business.
- Cross-org comparison starts once a second org is extracted.
- 2 components are unused and can be retired before any move.
- 29 components are not matched to a known capability and go on the workshop agenda.

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
| Order to cash | Other order to cash extensions | Opportunity.DeliveryInstallationStatus__c, Opportunity.OrderNumber__c | No | Placed in this area by the objects it belongs to or uses; compare with standard Orders, Price Books and Consumer Goods Cloud order capture before a verdict | Review with business |
| Product master | Other product extensions | Lead.ProductInterest__c, Case.Product__c | No | Placed in this area by the objects it belongs to or uses; compare with standard Product and product hierarchy before a verdict | Review with business |
| Customer master | Other customer extensions | Account.Active__c, Account.CustomerPriority__c, Account.NumberofLocations__c, Account.Old_Segment__c, Account.SLAExpirationDate__c, Account.SLASerialNumber__c, Account.SLA__c, Account.UpsellOpportunity__c, Account.Won_Opportunity_Amount__c, Account.Won_Opportunity_Count__c, Contact.Languages__c, Contact.Level__c | No | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Review with business |
| Sales performance | Other sales extensions | Lead.CurrentGenerators__c, Lead.NumberofLocations__c, Lead.Primary__c, Lead.SICCode__c, Opportunity.CurrentGenerators__c, Opportunity.Loss_Reason__c, Opportunity.MainCompetitors__c, Opportunity.TrackingNumber__c, Opportunity.Closed_Won_Requires_Amount, Opportunity.Loss_Reason_Required_When_Lost | No | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Review with business |
| Service | Service extensions | Case.EngineeringReqNumber__c, Case.PotentialLiability__c, Case.SLAViolation__c | No | Placed in this area by the objects it belongs to or uses; compare with standard Service Cloud and Field Service before a verdict | Review with business |

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
| Order to cash | Other order to cash extensions | RV requires validation |
| Product master | Other product extensions | RV requires validation |
| Customer master | Other customer extensions | RV requires validation |
| Sales performance | Other sales extensions | RV requires validation |
| Service | Service extensions | RV requires validation |
| Other | Not matched to a capability | RV requires validation |

## Fit-gap by org

| Disposition | Europe | All orgs |
| --- | --- | --- |
| Adopt standard | 35 | 35 |
| Replace with configuration | 7 | 7 |
| Retain | 7 | 7 |
| Harmonise | 0 | 0 |
| Retire | 2 | 2 |
| Review with business | 29 | 29 |

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

### Retain (7)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Custom field | Account.Legacy_ERP_Code__c | Keep as an external ID field so integrations can upsert by the ERP key | Low | Strategic | High |
| Europe | Custom field | Account.VAT_Number__c | No standard tax ID field on Account: keep one global field with per-market format rules | Low | Strategic | High |
| Europe | Custom field | Product2.Brand__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Custom field | Product2.Case_Size__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Custom field | Product2.Category__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Custom field | Product2.EAN__c | Keep as fields on Product, owned by the product master (one definition for all orgs) | Low | Strategic | High |
| Europe | Validation rule | Account.VAT_Format | No standard tax ID field on Account: keep one global field with per-market format rules | Low | Strategic | High |

### Retire (2)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Apex class | StoreVisitLegacyHandler | No active trigger or class calls it and it is not an entry point (screen, flow, batch, schedule or API). | Low | Quick win | High |
| Europe | Custom field | Account.Old_Segment__c | Filled on 0% of 78 records. | Low | Quick win | Low |

### Review with business (29)

| Org | Type | Component | Why | Effort | Priority | Evidence confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Europe | Custom field | Account.Active__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.CustomerPriority__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.NumberofLocations__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.SLA__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.SLAExpirationDate__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.SLASerialNumber__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.UpsellOpportunity__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.Won_Opportunity_Amount__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Account.Won_Opportunity_Count__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Case.EngineeringReqNumber__c | Placed in this area by the objects it belongs to or uses; compare with standard Service Cloud and Field Service before a verdict | Low | Immediate | Low |
| Europe | Custom field | Case.PotentialLiability__c | Placed in this area by the objects it belongs to or uses; compare with standard Service Cloud and Field Service before a verdict | Low | Immediate | Low |
| Europe | Custom field | Case.Product__c | Placed in this area by the objects it belongs to or uses; compare with standard Product and product hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Case.SLAViolation__c | Placed in this area by the objects it belongs to or uses; compare with standard Service Cloud and Field Service before a verdict | Low | Immediate | Low |
| Europe | Custom field | Contact.Languages__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Contact.Level__c | Placed in this area by the objects it belongs to or uses; compare with standard Account, Contact and account hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Lead.CurrentGenerators__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Custom field | Lead.NumberofLocations__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Custom field | Lead.Primary__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Custom field | Lead.ProductInterest__c | Placed in this area by the objects it belongs to or uses; compare with standard Product and product hierarchy before a verdict | Low | Immediate | Low |
| Europe | Custom field | Lead.SICCode__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Custom field | Opportunity.CurrentGenerators__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Custom field | Opportunity.DeliveryInstallationStatus__c | Placed in this area by the objects it belongs to or uses; compare with standard Orders, Price Books and Consumer Goods Cloud order capture before a verdict | Low | Immediate | Low |
| Europe | Custom field | Opportunity.Loss_Reason__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Custom field | Opportunity.MainCompetitors__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Custom field | Opportunity.OrderNumber__c | Placed in this area by the objects it belongs to or uses; compare with standard Orders, Price Books and Consumer Goods Cloud order capture before a verdict | Low | Immediate | Low |
| Europe | Custom field | Opportunity.TrackingNumber__c | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Installed package | Developer Edition | Not matched to a known capability; confirm owner and purpose in the workshop. | Low | Immediate | Low |
| Europe | Validation rule | Opportunity.Closed_Won_Requires_Amount | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |
| Europe | Validation rule | Opportunity.Loss_Reason_Required_When_Lost | Placed in this area by the objects it belongs to or uses; compare with standard Opportunities, Forecasts and Territory Management before a verdict | Low | Immediate | Low |

## Method and limits

- Read-only: describe, SOQL counts and the Tooling API, with the permissions of one integration user per org. No record contents leave the org; the as-is files hold component names, counts and fill rates only.
- Each component is matched to a capability by name, then by the objects its code reads or writes (`src/agents/assessment/capabilities.json`). The verdict is the capability's default, overridden to Retire when a component is unused (no records, field filled on under 1% of records, or inactive).
- Not yet covered: page layouts and Lightning pages, reports and dashboards by usage, profiles and sharing, email templates. These are listed in the gap register of the Extraction agent for the migration and are added here in the next iteration.
- Verdicts are proposals for the workshop. Licence fit (Consumer Goods Cloud, Trade Promotion Management, Revenue Cloud) is confirmed before any verdict becomes a decision.
