// Adds a second, larger batch of demo data to the trial org: 8 accounts and 60 subscriptions with lines,
// spread across every status. Records are saved through the normal path, so validation rules, Apex
// triggers and the At-Risk flow run on them. Not idempotent: run once.
//   sf apex run --file scripts/seed-more-data.apex --target-org myorg

List<Account> newAccounts = new List<Account>{
    new Account(Name = 'Northwind Retail Group', Industry = 'Retail'),
    new Account(Name = 'Harbor Foods Distribution', Industry = 'Consumer Goods'),
    new Account(Name = 'Bluepeak Beverages', Industry = 'Consumer Goods'),
    new Account(Name = 'Meridian Home Care', Industry = 'Consumer Goods'),
    new Account(Name = 'Crescent Pharmacy Chain', Industry = 'Retail'),
    new Account(Name = 'Atlas Wholesale Partners', Industry = 'Consumer Goods'),
    new Account(Name = 'Summit Outdoor Supply', Industry = 'Retail'),
    new Account(Name = 'Lumen Personal Care', Industry = 'Consumer Goods')
};
insert newAccounts;

List<Account> accounts = [SELECT Id FROM Account ORDER BY Name];
List<Product2> products = [SELECT Id FROM Product2 ORDER BY Name];

// Deterministic spread (no randomness), so the shape is the same on any org.
String[] finalStatus = new String[]{};
for (Integer i = 0; i < 60; i++) {
    Integer m = Math.mod(i, 10);
    finalStatus.add(m < 5 ? 'Active' : m == 5 ? 'Draft' : m == 6 ? 'Suspended' : m == 7 ? 'Renewed' : 'Cancelled');
}
String[] reasons = new String[]{ 'Budget cut', 'Moved to competitor', 'Business closed', 'Merged with parent account', 'Switched to annual contract' };

List<Subscription__c> subs = new List<Subscription__c>();
for (Integer i = 0; i < 60; i++) {
    Date startDate = Date.today().addMonths(-1 * Math.mod(i * 7, 30)).addDays(-Math.mod(i * 3, 25));
    Integer term = Math.mod(i, 3) == 0 ? 12 : Math.mod(i, 3) == 1 ? 24 : 36;
    Date endDate = startDate.addMonths(term);
    // Some renewals close to today, for the renewals list.
    if (Math.mod(i, 9) == 0) { endDate = Date.today().addDays(5 + Math.mod(i, 20)); startDate = endDate.addMonths(-12); term = 12; }
    if (endDate <= Date.today()) { endDate = Date.today().addMonths(3 + Math.mod(i, 9)); }
    Decimal mrr = 400 + Math.mod(i * 137, 4600);
    subs.add(new Subscription__c(
        Account__c = accounts[Math.mod(i * 5, accounts.size())].Id,
        Start_Date__c = startDate,
        End_Date__c = endDate,
        Term_Months__c = term,
        Status__c = finalStatus[i] == 'Draft' ? 'Draft' : 'Active',
        MRR__c = mrr,
        Health_Score__c = Math.mod(i, 6) == 0 ? 35 + Math.mod(i, 12) : 55 + Math.mod(i * 11, 45),
        Auto_Renew__c = Math.mod(i, 2) == 0
    ));
}
insert subs;

List<Subscription_Line__c> lines = new List<Subscription_Line__c>();
for (Integer i = 0; i < subs.size(); i++) {
    Integer n = 1 + Math.mod(i, 4);
    for (Integer k = 0; k < n; k++) {
        lines.add(new Subscription_Line__c(
            Subscription__c = subs[i].Id,
            Product__c = products.isEmpty() ? null : products[Math.mod(i + k * 3, products.size())].Id,
            Quantity__c = 1 + Math.mod(i + k, 8),
            Unit_Price__c = 50 + Math.mod((i + 1) * (k + 3) * 41, 950)
        ));
    }
}
insert lines;

// Move to the final status after the lines exist (lines cannot be added to a cancelled subscription).
List<Subscription__c> updates = new List<Subscription__c>();
for (Integer i = 0; i < subs.size(); i++) {
    if (finalStatus[i] == 'Active' || finalStatus[i] == 'Draft') continue;
    Subscription__c u = new Subscription__c(Id = subs[i].Id, Status__c = finalStatus[i]);
    if (finalStatus[i] == 'Cancelled') u.Cancellation_Reason__c = reasons[Math.mod(i, reasons.size())];
    updates.add(u);
}
update updates;

System.debug('SEEDED accounts=' + newAccounts.size() + ' subscriptions=' + subs.size() + ' lines=' + lines.size() + ' status changes=' + updates.size());
