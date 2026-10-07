/**
 * Creates a subscription when a deal is won. Translation target: an outbox consumer,
 * since it writes to another aggregate after the opportunity commits.
 */
public with sharing class OpportunityService {

    public static final Integer DEFAULT_TERM_MONTHS = 12;

    public static void createSubscriptionsForWonDeals(List<Opportunity> opps, Map<Id, Opportunity> oldMap) {
        Set<Id> wonOppIds = new Set<Id>();
        for (Opportunity o : opps) {
            Opportunity prior = oldMap.get(o.Id);
            if (o.StageName == 'Closed Won' && prior.StageName != 'Closed Won' && o.AccountId != null) {
                wonOppIds.add(o.Id);
            }
        }
        if (wonOppIds.isEmpty()) {
            return;
        }

        // Idempotency: never create a second subscription for the same opportunity.
        Set<Id> alreadyCreated = new Set<Id>();
        for (Subscription__c existing : [
            SELECT Source_Opportunity__c FROM Subscription__c WHERE Source_Opportunity__c IN :wonOppIds
        ]) {
            alreadyCreated.add(existing.Source_Opportunity__c);
        }

        List<Subscription__c> toCreate = new List<Subscription__c>();
        for (Opportunity o : opps) {
            if (!wonOppIds.contains(o.Id) || alreadyCreated.contains(o.Id)) {
                continue;
            }
            Date startDate = o.CloseDate == null ? Date.today() : o.CloseDate;
            toCreate.add(new Subscription__c(
                Account__c = o.AccountId,
                Source_Opportunity__c = o.Id,
                Start_Date__c = startDate,
                End_Date__c = startDate.addMonths(DEFAULT_TERM_MONTHS),
                Term_Months__c = DEFAULT_TERM_MONTHS,
                Status__c = 'Active',
                MRR__c = o.Amount == null ? 0 : (o.Amount / DEFAULT_TERM_MONTHS).setScale(2),
                Auto_Renew__c = true
            ));
        }
        if (!toCreate.isEmpty()) {
            insert toCreate;
        }
    }
}