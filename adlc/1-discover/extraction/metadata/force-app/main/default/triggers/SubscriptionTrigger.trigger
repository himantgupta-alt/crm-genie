trigger SubscriptionTrigger on Subscription__c (before insert, before update, after update) {
    if (Trigger.isBefore) {
        SubscriptionService.applyDefaults(Trigger.new);
    } else if (Trigger.isAfter && Trigger.isUpdate) {
        SubscriptionService.handleStatusChange(Trigger.new, Trigger.oldMap);
    }
}