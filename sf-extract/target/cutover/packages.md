# Vendor packages

Prepared by our team from the org inventory. Owner: **Modelling agent**; we review it with you at that phase's gate.

The vendor hides the code of each installed package. We still take everything around it: its objects, its data and its settings. We record what the package does as input → output test cases, then agree with you whether to rebuild it, replace it, or keep it on Salesforce for now.

## Developer Edition (`devedapp`, version v0.9)

| What | Count | How we take it |
|---|---|---|
| Package objects | 0 | describe |
| Objects holding records | 0 | data export |
| Settings records saved | 0 | `output/inventory/packages/devedapp/` |
| Apex classes | 4 | source hidden by the vendor |

| Decision | Value |
|---|---|
| Business owner | _to confirm with you_ |
| In use? | no records found |
| Our proposed route | not needed: installed but holds no records |
| Test cases from your data | _planned_ |

## Declarative Lookup Rollup Summaries Tool (`dlrs`, version Release)

| What | Count | How we take it |
|---|---|---|
| Package objects | 8 | describe |
| Objects holding records | 1 | data export |
| Settings records saved | 2 | `output/inventory/packages/dlrs/` |
| Apex classes | 134 | source hidden by the vendor |

Objects with records:

- `dlrs__LookupRollupSummary__c` (object) — 2 rows

### Rebuilt from its settings: Account_Won_Opportunity_Count

The package stores this rollup as a settings record. We read it and rebuilt the behaviour without the package code:

```sql
-- Account_Won_Opportunity_Count: Account.Won_Opportunity_Count__c = Count of Opportunity.Id where StageName = 'Closed Won'
UPDATE Account p SET Won_Opportunity_Count__c = COALESCE((
  SELECT COUNT(Id) FROM Opportunity c
  WHERE c.AccountId = p.Id AND c.StageName = 'Closed Won'
), 0);
```

Compared with the values the package wrote: **22 of 22 Account records match**. Records with no matching child count as zero on both sides.

### Rebuilt from its settings: Account_Won_Opportunity_Amount

The package stores this rollup as a settings record. We read it and rebuilt the behaviour without the package code:

```sql
-- Account_Won_Opportunity_Amount: Account.Won_Opportunity_Amount__c = Sum of Opportunity.Amount where StageName = 'Closed Won'
UPDATE Account p SET Won_Opportunity_Amount__c = COALESCE((
  SELECT SUM(Amount) FROM Opportunity c
  WHERE c.AccountId = p.Id AND c.StageName = 'Closed Won'
), 0);
```

Compared with the values the package wrote: **22 of 22 Account records match**. Records with no matching child count as zero on both sides.

| Decision | Value |
|---|---|
| Business owner | _to confirm with you_ |
| In use? | yes: 2 Lookup Rollup Summary |
| Our proposed route | rebuild: the behaviour is fully described by its settings and matches the package output |
| Test cases from your data | 44 (one per parent record per rollup) |
