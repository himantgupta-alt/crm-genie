# POC: Discovery without managed-package code

Owner: Ascendion engagement team · Status: in progress · internal

## Question

Much of a consumer-goods client's core logic may sit inside Salesforce-supplied packages (Trade Promotion
Management, retail execution) whose code cannot be read or exported. Can Discovery still reach a sound verdict on
every client component without that code? If yes, the proposal's high risk "package logic is hidden" can be
reduced to a note: package features are described from vendor documentation.

## Why we expect it to work

Discovery asks what the client built on top of standard and whether it should stay. A package is part of the
standard layer. What Discovery needs from it is visible without its code:

- What the package brings: name, namespace, version, objects, fields, permission sets, and the names of its Apex classes and triggers.
- How it is configured: much of a package's set-up is held as records (templates, definitions, settings), which the agents read as configuration, not business data.
- Where the client extended it: client fields, rules, flows and code on package objects, and client code that calls package classes (from the dependency index).
- What it does internally comes from the vendor's documentation and is confirmed in validation.

## Evidence so far

| Check | Org | Result |
|---|---|---|
| Package components labelled as package, not as client build | Europe demo org (Declarative Lookup Rollup Summaries, namespace dlrs) | 9 objects, 72 fields and 134 Apex classes labelled "package" |
| Package configuration captured from records, without the code | Europe demo org | The two roll-up definitions the package executes were captured by name |
| Package behaviour reproduced from its configuration | Europe demo org (migration work) | Roll-ups rebuilt from the package settings: 44 of 44 values match |
| Consumer Goods Cloud objects and set-up captured | Consumer Goods developer org (APAC) | Pending: org connection |
| Client extensions on Consumer Goods Cloud objects classified | Consumer Goods developer org (APAC) | Pending |
| Trade Promotion Management | No free org found; Trailhead states it is not available in the Trailhead Playground | Pending: partner demo org or client sandbox in pilot week 1 |

## Set-up for the Consumer Goods step

1. Free Consumer Goods Developer Edition org (signed up), connected as the APAC org.
2. Inspect: which Consumer Goods Cloud parts are standard objects and which are a managed package; required fields.
3. Deploy client-style work on top: fields on stores and visits, a validation rule and automation on visits, and custom objects that duplicate standard features (outlet audits, beat plans, must-stock lists, distributor claims).
4. Run Discovery and review the output.

## Success criteria

- Every package-owned or Salesforce-supplied component is labelled as such; nothing package-owned appears as client build.
- The configuration of each feature in use is captured from its set-up records.
- Every client extension on a package or Consumer Goods Cloud object is found and classified.
- The architects confirm that no fit-gap verdict depends on reading package code.

## Decision rule

- Criteria met on Consumer Goods Cloud and, once available, Trade Promotion Management: lower the risk in the proposal to a note on describing package features from vendor documentation.
- Not met: keep the risk and add the fallback that package behaviour is confirmed with the client's administrators during validation.
