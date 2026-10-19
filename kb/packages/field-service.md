# Salesforce Field Service

Owner: Engineering standards · used by the Discovery agent (Fit-gap sub-agent) and by reviewers at the Discover gate.
Package: `FSL` (with the core Field Service objects: WorkOrder, ServiceAppointment, ServiceResource, ServiceTerritory).
Every statement links to an official Salesforce source listed in [sources.json](sources.json) and confirmed by
`src/generators/verify-kb-sources.js`.

## What it is

- Core features (work orders, service appointments, resources, territories) are configured in Setup once Field Service is enabled ([source](https://trailhead.salesforce.com/en/modules/field_service_basics/units/field_service_basics_intro)).
- The managed package adds the scheduling console for scheduling and optimization ([source](https://trailhead.salesforce.com/en/modules/field_service_basics/units/field_service_basics_intro)).
- Enhanced Scheduling and Optimization is the current scheduling engine ([source](https://www.salesforce.com/service/field-service-management/)).

## Standard features to compare custom build against

| Need | Standard feature | Source |
|---|---|---|
| Who can do a job, and who is best | Scheduling policy: work rules filter candidates, service objectives rank them | [Policies](https://trailhead.salesforce.com/content/learn/modules/field-service-lightning-scheduling-basics/examine-scheduling-policies) |
| A rule the standard ones do not cover | Custom work rule, configured | [Policies](https://trailhead.salesforce.com/content/learn/modules/field-service-lightning-scheduling-basics/examine-scheduling-policies) |
| Reacting to in-day events (a job ends early, a worker is late) | Scheduling recipes | [In-day changes](https://trailhead.salesforce.com/content/learn/modules/field-service-lightning-optimization/handle-inday-changes) |
| Templates for common jobs | Work types | [Work types](https://trailhead.salesforce.com/content/learn/projects/modify-the-field-service-center/create-a-work-type) |
| Recurring maintenance | Maintenance plans generate future work orders | [Maintenance plans](https://trailhead.salesforce.com/content/learn/modules/field_service_maint/field_service_maint_plan) |
| Offline access to other data, including custom objects | Offline Briefcase | [Briefcase](https://trailhead.salesforce.com/content/learn/modules/offline-briefcase/allow-access-to-information-online) |

## Best practices

- Optimize 1 to 7 days ahead; most schedules change too often for longer horizons ([source](https://trailhead.salesforce.com/content/learn/modules/field-service-lightning-optimization/plan-ahead-with-global-optimization)).
- Keep pinned appointments to a minimum; optimization does not move them ([source](https://trailhead.salesforce.com/content/learn/modules/field-service-lightning-optimization/plan-ahead-with-global-optimization)).
- Avoid very large territory hierarchies, which risk performance and platform limits ([source](https://architect.salesforce.com/docs/architect/fundamentals/guide/field-service-contractor-sharing-patterns.html)), and many small territories with few resources, which add scheduling overhead ([source](https://architect.salesforce.com/docs/architect/fundamentals/guide/field-service-contractor-sharing-patterns.html)).

## What discovery flags

| Found in the org | Likely verdict | Why |
|---|---|---|
| Apex that picks or ranks technicians | Replace with configuration | Work rules and service objectives |
| Triggers that reschedule after a status change | Replace with configuration | Scheduling recipes |
| Custom job templates or recurring-visit generators | Adopt standard | Work types and maintenance plans |
| A custom offline app or offline data sync | Review with business | The mobile app and Offline Briefcase |
| Hundreds of territories, or territories with one or two resources | Review with business | Territory design guidance |
