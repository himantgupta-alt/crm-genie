/**
 * Subscription domain logic. Translation targets: applyDefaults becomes a BEFORE trigger or
 * service hook; handleStatusChange becomes an after-commit service call.
 */
public with sharing class SubscriptionService {

    public static final Integer DEFAULT_HEALTH_SCORE = 70;
    public static final Integer AT_RISK_THRESHOLD = 50;

    /** Fills derived defaults that Salesforce cannot express as field defaults. */
    public static void applyDefaults(List<Subscription__c> subs) {
        for (Subscription__c s : subs) {
            if (s.Health_Score__c == null) {
                s.Health_Score__c = DEFAULT_HEALTH_SCORE;
            }
            if (s.Start_Date__c != null && s.Term_Months__c != null && s.End_Date__c == null) {
                s.End_Date__c = s.Start_Date__c.addMonths(Integer.valueOf(s.Term_Months__c));
            }
            if (s.Start_Date__c != null && s.End_Date__c != null && s.Term_Months__c == null) {
                s.Term_Months__c = s.Start_Date__c.monthsBetween(s.End_Date__c);
            }
        }
    }

    /**
     * On cancellation, stamp the account and raise a save-off task for the owner.
     * Recursion guard matters here: the update below re-enters this trigger.
     */
    private static Boolean processing = false;

    public static void handleStatusChange(List<Subscription__c> subs, Map<Id, Subscription__c> oldMap) {
        if (processing) {
            return;
        }
        List<Task> tasks = new List<Task>();
        Set<Id> accountIds = new Set<Id>();

        for (Subscription__c s : subs) {
            Subscription__c prior = oldMap.get(s.Id);
            Boolean justCancelled = s.Status__c == 'Cancelled' && prior.Status__c != 'Cancelled';
            if (justCancelled) {
                accountIds.add(s.Account__c);
                tasks.add(new Task(
                    Subject = 'Save-off call: ' + s.Name,
                    WhatId = s.Id,
                    ActivityDate = Date.today().addDays(2),
                    Priority = 'High',
                    Status = 'Not Started'
                ));
            }
        }

        if (!tasks.isEmpty()) {
            processing = true;
            insert tasks;
            processing = false;
        }
    }

    /** Aggregate used by reporting and by the renewal batch. */
    public static Decimal totalActiveMrr(Id accountId) {
        AggregateResult[] rows = [
            SELECT SUM(MRR__c) total
            FROM Subscription__c
            WHERE Account__c = :accountId AND Status__c = 'Active'
        ];
        Decimal total = (Decimal) rows[0].get('total');
        return total == null ? 0 : total;
    }
}