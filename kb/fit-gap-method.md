# Fit-gap method

Owner: Engineering standards · used by the Discovery agent (As-is and Fit-gap sub-agents) and by reviewers at the
Discover gate. Reusable for any org. Installed packages and the custom build around them follow
[packages/](packages/README.md).

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
| Review with business | Depends on a business rule, setting or licence not visible in the metadata |

Confidence: **High** = clear standard match · **Medium** = likely, to confirm · **Low** = needs business input.

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

## Verdict tree

```
Used?  ── no ──► RETIRE
  │yes
Purpose known? ── no ──► REVIEW WITH BUSINESS
  │yes
Standard (core or package) does it? ── yes ──► ADOPT STANDARD   (+ "needs package upgrade" if only in the latest release)
  │no / partly
Can settings do it instead of code? ── yes ──► REPLACE WITH CONFIGURATION
  │no
RETAIN (truly needed; note if it should be simplified)
```

"Partly standard" is an outcome, not a verdict: some functions of a component can move and some cannot. Record
"x of y can move"; effort is at least Medium. Full splitting is time-boxed to the top 20 to 30 components per org.

How the custom part relates to standard:

| Relationship | Meaning | Usual verdict |
|---|---|---|
| Duplicates | Does what standard already does | Adopt standard |
| Extends | Adds to standard through a documented extension point | Retain, low debt |
| Overrides | Works around or replaces package logic (for example a package trigger switched off) | Adopt standard or Retain, high debt; expert review |
| Fills a gap | Standard has nothing for this | Retain |
| Upgrade gap | Standard has it only in a newer release than the one installed | Adopt standard, needs package upgrade |

Process Builder and Workflow Rules are no longer supported: always Replace with configuration (rebuild as a flow),
High confidence.

## Code references

Every function says where it is, so the next person opens it in seconds. No reference means the finding is not
finished.

- Apex class: `Class.method` and line range, for example `OrderService.applyDiscount L120–164`.
- Trigger: trigger name, line and context, then the handler method: `OrderTrigger L5 (before) → OrderHandler.beforeUpdate L30–58`.
- Logic in a helper: the caller and the helper method, each with lines.
- Flow: API name, version and element; validation rule or formula: object and API name.
- Lines hold for the version read: record its API version and last-modified date.
- For chains, give the reference of each link, in run order.

## Order of execution

Inside one Apex class, steps run in the order they are written. Once some steps become flows, Salesforce's save
order decides instead. One record save:

1. Load the record; system checks (required fields, formats)
2. Before-save record-triggered flows
3. Before triggers (Apex)
4. System checks again, then validation rules
5. Duplicate rules
6. Record saved (not yet committed)
7. After triggers (Apex)
8. Assignment rules, auto-response rules
9. Workflow rules (field updates re-run update triggers once)
10. Escalation rules, entitlement rules
11. After-save record-triggered flows
12. Roll-up summary fields on the parent (the parent goes through its own save)
13. Criteria-based sharing
14. Commit
15. After commit: emails sent, asynchronous Apex (future, queueable), asynchronous flow paths

Where moved logic lands:

| The function | Moves to | Runs at step | Watch out |
|---|---|---|---|
| Sets fields on the same record | Before-save flow, or formula | 2 | Runs before before-triggers; a trigger that stays still sees the value |
| Blocks a save with an error | Validation rule | 4 | Sees values the before-triggers set |
| Updates or creates related records | After-save flow | 11 | Runs after after-triggers: Apex that stays cannot use its result in the same save |
| Sends email, notification or Chatter post | Flow action or email alert | 11 (email at 15) | Usually safe: a good quick win |
| Sums or counts children | Roll-up summary | 12 | The parent saves again: its triggers and flows run |
| Calls another system | Apex (asynchronous) or an asynchronous flow path | 15 | Never in the same transaction as the save |

Rules:

1. A function that only uses results of Apex that stays may move to an after-save flow.
2. A function whose result is used by Apex that stays, and that would land later than that Apex, cannot move alone:
   move it as a group with what depends on it, or keep it.
3. Chains move or stay together. Mark them sequence-sensitive; regression impact is High, with a list of what to retest
   (the full business flow, not just the one object).
4. An after-save flow that updates the same record is a second save: triggers run again. Check the recursion guard.
5. Static recursion flags in Apex have no flow equivalent: use entry conditions ("only when field X changed").
6. Several flows on one object: set their trigger order. Flow order cannot be set relative to Apex triggers.
7. More than one trigger on an object already has no fixed order: note it as a finding.
8. Hints that the order mattered before: comments like "moved from Flow to Apex" or "must run after", static flags,
   methods called in a fixed sequence inside one handler.

When saving one object updates another that has its own trigger, the steps form a chain across objects; the same rules
apply.

## Roll-up: area, process, sub-process

Findings are made low (objects, fields, validation rules, the functions in the code) and read high. Each
capability in the catalogue (a process, such as Store visits or Trade funds) lists its sub-processes, with patterns
for the objects, fields, rules and methods that serve each one. A finding rolls up to the first sub-process it
matches, otherwise to the first sub-process of its own capability; fields count only where a sub-process names them.

The fitment code of a sub-process comes from what rolled up to it: Requires validation if anything is unresolved;
Technical-debt candidate if custom objects or code do what standard or configuration could; Differentiating custom
if custom objects or code stay; Extended standard if only fields were added; Configured standard if only rules or
flows; Native standard if nothing custom was found. The heatmap reads area → process → sub-process by org, and each
cell lists the findings behind it with their code references.

## Review

- Rules close the easy rows (High confidence): unused, inactive, Process Builder or Workflow, exact catalogue match.
  Reviewers spot-check these.
- Reviewers check every Medium and Low row and every code component; the TPM expert reviews everything on the
  package's own objects.
- Review order: switched-off package triggers and the code that replaced them; custom objects; code on package
  objects; screens that replace package screens; then other Apex, flows and the rest.
- Each row records the reviewer and the date.

## The headline: how much is custom?

A single percentage misleads, so show three views per org:

1. By component count: standard, package, custom configuration, custom code.
2. By capability: capabilities mainly standard versus mainly custom.
3. By build size: lines of custom Apex against configuration (flows, validation rules, fields).

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

Licence fit is confirmed before an adopt-standard verdict becomes a decision.

Before judging anything on the Consumer Goods Cloud package's own objects, read the package switches (its trigger and
validation-rule settings) and the installed version: a package trigger that is switched off is the strongest sign
that custom code overrides it. The installed package wins over the catalogue: if they differ, trust the org's
schema. Never match to objects the package marks as for future or internal use.

## Assumptions and limits

- The code reading is deterministic pattern matching; business intent is confirmed with process experts.
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
