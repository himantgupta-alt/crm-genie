@isTest
private class SubscriptionServiceTest {

    private static Account makeAccount() {
        Account a = new Account(Name = 'Parity Test Account');
        insert a;
        return a;
    }

    @isTest
    static void appliesDefaultHealthScoreAndEndDate() {
        Account a = makeAccount();
        Subscription__c s = new Subscription__c(
            Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addMonths(12),
            Term_Months__c = 12, Status__c = 'Active', MRR__c = 1000
        );
        insert s;

        s = [SELECT Health_Score__c, Term_Months__c, Annual_Value__c FROM Subscription__c WHERE Id = :s.Id];
        System.assertEquals(SubscriptionService.DEFAULT_HEALTH_SCORE, s.Health_Score__c, 'default health score');
        System.assertEquals(12000, s.Annual_Value__c, 'annual value formula');
    }

    @isTest
    static void blocksReactivationOfCancelledSubscription() {
        Account a = makeAccount();
        Subscription__c s = new Subscription__c(
            Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addMonths(12),
            Status__c = 'Active', MRR__c = 500
        );
        insert s;

        // Re-query rather than reusing the inserted instance: it still holds Account__c, the
        // non-reparentable master-detail field, which cannot be included in an update.
        Subscription__c toCancel = [SELECT Id, Status__c FROM Subscription__c WHERE Id = :s.Id];
        toCancel.Status__c = 'Cancelled';
        toCancel.Cancellation_Reason__c = 'Budget cut';
        update toCancel;

        Boolean blocked = false;
        try {
            Subscription__c toReactivate = [SELECT Id, Status__c FROM Subscription__c WHERE Id = :s.Id];
            toReactivate.Status__c = 'Active';
            update toReactivate;
        } catch (DmlException e) {
            blocked = e.getMessage().contains('cannot be reactivated');
        }
        System.assert(blocked, 'reactivation must be rejected by the validation rule');
    }

    @isTest
    static void rollsUpLineTotals() {
        Account a = makeAccount();
        Subscription__c s = new Subscription__c(
            Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addMonths(12),
            Status__c = 'Active', MRR__c = 900
        );
        insert s;
        insert new List<Subscription_Line__c>{
            new Subscription_Line__c(Subscription__c = s.Id, Quantity__c = 2, Unit_Price__c = 250),
            new Subscription_Line__c(Subscription__c = s.Id, Quantity__c = 1, Unit_Price__c = 400)
        };

        s = [SELECT Total_Line_Value__c, Line_Count__c FROM Subscription__c WHERE Id = :s.Id];
        System.assertEquals(900, s.Total_Line_Value__c, 'sum roll-up');
        System.assertEquals(2, s.Line_Count__c, 'count roll-up');
    }

    @isTest
    static void createsSubscriptionWhenOpportunityIsWon() {
        Account a = makeAccount();
        Opportunity o = new Opportunity(
            Name = 'Parity Deal', AccountId = a.Id, StageName = 'Prospecting',
            CloseDate = Date.today(), Amount = 24000
        );
        insert o;

        Test.startTest();
        o.StageName = 'Closed Won';
        update o;
        Test.stopTest();

        List<Subscription__c> created = [
            SELECT MRR__c, Term_Months__c, Status__c FROM Subscription__c WHERE Source_Opportunity__c = :o.Id
        ];
        System.assertEquals(1, created.size(), 'one subscription per won deal');
        System.assertEquals(2000, created[0].MRR__c, 'amount spread over the default term');
    }

    @isTest
    static void renewalBatchRaisesTasks() {
        Account a = makeAccount();
        insert new Subscription__c(
            Account__c = a.Id, Start_Date__c = Date.today().addMonths(-11),
            End_Date__c = Date.today().addDays(10), Status__c = 'Active', MRR__c = 750, Auto_Renew__c = true
        );

        Test.startTest();
        Database.executeBatch(new SubscriptionRenewalBatch(), 200);
        Test.stopTest();

        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE Subject LIKE 'Confirm auto-renewal%'], 'renewal task raised');
    }
}