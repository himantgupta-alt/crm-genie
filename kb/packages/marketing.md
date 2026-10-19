# Marketing Cloud Connect and Account Engagement

Owner: Engineering standards · used by the Discovery agent (Fit-gap sub-agent) and by reviewers at the Discover gate.
Packages: `et4ae5` (Marketing Cloud Connect), `pi` (Marketing Cloud Account Engagement, formerly Pardot). Every
statement links to an official Salesforce source listed in [sources.json](sources.json) and confirmed by
`src/generators/verify-kb-sources.js`.

## Marketing Cloud Connect

- Connects Marketing Cloud Engagement with the data management, segmentation and campaign tools in Salesforce ([source](https://help.salesforce.com/apex/HTViewHelpDoc?id=sf.mc_co_marketing_cloud_connect.htm&language=en_US)); the managed package adds its own objects for sends and tracking ([source](https://help.salesforce.com/s/articleView?id=000390389&language=en_US&type=1)).
- Does not work with Professional Edition ([source](https://help.salesforce.com/s/articleView?id=mktg.mc_co_account_edition_compatibility_faqs.htm&language=en_US&type=5)).
- Use a dedicated system user as the connector's API user ([source](https://help.salesforce.com/s/articleView?id=mc_co_user_types_and_permissions.htm&language=en_US&type=5)).
- Tracking data is kept for the "Number of Days to Track" setting; manage it to control data storage ([source](https://help.salesforce.com/apex/HTViewHelpDoc?id=sf.mc_co_tracking_data_management.htm&language=en_US)).
- Synchronized data sources: no more than 20 fields per object for best performance ([source](https://help.salesforce.com/s/articleView?id=mc_co_implement_synchronized_data_sources_best_practices.htm&language=en_US&type=5)); do not rename synchronized objects or change their API names ([source](https://help.salesforce.com/s/articleView?id=mc_co_implement_synchronized_data_sources_best_practices.htm&language=en_US&type=5)).

## Account Engagement (formerly Pardot)

- Renamed from Pardot ([source](https://www.salesforce.com/in/blog/what-is-salesforce-pardot/)).
- Syncs with Salesforce about every 2 minutes ([source](https://trailhead.salesforce.com/content/learn/modules/pardot-salesforce-integration-for-lightning-app/integrate-pardot-with-salesforce)), through one connector only ([source](https://trailhead.salesforce.com/content/learn/modules/pardot-salesforce-integration-for-lightning-app/integrate-pardot-with-salesforce)); the integration user needs no Sales Cloud licence ([source](https://trailhead.salesforce.com/content/learn/modules/pardot-salesforce-integration-for-lightning-app/integrate-pardot-with-salesforce)).
- The two systems have different authorization and sharing models ([source](https://trailhead.salesforce.com/content/learn/modules/pardot-salesforce-integration-for-lightning-app/integrate-pardot-with-salesforce)); existing Salesforce leads and contacts do not sync to Account Engagement automatically ([source](https://trailhead.salesforce.com/content/learn/modules/pardot-salesforce-integration-for-lightning-app/plan-your-integration)).

## Direction

- Marketing Cloud Next complements and extends Marketing Cloud Engagement rather than replacing it ([source](https://trailhead.salesforce.com/content/learn/modules/marketing-cloud-next-for-marketing-cloud-engagement-foundations/get-to-know-marketing-cloud-next-with-marketing-cloud-engagement)); existing Account Engagement email programs continue as they run today ([source](https://trailhead.salesforce.com/content/learn/modules/marketing-cloud-next-for-marketing-cloud-account-engagement-basics/meet-marketing-cloud-next-for-account-engagement)).

## What discovery flags

| Found in the org | Likely verdict | Why |
|---|---|---|
| Custom email send or tracking objects next to Marketing Cloud Connect | Adopt standard | The connector's send and tracking objects |
| Connector API user that is a named person | Review with business | A dedicated system user is recommended |
| Large tracking volumes with no retention set | Review with business | Data storage |
| More than one marketing automation sync into the same records | Review with business | One connector; different sharing models |
| Custom lead sync code alongside Account Engagement | Replace with configuration | The connector syncs about every 2 minutes |
