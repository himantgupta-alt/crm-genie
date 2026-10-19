# Salesforce CPQ, Salesforce Billing and Advanced Approvals

Owner: Engineering standards · used by the Discovery agent (Fit-gap sub-agent) and by reviewers at the Discover gate.
Packages: `SBQQ` (Salesforce CPQ), `blng` (Salesforce Billing), `sbaa` (Advanced Approvals). Every statement links to an
official Salesforce source listed in [sources.json](sources.json) and confirmed by `src/generators/verify-kb-sources.js`.

## Status: end of sale, no forced migration

- Salesforce CPQ is end of sale; support continues for the duration of existing contracts ([source](https://help.salesforce.com/s/articleView?id=005388761&language=en_US&type=1)). End of sale means no new licences for new customers ([source](https://www.salesforce.com/sales/cpq/end-of-life/)).
- The CPQ package remains available to existing customers with no new feature development ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)); the same applies to the Billing package, with Billing in Revenue Cloud recommended ([source](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/apex_reference_blng.pdf)).
- Revenue Cloud Advanced is named as the successor ([source](https://www.salesforce.com/sales/cpq/end-of-life/)); there is no forced migration ([source](https://www.salesforce.com/sales/cpq/end-of-life/)). The migration approach depends on CPQ complexity, data quality, pricing logic and appetite for change ([source](https://www.salesforce.com/sales/cpq/migrations/)).
- Versions more than two major releases behind the generally available version lose Standard Success Plan support ([source](https://help.salesforce.com/s/articleView?id=000380904&language=en_US&type=1)).
- Revenue Cloud has its own approval feature also called Advanced Approvals; name the product when recording a finding ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)).

## Standard features to compare custom build against

| Need | Package feature | Source |
|---|---|---|
| Prices | CPQ uses standard Salesforce price books | [CPQ Help](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf) |
| Price calculation | Price rules update quote line fields | [Price rules](https://trailhead.salesforce.com/content/learn/modules/salesforce-cpq-features/product-and-price-rules) |
| Copying fields between quote, quote line, order and opportunity product | "Twin fields": matching custom fields pass values automatically | [CPQ Help](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf) |
| Changing how the quote calculator composes a quote | A custom script in the Quote Calculator Plugin is the only supported way | [CPQ Help](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf) |
| Multi-step or complex approvals | Advanced Approvals extends the standard approval process | [Advanced Approvals](https://trailhead.salesforce.com/content/learn/modules/advanced-approvals-for-admins/discover-advanced-approvals) |

## Best practices

- Keep the Quote Batch Size between 100 and 400 ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)); most orgs reach governor limits around 500 quote lines per batch ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)).
- Limit quote line groups to 40 per quote ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)) and keep nested bundles one to three levels deep ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)).
- Consolidate similar price rules with lookup queries, which must never return more than one row ([source](https://trailhead.salesforce.com/content/learn/modules/price-rules-in-salesforce-cpq/consolidate-price-rules-by-using-lookup-queries)).
- Authorise the quote calculator with a non-human admin user ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)).
- Create the order from the quote and the contract from the order ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)).
- Do not edit or deactivate the package's validation rules ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)); permission sets cloned from the package defaults miss later permission updates ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)).
- API Access Control is incompatible with Salesforce CPQ ([source](https://resources.docs.salesforce.com/rel1/doc/en-us/static/pdf/salesforce_cpq_help_doc.pdf)).

## What discovery flags

| Found in the org | Likely verdict | Why |
|---|---|---|
| The package itself | Review with business | End of sale: plan the roadmap (stay, or move to Revenue Cloud) with the business owner |
| Apex or flows copying fields between quote, order and opportunity product | Replace with configuration | Twin fields do this |
| Pricing triggers or classes outside price rules and the calculator plugin | Replace with configuration | Price rules, or the plugin where a script is unavoidable |
| Many near-identical price rules | Replace with configuration | One lookup-based rule |
| Edited or inactive package validation rules | Review with business | Not supported |
| Permission sets cloned from the package defaults | Review with business | Miss package permission updates |
| Custom approval logic alongside Advanced Approvals | Replace with configuration | Approval rules and chains |
| Package version far behind the current release | Review with business | Support ends two major releases behind |
