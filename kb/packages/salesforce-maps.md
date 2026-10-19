# Salesforce Maps

Owner: Engineering standards · used by the Discovery agent (Fit-gap sub-agent) and by reviewers at the Discover gate.
Package: `maps` (Salesforce Maps, Maps Advanced, Territory Planning). Every statement links to an official Salesforce
source listed in [sources.json](sources.json) and confirmed by `src/generators/verify-kb-sources.js`.

## What it is, and what has changed

- Salesforce Maps plots records of objects such as Account, Case or Lead ([source](https://help.salesforce.com/s/articleView?id=salesforce_maps_setup_base_objects_manage.htm&language=en_US&type=5)).
- Maps Advanced automates schedules and routes up to three months ahead ([source](https://help.salesforce.com/s/articleView?id=sales.salesforce_maps_setup_maps_advanced.htm&language=en_US&type=5)). Trailhead gives a different horizon; take the Help page as current.
- Live Tracking is an add-on ([source](https://trailhead.salesforce.com/content/learn/modules/salesforce-maps-basics/get-to-know-salesforce-maps)); Territory Planning can be bought on its own or with Maps ([source](https://trailhead.salesforce.com/content/learn/modules/salesforce-maps-basics/get-to-know-salesforce-maps)).
- The standalone Maps mobile app retires on 31 August 2026 ([source](https://help.salesforce.com/s/articleView?id=005314199&language=en_US&type=1)); after that date Live Tracking Mobile no longer records new geolocation data ([source](https://help.salesforce.com/s/articleView?id=000389876&language=en_US&type=1)).
- Uploading CSV location data was retired on 16 May 2025 ([source](https://help.salesforce.com/s/articleView?id=000393311&language=en_US&type=1)).
- Consumer Goods Cloud uses Salesforce Maps to sequence store visits ([source](https://trailhead.salesforce.com/content/learn/modules/retail-execution-in-consumer-goods-cloud/extend-consumer-goods-cloud-with-more-features)).

## Standard features to compare custom build against

| Need | Standard feature | Source |
|---|---|---|
| Calendar entries for planned stops | Schedules create Salesforce Events for stops | [Route or schedule](https://help.salesforce.com/s/articleView?id=000381117&language=en_US&type=1) |
| Visit history and check-in records | Check-in and check-out are recorded as activities | [Check-in](https://help.salesforce.com/s/articleView?id=000381408&language=en_US&type=1) |
| Territory design without touching live assignments | Territory Planning works on data isolated from production | [Territory Planning](https://trailhead.salesforce.com/content/learn/modules/salesforce-maps-territory-planning/create-an-optimal-territory-alignment) |
| Bulk geocoding | Up to 250,000 records per geocoding job | [Batch geocoding](https://help.salesforce.com/s/articleView?id=000389884&language=en_US&type=1) |

## Best practices

- Install and test in a sandbox before production ([source](https://help.salesforce.com/s/articleView?id=000380147&language=en_US&type=1)).
- Use local addresses for the most accurate geocoding ([source](https://help.salesforce.com/s/articleView?id=000380848&language=en_US&type=1)).
- Shape-layer territories suit fewer than 100 territories and 50,000 records; above that, consider Enterprise Territory Management ([source](https://help.salesforce.com/s/articleView?id=000356382&language=en_US&type=1)).

## What discovery flags

| Found in the org | Likely verdict | Why |
|---|---|---|
| Custom geocoding callouts or map components | Adopt standard | Maps geocoding and map layers |
| Custom route or visit sequencing | Adopt standard | Routes, schedules and Maps Advanced (Consumer Goods Cloud uses it for store visits) |
| Custom check-in or visit logging | Adopt standard | Check-in activities |
| Users on the standalone Maps mobile app, or Live Tracking Mobile | Review with business | Retired on 31 August 2026 |
| Imports that depend on CSV location upload | Review with business | Retired on 16 May 2025 |
| Shape-layer territories beyond 100 territories or 50,000 records | Review with business | Enterprise Territory Management |
