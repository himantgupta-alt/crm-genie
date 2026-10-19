# Consumer Goods Cloud (Agentforce Consumer Goods)

Owner: Engineering standards · used by the Discovery agent (Fit-gap sub-agent) and by reviewers at the Discover gate.
Packages: `cgcloud` (Consumer Goods), `cgc_sync` (Consumer Goods Mobile Sync). Every statement links to an official
Salesforce source listed in [sources.json](sources.json) and confirmed by `src/generators/verify-kb-sources.js`.

## What it is

- The product is now named Agentforce Consumer Goods ([source](https://www.salesforce.com/consumer-goods/cloud/guide/)).
- Two managed packages, installed in order: Mobile Sync first, then Consumer Goods ([source](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-cloud-offline-mobile-app-for-admins/install-the-consumer-goods-cloud-offline-mobile-app)).
- Available in Lightning Experience in Professional, Enterprise and Unlimited Editions ([source](https://trailhead.salesforce.com/content/learn/modules/retail-execution-in-consumer-goods-cloud/get-started-with-retail-execution)).
- Retail Execution is built on standard platform objects ([source](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf)); Trade Promotion Management (TPM) keeps promotions, payments and reports in the package's custom objects ([source](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf)).
- Two data models: the base model executes preplanned visits with inventory and assessment tasks; the enhanced model adds planning, orders, payments, promotions and more ([source](https://help.salesforce.com/s/articleView?id=sf.cg_concept_basic_advanced.htm&language=en_US&type=5)). Several standard Visit fields are "not applicable for the enhanced model" ([source](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf)).

## Standard features to compare custom build against

| Business area | Standard object or feature | Source |
|---|---|---|
| Stores and store products | RetailStore, InStoreLocation, StoreProduct (products sold or eligible at a store) | [Store Product](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-cloud-data-model/relate-products-to-stores) |
| Visits and visit tasks | Visit, ActionPlanTemplate (tasks reused across stores and visits), AssessmentTaskDefinition | [Action plans](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-cloud-data-model/set-up-task-definitions-and-action-plan-templates) |
| Store KPIs | RetailStoreKpi (targets), RetailVisitKpi (actuals captured on a visit) | [KPIs](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-cloud-data-model/set-up-store-visits-and-capture-data) |
| Promotions | TPM and Retail Execution promotions and assortments share the same objects with different record types | [Integration](https://trailhead.salesforce.com/content/learn/modules/integrated-promotions-with-consumer-goods-cloud/get-started-with-promotion-integration) |
| Trade promotion management | `cgcloud__Promotion__c`, `cgcloud__Tactic__c`, `cgcloud__Fund__c`, `cgcloud__Payment__c`, `cgcloud__Account_Plan__c` | [Developer Guide](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf) |
| Claims | Claim templates define claim types, payment definitions and business rules per claim type | [Claims](https://trailhead.salesforce.com/content/learn/modules/claims-management-basics-in-consumer-goods-cloud/set-up-claims) |
| Orders (enhanced model) | `cgcloud__Order__c`, `cgcloud__Order_Item__c`, extended through callable Apex customization hooks | [Developer Guide](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf) |
| Offline mobile app | Customised with Modeler; Modeler applies only to the offline mobile app | [Modeler](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-cloud-offline-mobile-app-for-admins/design-and-deploy-the-app) |

## Best practices

- Confirm whether the org runs the base or the enhanced model before mapping gaps: the same standard object behaves differently in each ([source](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf)).
- Extend standard ordering through callable Apex customization hooks rather than a separate order process ([source](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf)).
- Plan promotions once and share them between TPM and Retail Execution; they use the same objects ([source](https://trailhead.salesforce.com/content/learn/modules/integrated-promotions-with-consumer-goods-cloud/get-started-with-promotion-integration)).
- Reuse visit tasks through action plan templates instead of creating tasks visit by visit ([source](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-cloud-data-model/set-up-task-definitions-and-action-plan-templates)).
- Configure only the data model associations a scenario needs; not all are required ([source](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-cloud-data-model/get-to-know-the-consumer-goods-data-model)).
- Keep custom Modeler contracts apart from the core contracts Salesforce ships each release ([source](https://trailhead.salesforce.com/content/learn/modules/consumer-goods-modeler-quick-look/learn-about-consumer-goods-modeler)).
- Do not build on package objects documented as "for internal use only" ([source](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/retail_api.pdf)).

## What discovery flags

| Found in the org | Likely verdict | Why |
|---|---|---|
| Custom store, visit, visit task or KPI objects | Adopt standard | RetailStore, Visit, AssessmentTask and the KPI objects cover these |
| Custom promotion, fund, claim or account plan objects in a TPM org | Adopt standard | The TPM package objects cover these |
| Custom order screens or a parallel order process | Replace with configuration | Order customization hooks extend the standard process |
| Custom code or fields on internal-only package objects | Review with business | Not supported for implementation use |
| Custom offline app or sync logic | Review with business | Modeler and Sync Management are the supported route |
| Fields and automation added to standard Consumer Goods objects | Retain | The standard object is used and extended |
