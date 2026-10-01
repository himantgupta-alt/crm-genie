// POC data seeding. Idempotent: re-running deletes prior seeded subscriptions first.
// Runs through the real triggers, flows and validation rules, so the data is behaviourally true.

List<Account> accounts = [SELECT Id, Name, BillingCountry FROM Account ORDER BY Name];
List<Product2> products = [SELECT Id, Name FROM Product2 WHERE IsActive = true ORDER BY Name LIMIT 10];
Map<Id, Contact> contactByAccount = new Map<Id, Contact>();
for (Contact c : [SELECT Id, AccountId FROM Contact WHERE AccountId != null]) {
    if (!contactByAccount.containsKey(c.AccountId)) {
        contactByAccount.put(c.AccountId, c);
    }
}
System.debug('accounts=' + accounts.size() + ' products=' + products.size());

delete [SELECT Id FROM Subscription__c];

// ---- subscriptions: a deliberate spread of statuses, health and renewal dates ----
String[] statuses = new String[] { 'Active', 'Active', 'Active', 'Suspended', 'Draft', 'Cancelled' };
List<Subscription__c> subs = new List<Subscription__c>();
Integer i = 0;
for (Account a : accounts) {
    for (Integer n = 0; n < 3; n++) {
        String status = statuses[Math.mod(i, statuses.size())];
        Integer term = new Integer[] { 12, 24, 36 }[Math.mod(i, 3)];
        Integer startOffset = -1 * (30 + Math.mod(i * 37, 400));
        Date startDate = Date.today().addDays(startOffset);
        Decimal mrr = 500 + Math.mod(i * 713, 9500);

        Subscription__c s = new Subscription__c(
            Account__c = a.Id,
            Primary_Contact__c = contactByAccount.containsKey(a.Id) ? contactByAccount.get(a.Id).Id : null,
            Start_Date__c = startDate,
            End_Date__c = startDate.addMonths(term),
            Term_Months__c = term,
            Status__c = status,
            MRR__c = status == 'Draft' ? null : mrr,
            Auto_Renew__c = Math.mod(i, 2) == 0,
            Health_Score__c = 25 + Math.mod(i * 17, 70)
        );
        if (status == 'Cancelled') {
            s.Cancellation_Reason__c = new String[] {
                'Budget cut', 'Moved to competitor', 'Merger', 'Service quality'
            }[Math.mod(i, 4)];
        }
        subs.add(s);
        i++;
    }
}
insert subs;
System.debug('subscriptions inserted=' + subs.size());

// ---- lines: skip cancelled parents, which the cross-object validation rule rejects ----
List<Subscription_Line__c> lines = new List<Subscription_Line__c>();
Integer j = 0;
for (Subscription__c s : [SELECT Id, Status__c FROM Subscription__c WHERE Status__c != 'Cancelled']) {
    Integer lineCount = 1 + Math.mod(j, 3);
    for (Integer n = 0; n < lineCount; n++) {
        lines.add(new Subscription_Line__c(
            Subscription__c = s.Id,
            Product__c = products.isEmpty() ? null : products[Math.mod(j + n, products.size())].Id,
            Quantity__c = 1 + Math.mod(j + n, 25),
            Unit_Price__c = 150 + Math.mod((j + n) * 91, 1200)
        ));
    }
    j++;
}
insert lines;
System.debug('lines inserted=' + lines.size());

// ---- opportunities: close some won (fires the trigger) and some lost (needs a loss reason) ----
List<Opportunity> open = [
    SELECT Id, Name, Amount, StageName, AccountId, CloseDate
    FROM Opportunity
    WHERE StageName NOT IN ('Closed Won', 'Closed Lost') AND AccountId != null
    ORDER BY Amount DESC NULLS LAST
];
String[] lossReasons = new String[] { 'Price', 'Timing', 'Competitor', 'No Budget', 'No Decision' };
List<Opportunity> toUpdate = new List<Opportunity>();
Integer k = 0;
for (Opportunity o : open) {
    if (Math.mod(k, 3) == 0) {
        o.StageName = 'Closed Won';
        o.Amount = o.Amount == null || o.Amount <= 0 ? 24000 : o.Amount;   // Closed_Won_Requires_Amount
        toUpdate.add(o);
    } else if (Math.mod(k, 3) == 1) {
        o.StageName = 'Closed Lost';
        o.Loss_Reason__c = lossReasons[Math.mod(k, lossReasons.size())];   // Loss_Reason_Required_When_Lost
        toUpdate.add(o);
    }
    k++;
}
update toUpdate;
System.debug('opportunities closed=' + toUpdate.size());

// ---- summary ----
System.debug('TOTAL subscriptions=' + [SELECT COUNT() FROM Subscription__c]);
System.debug('TOTAL lines=' + [SELECT COUNT() FROM Subscription_Line__c]);
System.debug('from won deals=' + [SELECT COUNT() FROM Subscription__c WHERE Source_Opportunity__c != null]);
System.debug('at-risk tasks=' + [SELECT COUNT() FROM Task WHERE Subject LIKE 'Health check%']);
System.debug('save-off tasks=' + [SELECT COUNT() FROM Task WHERE Subject LIKE 'Save-off%']);
