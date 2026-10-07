trigger OpportunityTrigger on Opportunity (after update) {
    OpportunityService.createSubscriptionsForWonDeals(Trigger.new, Trigger.oldMap);
}