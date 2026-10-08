# Parity report: Subscription__c, Subscription_Line__c

Blueprint 49f2c22e6c8f, run 2026-10-08T11:22:03.751Z. **PARITY OK**

- Loaded from the org export: Account 22, Contact 20, Opportunity 31, Product2 17, Subscription__c 107, Subscription_Line__c 219
- Derived values: 866/866 rows matched across 6 derived fields
- Rule cases: 17 pass, 0 fail, 2 pending

## Derived values (Salesforce stored value vs Postgres computed value)

| Field | Strategy | Matched | Note |
|---|---|---|---|
| Subscription__c.Line_Count__c | trigger_maintained | 107/107 |  |
| Subscription__c.Annual_Value__c | generated_column | 107/107 |  |
| Subscription__c.Days_To_Renewal__c | compute_on_read | 107/107 | TODAY() pinned to 2026-10-02 |
| Subscription__c.Total_Line_Value__c | trigger_maintained | 107/107 |  |
| Subscription_Line__c.Account_Name__c | view_join | 219/219 |  |
| Subscription_Line__c.Line_Total__c | generated_column | 219/219 |  |

## Rule cases

| Case | Origin | Result |
|---|---|---|
| apex.appliesDefaultHealthScoreAndEndDate | apex-test:SubscriptionServiceTest#appliesDefaultHealthScoreAndEndDate | pass |
| apex.blocksReactivationOfCancelledSubscription | apex-test:SubscriptionServiceTest#blocksReactivationOfCancelledSubscription | pass |
| apex.rollsUpLineTotals | apex-test:SubscriptionServiceTest#rollsUpLineTotals | pass |
| apex.createsSubscriptionWhenOpportunityIsWon | apex-test:SubscriptionServiceTest#createsSubscriptionWhenOpportunityIsWon | pending: needs the Opportunity family and the OpportunityService outbox consumer |
| apex.renewalBatchRaisesTasks | apex-test:SubscriptionServiceTest#renewalBatchRaisesTasks | pending: needs the Task entity and the SubscriptionRenewalBatch cron worker |
| rule.Active_Requires_MRR.blank | rule | pass |
| rule.Active_Requires_MRR.zero | rule | pass |
| rule.Active_Requires_MRR.draftWithoutMrrAllowed | rule | pass |
| rule.Cancellation_Reason_Required | rule | pass |
| rule.End_Date_After_Start_Date | rule | pass |
| rule.No_Reactivation_After_Cancel.toSuspended | rule | pass |
| rule.Parent_Not_Cancelled | rule | pass |
| rule.Quantity_Must_Be_Positive | rule | pass |
| platform.restrictedPicklist | rule | pass |
| platform.masterDetailCascade | rule | pass |
| apex.applyDefaults.termFromDates | rule | pass |
| security.permsetEditsAllowedFields | rule | pass |
| security.readOnlyFieldsNotWritable | rule | pass |
| security.readOnlyProfileCannotEdit | rule | pass |
