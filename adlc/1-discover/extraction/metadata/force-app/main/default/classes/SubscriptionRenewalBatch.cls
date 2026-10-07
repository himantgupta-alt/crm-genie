/**
 * Nightly renewal sweep. Translation target: a cron worker — the governor limits that shaped
 * this batch size do not exist in the target, so the query must be re-bounded deliberately.
 */
public with sharing class SubscriptionRenewalBatch implements Database.Batchable<SObject>, Schedulable {

    public static final Integer NOTICE_WINDOW_DAYS = 30;

    public Database.QueryLocator start(Database.BatchableContext ctx) {
        Date cutoff = Date.today().addDays(NOTICE_WINDOW_DAYS);
        return Database.getQueryLocator([
            SELECT Id, Name, Account__c, End_Date__c, Auto_Renew__c, Health_Score__c
            FROM Subscription__c
            WHERE Status__c = 'Active' AND End_Date__c <= :cutoff AND End_Date__c >= TODAY
        ]);
    }

    public void execute(Database.BatchableContext ctx, List<Subscription__c> scope) {
        List<Task> tasks = new List<Task>();
        for (Subscription__c s : scope) {
            tasks.add(new Task(
                Subject = (s.Auto_Renew__c ? 'Confirm auto-renewal: ' : 'Renewal outreach: ') + s.Name,
                WhatId = s.Id,
                ActivityDate = s.End_Date__c,
                Priority = s.Health_Score__c != null && s.Health_Score__c < SubscriptionService.AT_RISK_THRESHOLD ? 'High' : 'Normal',
                Status = 'Not Started'
            ));
        }
        if (!tasks.isEmpty()) {
            insert tasks;
        }
    }

    public void finish(Database.BatchableContext ctx) {
        // Deliberately empty: the translated worker reports completion through its own job log.
    }

    public void execute(SchedulableContext ctx) {
        Database.executeBatch(new SubscriptionRenewalBatch(), 200);
    }
}