# Installed packages: discovery and fit-gap guides

Owner: Engineering standards · used by the Discovery agent (Fit-gap sub-agent) and by reviewers at the Discover gate.

A managed package brings its own objects, code and upgrade cycle. During discovery each installed package gets a
decision (keep, plan a move, or uninstall), and custom build around it is checked against what the package already
does. The packages below have a guide of their own because they shape many decisions; every other package follows
the method on this page.

| Guide | Packages (namespace) |
|---|---|
| [consumer-goods-cloud.md](consumer-goods-cloud.md) | Consumer Goods (`cgcloud`), Consumer Goods Mobile Sync (`cgc_sync`) |
| [cpq-and-billing.md](cpq-and-billing.md) | Salesforce CPQ (`SBQQ`), Salesforce Billing (`blng`), Advanced Approvals (`sbaa`) |
| [field-service.md](field-service.md) | Field Service (`FSL`) |
| [salesforce-maps.md](salesforce-maps.md) | Salesforce Maps (`maps`) |
| [marketing.md](marketing.md) | Marketing Cloud Connect (`et4ae5`), Account Engagement (`pi`) |

[packages.json](packages.json) maps each namespace to its guide, business area and usual verdict; the Fit-gap
sub-agent reads it. [sources.json](sources.json) lists every official source behind the guides with the words
quoted from it; `node --use-system-ca src/generators/verify-kb-sources.js` opens each one again and records the date
it was confirmed. Add a guide only when a package shapes decisions in more than one org, and only with sources that
pass that check.

## Assessing any installed package

| Step | What to check | Source |
|---|---|---|
| 1. Usage | Confirm with the users that nobody relies on the package's features | [Uninstall guidance](https://help.salesforce.com/s/articleView?id=000383933&language=en_US&type=1) |
| 2. Licences | Managed package licences cannot be reported on; review them per package in Setup | [Package licences](https://help.salesforce.com/s/articleView?id=000391968&language=en_US&type=1) |
| 3. Trust | An AppExchange listing shows the date the package passed security review | [AppExchange listings](https://trailhead.salesforce.com/content/learn/modules/appexchange_basics/appexchange_basics_listings) |
| 4. Uninstall safely | Uninstall in a sandbox first ([source](https://help.salesforce.com/s/articleView?id=000383933&language=en_US&type=1)); take a full data export before production ([source](https://help.salesforce.com/s/articleView?id=000383933&language=en_US&type=1)); keep the package's data for 48 hours after uninstall ([source](https://help.salesforce.com/s/articleView?id=000383933&language=en_US&type=1)) | |
| 5. Side effects | Uninstalling can delete data outside the package's own components | [Uninstall guidance](https://help.salesforce.com/s/articleView?id=000383933&language=en_US&type=1) |

Verdicts for a package without a guide: **Retire** when unused and unlicensed; **Retain** when used and owned;
**Review with business** otherwise, with the owner, licence and usage named.
