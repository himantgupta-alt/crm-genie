# Fit-gap method

Owner: Engineering standards · used by the Assessment agent (`src/generators/apex-functions.js`,
`src/generators/emit-assessment.js`) and by reviewers at the Discover gate. Reusable for every client.

A fit-gap judges custom build against standard Salesforce features and configuration. One verdict per component
hides the detail: most components are partly standard, with some jobs that can move and others that must stay.
So each component is split into the business functions it does, and each function is judged on its own.

## Steps

| Step | What happens | Output |
|---|---|---|
| 1. Read the code | Every method mapped: records changed, queries, external calls, emails, approvals, Chatter, sharing | functions per component |
| 2. Split into functions | One row per business job, so one verdict does not hide the detail | "what it does" rows |
| 3. Match to standard | Each function checked against standard features, the capability's licensed feature, and configuration | verdict, confidence, why |
| 4. Rate the change | Effort, regression impact (what must be retested) and value of change, per component | ratings, quick wins |
| 5. Check structure | Cross-cutting risks and the order things run in | findings, move-together groups |

A trigger and the handler methods it reaches form one component ("Trigger + handlers"). Classes no trigger reaches
stand alone.

## Verdicts

| Verdict | Meaning |
|---|---|
| Adopt standard | A standard Salesforce or Consumer Goods Cloud feature already does this job |
| Replace with configuration | Simple enough for Flow, validation rules, formulas, roll-ups, approval processes or custom metadata |
| Retain | A real need with no standard option (integrations, deep clones, specialised editing); may still be simplified |
| Harmonise | The same need built differently in several orgs: align the pattern, orgs stay separate |
| Retire | Not used: inactive, or no live code calls it |
| Review with client | Depends on a business rule, setting or licence not visible in the metadata |

Confidence: **High** = clear standard match · **Medium** = likely, to confirm · **Low** = needs client input.

## Function patterns and their usual verdict

| What the code does | Usual verdict | Replace with |
|---|---|---|
| Calls an external system | Retain | Keep behind a named credential; a queue or platform event adds retries |
| Posts to Chatter | Configuration | Flow "Post to Chatter" action |
| Builds and sends emails | Adopt standard | Email template with an email alert, from a flow or approval step |
| Submits or decides approvals | Configuration | Approval process; auto-submission from a record-triggered flow |
| Keeps totals on a parent | Configuration | Roll-up summary (master-detail) or a record-triggered flow |
| Blocks the save on a field rule | Configuration | Validation rule |
| Blocks the save after reading other records | Retain, or the capability's standard | Before-save flow with a lookup, or the standard feature's own rule |
| Creates related records | Configuration, or the capability's standard | Record-triggered flow; Consumer Goods Cloud action plan templates for visit tasks |
| Calculates field values | Configuration | Formula field, or a before-save flow when the value must be stored |
| Sets a status automatically | Configuration | Approval entry criteria or a before-save flow; thresholds in custom metadata |

When the component's capability maps to a licensed standard feature (for example Trade Promotion Management funds,
or Consumer Goods Cloud visits), rules, calculations and record creation on it move with that feature.

## Ratings

| Rating | Low | Medium | High |
|---|---|---|---|
| Effort to change | up to 60 lines | up to 200 lines | more, or six or more functions |
| Regression impact | no writes to other records | writes other records, or runs in a trigger | fires another object's trigger, or integration logic moves |
| Value of change | nothing moves | one or two functions move | three or more move |

**Quick win** = a function that moves to configuration, or is retired, inside a component with low effort and no
high regression impact. Adopting a licensed feature is never a quick win: the licence comes first.

## Cross-cutting checks

| Finding | Why it matters |
|---|---|
| Dead code that looks live | Inactive triggers and classes nothing calls mislead readers and tools |
| Logic split between Apex and Flow | The order things run in is hard to follow; moves must respect it |
| Very large methods (over 150 lines) | Hard to test and change safely |
| Logic keyed on text values | User names, profile names or labels break when a label changes |
| Errors hidden from users | Catch blocks that only log make failures silent |
| Test-only code in production | `Test.isRunningTest()` means tests do not prove what runs |
| Hard-coded ID prefixes | Checks like `'005'` to tell users from queues |
| Business thresholds in code | A limit the business owns needs a developer and a release to change |

## Order of execution

Inside one Apex class, steps run in the order they are written. Once some steps become flows, Salesforce's save
order decides instead: moved logic runs after the Apex that stays. When saving one object updates another that has
its own trigger, the steps form a chain; steps that depend on each other move together, or stay together.

## Consumer goods: Retail execution and TPM

| Custom pattern | Standard feature | Licence |
|---|---|---|
| Store, outlet or field visit objects | Visit and Retail Store, visit tasks on the mobile app | Consumer Goods Cloud |
| Shelf checks, audits, compliance | Assessment tasks and retail store KPIs | Consumer Goods Cloud |
| Tasks created per visit from must-stock lists | Action plan templates | Consumer Goods Cloud |
| Store assortment, must-stock lists | Product assortments on retail store groups | Consumer Goods Cloud |
| Beat or route plans | Visit planning with retail store groups | Consumer Goods Cloud |
| Trade promotions, promotion products, post-event results | Promotion planning and post-event analysis | Trade Promotion Management |
| Trade funds and committed amounts | Funds with allocated, committed and spent amounts | Trade Promotion Management |
| Distributor or customer claims | Claims and payments checked against funds | Trade Promotion Management |
| Home-grown promotion approval | Approval process or Flow approval orchestration | Sales Cloud |

Licence fit is confirmed with the client before an adopt-standard verdict becomes a decision.

## Assumptions and limits

- The code reading is deterministic pattern matching; business intent is confirmed with the client's process experts.
- Usage (record counts, how often things run, which switches are on) can turn a verdict into Retire.
- Verdicts say what could move and how hard it is; designing the change is a later step.
- Effort includes regression testing; the testing itself is part of the change phase.

## References

- Salesforce Help: Consumer Goods Cloud, Retail Execution (visits, assessment tasks, KPIs, action plan templates)
- Salesforce Help: Trade Promotion Management (promotions, funds, claims, post-event analysis)
- Salesforce Help: Flow Builder (record-triggered flows, Post to Chatter, Send Email actions)
- Salesforce Help: Approval processes; Flow approval orchestration
- Salesforce Help: Roll-up summary fields; Validation rules; Custom metadata types
- Salesforce Developer Guide: Triggers and order of execution
