// The three regional sales orgs of the assessment demo: one fictional consumer-goods company, Brightwell
// Consumer Goods, with 37 sample markets. Each org solves the same business needs (store visits, shelf checks,
// trade promotions, assortment, targets) in its own custom way, the way regional orgs drift apart, so the
// assessment has real overlap, duplication and fit-gap findings to show. All names and markets are sample data.
//
// seed-cpg.js turns this into deployable metadata and seed data; nothing here is read by the assessment itself,
// which only looks at what it extracts from the orgs.

const COMPANY = 'Brightwell Consumer Goods';

const REGIONS = {
  eu: {
    label: 'Europe', alias: 'myorg', currency: 'EUR',
    markets: ['United Kingdom', 'Ireland', 'France', 'Germany', 'Netherlands', 'Belgium', 'Spain', 'Portugal', 'Italy', 'Poland', 'Sweden', 'Denmark', 'Switzerland', 'Austria'],
  },
  apac: {
    label: 'APAC', alias: 'apac', currency: 'USD',
    markets: ['India', 'Indonesia', 'Philippines', 'Thailand', 'Vietnam', 'Malaysia', 'Singapore', 'Australia', 'New Zealand', 'Japan', 'South Korea', 'China'],
  },
  amer: {
    label: 'Americas & LATAM', alias: 'amer', currency: 'USD',
    markets: ['United States', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Ecuador', 'Guatemala', 'Uruguay'],
  },
};

const BRANDS = ['Aurora', 'Clearbrook', 'Pinehurst', 'Solace', 'Verdi'];
const CATEGORIES = ['Home Care', 'Personal Care', 'Foods', 'Refreshment'];
const CHANNELS = ['Modern Trade', 'Traditional Trade', 'E-commerce', 'Wholesale'];

// Field helpers: { name, type, label, ...options }
const text = (name, label, length = 80) => ({ name, type: 'Text', label, length });
const longText = (name, label) => ({ name, type: 'LongTextArea', label });
const pick = (name, label, values) => ({ name, type: 'Picklist', label, values });
const check = (name, label) => ({ name, type: 'Checkbox', label });
const date = (name, label, required = false) => ({ name, type: 'Date', label, required });
const num = (name, label, precision = 10, scale = 0) => ({ name, type: 'Number', label, precision, scale });
const money = (name, label) => ({ name, type: 'Currency', label, precision: 16, scale: 2 });
const pct = (name, label) => ({ name, type: 'Percent', label, precision: 5, scale: 2 });
const lookup = (name, label, to, relationshipName) => ({ name, type: 'Lookup', label, to, relationshipName });
const master = (name, label, to, relationshipName) => ({ name, type: 'MasterDetail', label, to, relationshipName });
const rollup = (name, label, op, child, fk, field) => ({ name, type: 'Summary', label, op, child, fk, field });

const visitStatus = pick('Status__c', 'Status', ['Planned', 'Completed', 'Cancelled']);
const promoStatus = (values) => pick('Status__c', 'Status', values);

// Fields every org added to Account and Product2, plus the regional ones.
const accountCommon = (markets) => [
  pick('Market__c', 'Market', markets),
  pick('Customer_Channel__c', 'Customer Channel', CHANNELS),
  pick('Customer_Tier__c', 'Customer Tier', ['A', 'B', 'C']),
  text('Legacy_ERP_Code__c', 'Legacy ERP Code', 20),
  text('Old_Segment__c', 'Old Segment (unused)', 40),
];
const productCommon = [
  pick('Brand__c', 'Brand', BRANDS),
  pick('Category__c', 'Category', CATEGORIES),
  text('EAN__c', 'EAN', 13),
  num('Case_Size__c', 'Case Size', 4),
];

const ORGS = {
  eu: {
    standardFields: {
      Account: [...accountCommon(REGIONS.eu.markets), pick('Store_Format__c', 'Store Format', ['Hypermarket', 'Supermarket', 'Convenience', 'Discounter', 'Pharmacy']), text('VAT_Number__c', 'VAT Number', 20)],
      Contact: [check('GDPR_Consent__c', 'GDPR Consent'), date('Consent_Date__c', 'Consent Date')],
      Product2: productCommon,
    },
    objects: [
      { name: 'Store_Visit__c', label: 'Store Visit', plural: 'Store Visits', format: 'SV-{00000}', feeds: true, fields: [
        lookup('Account__c', 'Store', 'Account', 'Store_Visits'), date('Visit_Date__c', 'Visit Date', true), visitStatus,
        pick('Visit_Type__c', 'Visit Type', ['Routine', 'Promotion Check', 'New Listing', 'Audit']), longText('Notes__c', 'Notes'),
        rollup('Shelf_Checks__c', 'Shelf Checks', 'count', 'Shelf_Check__c', 'Store_Visit__c'),
        check('Checked_In__c', 'Checked In'), num('Check_In_Latitude__c', 'Check-in Latitude', 9, 6), num('Check_In_Longitude__c', 'Check-in Longitude', 9, 6),
        num('Out_Of_Stocks__c', 'Out of Stocks', 3), pct('Compliance_Pct__c', 'Shelf Compliance'),
      ] },
      { name: 'Visit_Task__c', label: 'Visit Task', plural: 'Visit Tasks', format: 'VT-{00000}', fields: [
        master('Store_Visit__c', 'Store Visit', 'Store_Visit__c', 'Visit_Tasks'), pick('Task_Type__c', 'Task Type', ['Check must-stock', 'Check price', 'Check display', 'Take photo', 'Survey']),
        lookup('Product__c', 'Product', 'Product2', 'Visit_Tasks'), check('Done__c', 'Done'), text('Result__c', 'Result', 80),
      ] },
      { name: 'Shelf_Check__c', label: 'Shelf Check', plural: 'Shelf Checks', format: 'SC-{00000}', fields: [
        master('Store_Visit__c', 'Store Visit', 'Store_Visit__c', 'Shelf_Checks'), lookup('Product__c', 'Product', 'Product2', 'Shelf_Checks'),
        check('On_Shelf__c', 'On Shelf'), num('Facings__c', 'Facings', 3), money('Shelf_Price__c', 'Shelf Price'),
      ] },
      { name: 'Trade_Fund__c', label: 'Trade Fund', plural: 'Trade Funds', format: 'TF-{0000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Trade_Funds'), pick('Fund_Type__c', 'Fund Type', ['Fixed', 'Accrual', 'Off-invoice']), num('Year__c', 'Year', 4),
        money('Amount__c', 'Amount'), money('Committed__c', 'Committed'), pick('Status__c', 'Status', ['Open', 'Closed']),
      ] },
      { name: 'Trade_Promotion__c', label: 'Trade Promotion', plural: 'Trade Promotions', format: 'TP-{0000}', feeds: true, fields: [
        lookup('Account__c', 'Customer', 'Account', 'Trade_Promotions'), date('Start_Date__c', 'Start Date', true), date('End_Date__c', 'End Date', true),
        pick('Mechanic__c', 'Mechanic', ['Price Off', 'Multibuy', 'Display', 'Feature']), money('Budget__c', 'Budget'), pct('Uplift_Pct__c', 'Expected Uplift'),
        promoStatus(['Draft', 'Submitted', 'Approved', 'Live', 'Closed']),
        lookup('Trade_Fund__c', 'Trade Fund', 'Trade_Fund__c', 'Trade_Promotions'), num('Baseline_Volume__c', 'Baseline Volume (cases)', 8), num('Actual_Volume__c', 'Actual Volume (cases)', 8),
        money('Actual_Spend__c', 'Actual Spend'), pct('ROI__c', 'Return on Investment'), check('ERP_Synced__c', 'Sent to ERP'),
      ] },
      { name: 'Promotion_Claim__c', label: 'Promotion Claim', plural: 'Promotion Claims', format: 'PC-{00000}', fields: [
        lookup('Trade_Promotion__c', 'Trade Promotion', 'Trade_Promotion__c', 'Promotion_Claims'), lookup('Account__c', 'Customer', 'Account', 'Promotion_Claims'),
        money('Claim_Amount__c', 'Claim Amount'), text('Invoice_Number__c', 'Invoice Number', 30), pick('Status__c', 'Status', ['Submitted', 'Matched', 'Approved', 'Paid', 'Rejected']),
      ] },
      { name: 'Promotion_Product__c', label: 'Promotion Product', plural: 'Promotion Products', format: 'PP-{00000}', fields: [
        master('Trade_Promotion__c', 'Trade Promotion', 'Trade_Promotion__c', 'Promotion_Products'), lookup('Product__c', 'Product', 'Product2', 'Promotion_Products'),
        pct('Discount_Pct__c', 'Discount'),
      ] },
      { name: 'Store_Assortment__c', label: 'Store Assortment', plural: 'Store Assortments', format: 'SA-{00000}', fields: [
        lookup('Account__c', 'Store', 'Account', 'Store_Assortments'), lookup('Product__c', 'Product', 'Product2', 'Store_Assortments'), check('Must_Stock__c', 'Must Stock'),
      ] },
      { name: 'Sales_Target__c', label: 'Sales Target', plural: 'Sales Targets', format: 'ST-{0000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Sales_Targets'), date('Period_Start__c', 'Period Start', true), pick('Category__c', 'Category', CATEGORIES), money('Target_Amount__c', 'Target Amount'),
      ] },
    ],
    validationRules: [
      { object: 'Trade_Promotion__c', name: 'End_After_Start', formula: 'End_Date__c &lt; Start_Date__c', message: 'End Date must be on or after Start Date.', field: 'End_Date__c' },
      { object: 'Trade_Promotion__c', name: 'Budget_Required_To_Submit', formula: "AND(ISPICKVAL(Status__c, 'Submitted'), ISBLANK(Budget__c))", message: 'Add a budget before submitting the promotion.', field: 'Budget__c' },
      { object: 'Account', name: 'VAT_Format', formula: 'AND(NOT(ISBLANK(VAT_Number__c)), NOT(REGEX(VAT_Number__c, "[A-Z]{2}[0-9A-Z]{2,13}")))', message: 'VAT number must start with the two-letter country code.', field: 'VAT_Number__c' },
      { object: 'Trade_Fund__c', name: 'Amount_Positive', formula: 'Amount__c &lt;= 0', message: 'The fund amount must be greater than zero.', field: 'Amount__c' },
      { object: 'Promotion_Claim__c', name: 'Claim_Positive', formula: 'Claim_Amount__c &lt;= 0', message: 'Claim amount must be greater than zero.', field: 'Claim_Amount__c' },
    ],
    // A home-grown approval: promotions under 10,000 approve themselves on submit, the rest wait for a manager.
    apex: {
      classes: {
        TradePromotionApproval: `
public with sharing class TradePromotionApproval {
    public static final Decimal AUTO_APPROVE_LIMIT = 10000;
    public static void apply(List<Trade_Promotion__c> promos, Map<Id, Trade_Promotion__c> oldMap) {
        for (Trade_Promotion__c p : promos) {
            Trade_Promotion__c old = oldMap == null ? null : oldMap.get(p.Id);
            Boolean submitted = p.Status__c == 'Submitted' && (old == null || old.Status__c != 'Submitted');
            if (submitted && p.Budget__c != null && p.Budget__c < AUTO_APPROVE_LIMIT) p.Status__c = 'Approved';
        }
    }
}`,
        // Grown over several releases: post-event results, fund checks, announcements and the ERP hand-off.
        TradePromotionService: `
public with sharing class TradePromotionService {
    // Margin per case used for the return on investment; finance sets it once a year.
    public static final Decimal MARGIN_PER_CASE = 2.5;

    // Post-event result: return on investment from baseline and actual volume.
    public static void calculateResults(List<Trade_Promotion__c> promos) {
        for (Trade_Promotion__c p : promos) {
            if (p.Baseline_Volume__c == null || p.Actual_Volume__c == null || p.Actual_Spend__c == null || p.Actual_Spend__c == 0) continue;
            Decimal incremental = (p.Actual_Volume__c - p.Baseline_Volume__c) * MARGIN_PER_CASE;
            Decimal roi = (incremental - p.Actual_Spend__c) / p.Actual_Spend__c * 100;
            p.ROI__c = Math.max(-999, Math.min(999, roi)).setScale(2);
        }
    }

    // A promotion may not commit more than is left in its trade fund.
    public static void checkFund(List<Trade_Promotion__c> promos, Map<Id, Trade_Promotion__c> oldMap) {
        Set<Id> fundIds = new Set<Id>();
        for (Trade_Promotion__c p : promos) if (p.Trade_Fund__c != null) fundIds.add(p.Trade_Fund__c);
        if (fundIds.isEmpty()) return;
        Map<Id, Trade_Fund__c> funds = new Map<Id, Trade_Fund__c>([SELECT Id, Amount__c, Committed__c FROM Trade_Fund__c WHERE Id IN :fundIds]);
        for (Trade_Promotion__c p : promos) {
            Trade_Fund__c f = funds.get(p.Trade_Fund__c);
            if (f == null || f.Amount__c == null || p.Budget__c == null) continue;
            Trade_Promotion__c old = oldMap == null ? null : oldMap.get(p.Id);
            Decimal own = old != null && old.Trade_Fund__c == p.Trade_Fund__c && old.Budget__c != null && old.Status__c != 'Draft' ? old.Budget__c : 0;
            Decimal committed = f.Committed__c == null ? 0 : f.Committed__c;
            if (committed - own + p.Budget__c > f.Amount__c) p.addError('The promotion budget exceeds what is left in the trade fund.');
        }
    }

    // Keeps the committed amount on each trade fund up to date.
    public static void updateFundCommitted(Set<Id> fundIds) {
        fundIds.remove(null);
        if (fundIds.isEmpty()) return;
        Map<Id, Decimal> committed = new Map<Id, Decimal>();
        for (Id i : fundIds) committed.put(i, 0);
        for (AggregateResult r : [SELECT Trade_Fund__c f, SUM(Budget__c) s FROM Trade_Promotion__c WHERE Trade_Fund__c IN :fundIds AND Status__c != 'Draft' GROUP BY Trade_Fund__c]) {
            committed.put((Id) r.get('f'), (Decimal) r.get('s'));
        }
        List<Trade_Fund__c> upd = new List<Trade_Fund__c>();
        for (Id i : committed.keySet()) upd.add(new Trade_Fund__c(Id = i, Committed__c = committed.get(i)));
        update upd;
    }

    // Tells the team on the promotion's feed that it is approved.
    public static void postApprovalToChatter(List<Trade_Promotion__c> promos, Map<Id, Trade_Promotion__c> oldMap) {
        List<FeedItem> posts = new List<FeedItem>();
        for (Trade_Promotion__c p : promos) {
            if (p.Status__c != 'Approved' || oldMap.get(p.Id).Status__c == 'Approved') continue;
            posts.add(new FeedItem(ParentId = p.Id, Body = 'Promotion ' + p.Name + ' is approved with a budget of ' + p.Budget__c + '.'));
        }
        if (!posts.isEmpty()) Database.insert(posts, false);
    }

    // Emails the key account manager (the promotion owner) when the promotion is approved.
    public static void emailKeyAccountManager(List<Trade_Promotion__c> promos, Map<Id, Trade_Promotion__c> oldMap) {
        List<Messaging.SingleEmailMessage> mails = new List<Messaging.SingleEmailMessage>();
        for (Trade_Promotion__c p : promos) {
            if (p.Status__c != 'Approved' || oldMap.get(p.Id).Status__c == 'Approved') continue;
            Messaging.SingleEmailMessage m = new Messaging.SingleEmailMessage();
            m.setTargetObjectId(p.OwnerId);
            m.setSaveAsActivity(false);
            m.setSubject('Promotion approved: ' + p.Name);
            m.setPlainTextBody('Your promotion ' + p.Name + ' is approved. Budget: ' + p.Budget__c);
            mails.add(m);
        }
        if (mails.isEmpty()) return;
        try {
            Messaging.sendEmail(mails);
        } catch (Exception e) {
            System.debug(e.getMessage());
        }
    }

    // Approved promotions go to the ERP so the funds are reserved there.
    public static void syncToErp(List<Trade_Promotion__c> promos, Map<Id, Trade_Promotion__c> oldMap) {
        if (UserInfo.getName() == 'Integration User') return;
        Set<Id> ids = new Set<Id>();
        for (Trade_Promotion__c p : promos) if (p.Status__c == 'Approved' && oldMap.get(p.Id).Status__c != 'Approved' && !p.ERP_Synced__c) ids.add(p.Id);
        if (ids.isEmpty() || Test.isRunningTest()) return;
        sendToErp(ids);
    }

    @future(callout=true)
    public static void sendToErp(Set<Id> ids) {
        for (Trade_Promotion__c p : [SELECT Id, Name, Budget__c, Account__r.Legacy_ERP_Code__c FROM Trade_Promotion__c WHERE Id IN :ids]) {
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:ERP_Funds/promotions');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(new Map<String, Object>{ 'promotion' => p.Name, 'customer' => p.Account__r.Legacy_ERP_Code__c, 'budget' => p.Budget__c }));
            try {
                new Http().send(req);
            } catch (Exception e) {
                System.debug(e.getMessage());
            }
        }
    }
}`,
        PromotionClaimService: `
public with sharing class PromotionClaimService {
    public static final Decimal AUTO_APPROVE_CLAIM = 500;

    // No claim may exceed what the promotion actually spent (or its budget while it runs).
    public static void checkAgainstSpend(List<Promotion_Claim__c> claims) {
        Set<Id> promoIds = new Set<Id>();
        for (Promotion_Claim__c c : claims) if (c.Trade_Promotion__c != null) promoIds.add(c.Trade_Promotion__c);
        if (promoIds.isEmpty()) return;
        Map<Id, Trade_Promotion__c> promos = new Map<Id, Trade_Promotion__c>([SELECT Id, Actual_Spend__c, Budget__c FROM Trade_Promotion__c WHERE Id IN :promoIds]);
        for (Promotion_Claim__c c : claims) {
            Trade_Promotion__c p = promos.get(c.Trade_Promotion__c);
            Decimal ceiling = p == null ? null : (p.Actual_Spend__c != null ? p.Actual_Spend__c : p.Budget__c);
            if (ceiling != null && c.Claim_Amount__c != null && c.Claim_Amount__c > ceiling) c.addError('The claim is higher than the promotion spend.');
        }
    }

    // Small claims are approved on arrival.
    public static void autoApprove(List<Promotion_Claim__c> claims) {
        for (Promotion_Claim__c c : claims) {
            if (c.Claim_Amount__c != null && c.Claim_Amount__c <= AUTO_APPROVE_CLAIM) c.Status__c = 'Approved';
        }
    }
}`,
        StoreVisitService: `
public with sharing class StoreVisitService {
    public static final Integer OUT_OF_STOCK_ALERT = 3;

    // Every new visit gets a task per must-stock product of the store.
    public static void createVisitTasks(List<Store_Visit__c> visits) {
        Set<Id> storeIds = new Set<Id>();
        for (Store_Visit__c v : visits) storeIds.add(v.Account__c);
        Map<Id, List<Store_Assortment__c>> byStore = new Map<Id, List<Store_Assortment__c>>();
        for (Store_Assortment__c a : [SELECT Account__c, Product__c FROM Store_Assortment__c WHERE Account__c IN :storeIds AND Must_Stock__c = true]) {
            if (!byStore.containsKey(a.Account__c)) byStore.put(a.Account__c, new List<Store_Assortment__c>());
            byStore.get(a.Account__c).add(a);
        }
        List<Visit_Task__c> tasks = new List<Visit_Task__c>();
        for (Store_Visit__c v : visits) {
            if (!byStore.containsKey(v.Account__c)) continue;
            for (Store_Assortment__c a : byStore.get(v.Account__c)) tasks.add(new Visit_Task__c(Store_Visit__c = v.Id, Product__c = a.Product__c, Task_Type__c = 'Check must-stock'));
        }
        insert tasks;
    }

    // A visit can only be completed after the rep checked in at the store.
    public static void requireCheckIn(List<Store_Visit__c> visits, Map<Id, Store_Visit__c> oldMap) {
        for (Store_Visit__c v : visits) {
            Boolean completing = v.Status__c == 'Completed' && oldMap.get(v.Id).Status__c != 'Completed';
            if (completing && !v.Checked_In__c) v.addError('Check in at the store before completing the visit.');
        }
    }

    // Counts the products that were not on the shelf at each visit.
    public static void countOutOfStocks(Set<Id> visitIds) {
        visitIds.remove(null);
        if (visitIds.isEmpty()) return;
        Map<Id, Integer> counts = new Map<Id, Integer>();
        for (Id i : visitIds) counts.put(i, 0);
        for (AggregateResult r : [SELECT Store_Visit__c v, COUNT(Id) n FROM Shelf_Check__c WHERE Store_Visit__c IN :visitIds AND On_Shelf__c = false GROUP BY Store_Visit__c]) {
            counts.put((Id) r.get('v'), (Integer) r.get('n'));
        }
        List<Store_Visit__c> upd = new List<Store_Visit__c>();
        for (Id i : counts.keySet()) upd.add(new Store_Visit__c(Id = i, Out_Of_Stocks__c = counts.get(i)));
        update upd;
    }

    // Emails the visit owner when an upcoming visit finds too many gaps on the shelf.
    public static void alertAreaManager(List<Store_Visit__c> visits, Map<Id, Store_Visit__c> oldMap) {
        List<Messaging.SingleEmailMessage> mails = new List<Messaging.SingleEmailMessage>();
        for (Store_Visit__c v : visits) {
            Decimal before = oldMap.get(v.Id).Out_Of_Stocks__c;
            if (v.Out_Of_Stocks__c == null || v.Out_Of_Stocks__c < OUT_OF_STOCK_ALERT || (before != null && before >= OUT_OF_STOCK_ALERT)) continue;
            if (v.Visit_Date__c < Date.today()) continue;
            if (!String.valueOf(v.OwnerId).startsWith('005')) continue;
            Messaging.SingleEmailMessage m = new Messaging.SingleEmailMessage();
            m.setTargetObjectId(v.OwnerId);
            m.setSaveAsActivity(false);
            m.setSubject('Out of stocks found at a store visit');
            m.setPlainTextBody(v.Out_Of_Stocks__c + ' products were not on the shelf at visit ' + v.Name + '.');
            mails.add(m);
        }
        if (mails.isEmpty()) return;
        try {
            Messaging.sendEmail(mails);
        } catch (Exception e) {
        }
    }
}`,
        // From the first release; the mobile check-in replaced it and nothing calls it any more.
        StoreVisitLegacyHandler: `
public with sharing class StoreVisitLegacyHandler {
    public static void stampCheckIn(List<Store_Visit__c> visits, Decimal lat, Decimal lon) {
        for (Store_Visit__c v : visits) {
            v.Check_In_Latitude__c = lat;
            v.Check_In_Longitude__c = lon;
            v.Checked_In__c = true;
        }
    }
}`,
      },
      triggers: {
        TradePromotionTrigger: `
trigger TradePromotionTrigger on Trade_Promotion__c (before insert, before update, after insert, after update) {
    if (Trigger.isBefore) {
        TradePromotionApproval.apply(Trigger.new, Trigger.oldMap);
        TradePromotionService.calculateResults(Trigger.new);
        TradePromotionService.checkFund(Trigger.new, Trigger.oldMap);
    } else {
        Set<Id> fundIds = new Set<Id>();
        for (Trade_Promotion__c p : Trigger.new) {
            fundIds.add(p.Trade_Fund__c);
            if (Trigger.isUpdate) fundIds.add(Trigger.oldMap.get(p.Id).Trade_Fund__c);
        }
        TradePromotionService.updateFundCommitted(fundIds);
        if (Trigger.isUpdate) {
            TradePromotionService.postApprovalToChatter(Trigger.new, Trigger.oldMap);
            TradePromotionService.emailKeyAccountManager(Trigger.new, Trigger.oldMap);
            TradePromotionService.syncToErp(Trigger.new, Trigger.oldMap);
        }
    }
}`,
        PromotionClaimTrigger: `
trigger PromotionClaimTrigger on Promotion_Claim__c (before insert, before update) {
    PromotionClaimService.checkAgainstSpend(Trigger.new);
    if (Trigger.isInsert) PromotionClaimService.autoApprove(Trigger.new);
}`,
        StoreVisitTrigger: `
trigger StoreVisitTrigger on Store_Visit__c (after insert, before update, after update) {
    if (Trigger.isInsert) StoreVisitService.createVisitTasks(Trigger.new);
    else if (Trigger.isBefore) StoreVisitService.requireCheckIn(Trigger.new, Trigger.oldMap);
    else StoreVisitService.alertAreaManager(Trigger.new, Trigger.oldMap);
}`,
        ShelfCheckTrigger: `
trigger ShelfCheckTrigger on Shelf_Check__c (after insert, after update, after delete) {
    Set<Id> ids = new Set<Id>();
    for (Shelf_Check__c c : Trigger.isDelete ? Trigger.old : Trigger.new) ids.add(c.Store_Visit__c);
    StoreVisitService.countOutOfStocks(ids);
}`,
      },
      tests: {
        TradePromotionServiceTest: `
@isTest
private class TradePromotionServiceTest {
    private class ErpMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse r = new HttpResponse();
            r.setStatusCode(201);
            return r;
        }
    }
    @isTest static void fundIsCommittedAndResultsCalculated() {
        Account a = new Account(Name = 'Test Customer');
        insert a;
        Trade_Fund__c f = new Trade_Fund__c(Account__c = a.Id, Year__c = 2026, Amount__c = 20000, Fund_Type__c = 'Fixed', Status__c = 'Open');
        insert f;
        Trade_Promotion__c p = new Trade_Promotion__c(Account__c = a.Id, Trade_Fund__c = f.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(14), Budget__c = 8000, Status__c = 'Submitted');
        insert p;
        System.assertEquals(8000, [SELECT Committed__c FROM Trade_Fund__c WHERE Id = :f.Id].Committed__c);
        p.Baseline_Volume__c = 1000;
        p.Actual_Volume__c = 1800;
        p.Actual_Spend__c = 1000;
        update p;
        System.assertEquals(100, [SELECT ROI__c FROM Trade_Promotion__c WHERE Id = :p.Id].ROI__c);
        Database.SaveResult r = Database.insert(new Trade_Promotion__c(Account__c = a.Id, Trade_Fund__c = f.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(14), Budget__c = 15000, Status__c = 'Draft'), false);
        System.assert(!r.isSuccess(), 'the second promotion should exceed the fund');
    }
    @isTest static void approvalIsAnnounced() {
        Account a = new Account(Name = 'Test Customer');
        insert a;
        Trade_Promotion__c p = new Trade_Promotion__c(Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(14), Budget__c = 50000, Status__c = 'Submitted');
        insert p;
        p.Status__c = 'Approved';
        update p;
        System.assertEquals('Approved', [SELECT Status__c FROM Trade_Promotion__c WHERE Id = :p.Id].Status__c);
    }
    @isTest static void erpReceivesApprovedPromotion() {
        Account a = new Account(Name = 'Test Customer', Legacy_ERP_Code__c = 'ERP-1');
        insert a;
        Trade_Promotion__c p = new Trade_Promotion__c(Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(14), Budget__c = 2000, Status__c = 'Draft');
        insert p;
        Test.setMock(HttpCalloutMock.class, new ErpMock());
        Test.startTest();
        TradePromotionService.sendToErp(new Set<Id>{ p.Id });
        Test.stopTest();
        System.assertNotEquals(null, p.Id);
    }
}`,
        PromotionClaimServiceTest: `
@isTest
private class PromotionClaimServiceTest {
    @isTest static void smallClaimApprovesAndLargeClaimIsBlocked() {
        Account a = new Account(Name = 'Test Customer');
        insert a;
        Trade_Promotion__c p = new Trade_Promotion__c(Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(14), Budget__c = 1000, Status__c = 'Draft');
        insert p;
        Promotion_Claim__c c = new Promotion_Claim__c(Trade_Promotion__c = p.Id, Account__c = a.Id, Claim_Amount__c = 300, Status__c = 'Submitted', Invoice_Number__c = 'INV-1');
        insert c;
        System.assertEquals('Approved', [SELECT Status__c FROM Promotion_Claim__c WHERE Id = :c.Id].Status__c);
        Database.SaveResult r = Database.insert(new Promotion_Claim__c(Trade_Promotion__c = p.Id, Account__c = a.Id, Claim_Amount__c = 5000, Status__c = 'Submitted'), false);
        System.assert(!r.isSuccess(), 'the claim should exceed the promotion budget');
    }
}`,
        StoreVisitServiceTest: `
@isTest
private class StoreVisitServiceTest {
    @testSetup static void product() {
        insert new Product2(Name = 'Test Product', IsActive = true);
    }
    @isTest static void visitGetsTasksAndCountsGaps() {
        Account a = new Account(Name = 'Test Store');
        insert a;
        Id productId = [SELECT Id FROM Product2 LIMIT 1].Id;
        insert new Store_Assortment__c(Account__c = a.Id, Product__c = productId, Must_Stock__c = true);
        Store_Visit__c v = new Store_Visit__c(Account__c = a.Id, Visit_Date__c = Date.today().addDays(1), Status__c = 'Planned');
        insert v;
        System.assertEquals(1, [SELECT COUNT() FROM Visit_Task__c WHERE Store_Visit__c = :v.Id]);
        List<Shelf_Check__c> checks = new List<Shelf_Check__c>();
        for (Integer i = 0; i < 3; i++) checks.add(new Shelf_Check__c(Store_Visit__c = v.Id, Product__c = productId, On_Shelf__c = false));
        insert checks;
        System.assertEquals(3, [SELECT Out_Of_Stocks__c FROM Store_Visit__c WHERE Id = :v.Id].Out_Of_Stocks__c);
        delete checks[0];
        System.assertEquals(2, [SELECT Out_Of_Stocks__c FROM Store_Visit__c WHERE Id = :v.Id].Out_Of_Stocks__c);
    }
    @isTest static void completingNeedsCheckIn() {
        Account a = new Account(Name = 'Test Store');
        insert a;
        Store_Visit__c v = new Store_Visit__c(Account__c = a.Id, Visit_Date__c = Date.today(), Status__c = 'Planned');
        insert v;
        v.Status__c = 'Completed';
        Database.SaveResult r = Database.update(v, false);
        System.assert(!r.isSuccess(), 'completing without a check-in should fail');
        StoreVisitLegacyHandler.stampCheckIn(new List<Store_Visit__c>{ v }, 51.5, -0.12);
        update v;
        System.assertEquals(true, [SELECT Checked_In__c FROM Store_Visit__c WHERE Id = :v.Id].Checked_In__c);
    }
}`,
        TradePromotionApprovalTest: `
@isTest
private class TradePromotionApprovalTest {
    @isTest static void smallPromotionApprovesItself() {
        Account a = new Account(Name = 'Test Store');
        insert a;
        Trade_Promotion__c p = new Trade_Promotion__c(Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(14), Budget__c = 5000, Status__c = 'Draft');
        insert p;
        p.Status__c = 'Submitted';
        update p;
        System.assertEquals('Approved', [SELECT Status__c FROM Trade_Promotion__c WHERE Id = :p.Id].Status__c);
    }
    @isTest static void largePromotionWaits() {
        Account a = new Account(Name = 'Test Store');
        insert a;
        Trade_Promotion__c p = new Trade_Promotion__c(Account__c = a.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(14), Budget__c = 50000, Status__c = 'Submitted');
        insert p;
        System.assertEquals('Submitted', [SELECT Status__c FROM Trade_Promotion__c WHERE Id = :p.Id].Status__c);
    }
}`,
      },
    },
  },

  apac: {
    standardFields: {
      Account: [...accountCommon(REGIONS.apac.markets), pick('Store_Format__c', 'Outlet Format', ['Hypermarket', 'Supermarket', 'Minimart', 'General Trade', 'Pharmacy']), text('GST_Number__c', 'GST / Tax Number', 20)],
      Product2: productCommon,
    },
    objects: [
      { name: 'Outlet_Visit__c', label: 'Outlet Visit', plural: 'Outlet Visits', format: 'OV-{00000}', fields: [
        lookup('Account__c', 'Outlet', 'Account', 'Outlet_Visits'), date('Visit_Date__c', 'Visit Date', true), visitStatus,
        lookup('Beat_Plan__c', 'Beat Plan', 'Beat_Plan__c', 'Outlet_Visits'), num('GPS_Accuracy__c', 'GPS Accuracy (m)', 5), longText('Notes__c', 'Notes'),
      ] },
      { name: 'Outlet_Audit__c', label: 'Outlet Audit', plural: 'Outlet Audits', format: 'OA-{00000}', fields: [
        master('Outlet_Visit__c', 'Outlet Visit', 'Outlet_Visit__c', 'Outlet_Audits'), lookup('Product__c', 'Product', 'Product2', 'Outlet_Audits'),
        check('Available__c', 'Available'), num('Facings__c', 'Facings', 3), money('Price_Observed__c', 'Price Observed'),
      ] },
      { name: 'Beat_Plan__c', label: 'Beat Plan', plural: 'Beat Plans', format: 'BP-{0000}', fields: [
        pick('Day_Of_Week__c', 'Day of Week', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']), text('Territory__c', 'Territory', 40),
        rollup('Outlet_Count__c', 'Outlets', 'count', 'Beat_Plan_Outlet__c', 'Beat_Plan__c'),
      ] },
      { name: 'Beat_Plan_Outlet__c', label: 'Beat Plan Outlet', plural: 'Beat Plan Outlets', format: 'BPO-{00000}', fields: [
        master('Beat_Plan__c', 'Beat Plan', 'Beat_Plan__c', 'Beat_Plan_Outlets'), lookup('Account__c', 'Outlet', 'Account', 'Beat_Plan_Outlets'), num('Sequence__c', 'Sequence', 3),
      ] },
      { name: 'Trade_Promotion__c', label: 'Trade Promotion', plural: 'Trade Promotions', format: 'TP-{0000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Trade_Promotions'), date('Start_Date__c', 'Start Date', true), date('End_Date__c', 'End Date', true),
        pick('Mechanic__c', 'Mechanic', ['Price Off', 'Bundle', 'Free Goods', 'Display']), money('Budget__c', 'Budget'),
        promoStatus(['Draft', 'Approved', 'Live', 'Closed']),
      ] },
      { name: 'Distributor_Claim__c', label: 'Distributor Claim', plural: 'Distributor Claims', format: 'DC-{00000}', fields: [
        lookup('Trade_Promotion__c', 'Trade Promotion', 'Trade_Promotion__c', 'Distributor_Claims'), lookup('Distributor__c', 'Distributor', 'Account', 'Distributor_Claims'),
        money('Claim_Amount__c', 'Claim Amount'), pick('Status__c', 'Status', ['Submitted', 'Validated', 'Paid', 'Rejected']),
      ] },
      { name: 'Must_Stock_List__c', label: 'Must Stock List', plural: 'Must Stock Lists', format: 'MSL-{00000}', fields: [
        lookup('Account__c', 'Outlet', 'Account', 'Must_Stock_Lists'), lookup('Product__c', 'Product', 'Product2', 'Must_Stock_Lists'),
      ] },
      { name: 'Distributor_Stock__c', label: 'Distributor Stock', plural: 'Distributor Stock', format: 'DS-{00000}', fields: [
        lookup('Distributor__c', 'Distributor', 'Account', 'Distributor_Stock'), lookup('Product__c', 'Product', 'Product2', 'Distributor_Stock'),
        date('Week_Ending__c', 'Week Ending', true), num('Quantity__c', 'Quantity (cases)', 8),
      ] },
      { name: 'Sales_Target__c', label: 'Sales Target', plural: 'Sales Targets', format: 'ST-{0000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Sales_Targets'), date('Period_Start__c', 'Period Start', true), money('Target_Amount__c', 'Target Amount'),
      ] },
    ],
    validationRules: [
      { object: 'Trade_Promotion__c', name: 'End_After_Start', formula: 'End_Date__c &lt; Start_Date__c', message: 'End Date must be on or after Start Date.', field: 'End_Date__c' },
      { object: 'Distributor_Claim__c', name: 'Claim_Positive', formula: 'Claim_Amount__c &lt;= 0', message: 'Claim amount must be greater than zero.', field: 'Claim_Amount__c' },
    ],
    // Claims may not exceed what is left of the promotion budget.
    apex: {
      classes: {
        DistributorClaimService: `
public with sharing class DistributorClaimService {
    public static void checkBudget(List<Distributor_Claim__c> claims) {
        Set<Id> promoIds = new Set<Id>();
        for (Distributor_Claim__c c : claims) if (c.Trade_Promotion__c != null) promoIds.add(c.Trade_Promotion__c);
        if (promoIds.isEmpty()) return;
        Map<Id, Decimal> claimed = new Map<Id, Decimal>();
        for (AggregateResult r : [SELECT Trade_Promotion__c p, SUM(Claim_Amount__c) s FROM Distributor_Claim__c WHERE Trade_Promotion__c IN :promoIds AND Status__c != 'Rejected' GROUP BY Trade_Promotion__c]) {
            claimed.put((Id) r.get('p'), (Decimal) r.get('s'));
        }
        Map<Id, Trade_Promotion__c> promos = new Map<Id, Trade_Promotion__c>([SELECT Id, Budget__c FROM Trade_Promotion__c WHERE Id IN :promoIds]);
        for (Distributor_Claim__c c : claims) {
            Trade_Promotion__c p = promos.get(c.Trade_Promotion__c);
            if (p == null || p.Budget__c == null || c.Claim_Amount__c == null) continue;
            Decimal used = claimed.containsKey(p.Id) ? claimed.get(p.Id) : 0;
            if (used + c.Claim_Amount__c > p.Budget__c) c.addError('This claim exceeds the remaining promotion budget.');
        }
    }
}`,
      },
      triggers: {
        DistributorClaimTrigger: `
trigger DistributorClaimTrigger on Distributor_Claim__c (before insert) {
    DistributorClaimService.checkBudget(Trigger.new);
}`,
      },
      tests: {
        DistributorClaimServiceTest: `
@isTest
private class DistributorClaimServiceTest {
    @isTest static void claimWithinBudgetIsAccepted() {
        Account d = new Account(Name = 'Test Distributor');
        insert d;
        Trade_Promotion__c p = new Trade_Promotion__c(Account__c = d.Id, Start_Date__c = Date.today(), End_Date__c = Date.today().addDays(30), Budget__c = 1000, Status__c = 'Approved');
        insert p;
        insert new Distributor_Claim__c(Trade_Promotion__c = p.Id, Distributor__c = d.Id, Claim_Amount__c = 600, Status__c = 'Submitted');
        Database.SaveResult r = Database.insert(new Distributor_Claim__c(Trade_Promotion__c = p.Id, Distributor__c = d.Id, Claim_Amount__c = 600, Status__c = 'Submitted'), false);
        System.assert(!r.isSuccess(), 'second claim should exceed the budget');
    }
}`,
      },
    },
  },

  amer: {
    standardFields: {
      Account: [...accountCommon(REGIONS.amer.markets), text('Tax_ID__c', 'Tax ID (EIN / CNPJ / RFC)', 20), money('Credit_Limit__c', 'Credit Limit'), pick('Credit_Status__c', 'Credit Status', ['OK', 'On Hold', 'Blocked'])],
      Product2: productCommon,
    },
    objects: [
      { name: 'Field_Visit__c', label: 'Field Visit', plural: 'Field Visits', format: 'FV-{00000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Field_Visits'), date('Visit_Date__c', 'Visit Date', true), visitStatus,
        check('Planogram_OK__c', 'Planogram OK'), num('Out_Of_Stocks__c', 'Out of Stocks', 3), longText('Notes__c', 'Notes'),
      ] },
      { name: 'Trade_Deal__c', label: 'Trade Deal', plural: 'Trade Deals', format: 'TD-{0000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Trade_Deals'), date('Start_Date__c', 'Start Date', true), date('End_Date__c', 'End Date', true),
        pct('Discount_Pct__c', 'Discount'), money('Funding__c', 'Funding'), pick('Status__c', 'Status', ['Proposed', 'Agreed', 'Running', 'Settled']),
      ] },
      { name: 'Order_Request__c', label: 'Order Request', plural: 'Order Requests', format: 'OR-{00000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Order_Requests'), date('Order_Date__c', 'Order Date', true),
        pick('Status__c', 'Status', ['Draft', 'Submitted', 'Sent to ERP', 'Rejected']), money('Order_Total__c', 'Order Total'),
      ] },
      { name: 'Order_Request_Line__c', label: 'Order Request Line', plural: 'Order Request Lines', format: 'ORL-{00000}', fields: [
        master('Order_Request__c', 'Order Request', 'Order_Request__c', 'Order_Request_Lines'), lookup('Product__c', 'Product', 'Product2', 'Order_Request_Lines'),
        num('Quantity__c', 'Quantity', 8), money('Unit_Price__c', 'Unit Price'),
      ] },
      { name: 'Distributor_Stock__c', label: 'Distributor Stock', plural: 'Distributor Stock', format: 'DS-{00000}', fields: [
        lookup('Distributor__c', 'Distributor', 'Account', 'Distributor_Stock'), lookup('Product__c', 'Product', 'Product2', 'Distributor_Stock'),
        date('Week_Ending__c', 'Week Ending', true), num('Quantity__c', 'Quantity (cases)', 8),
      ] },
      { name: 'Sales_Target__c', label: 'Sales Target', plural: 'Sales Targets', format: 'ST-{0000}', fields: [
        lookup('Account__c', 'Customer', 'Account', 'Sales_Targets'), date('Period_Start__c', 'Period Start', true), pick('Category__c', 'Category', CATEGORIES), money('Target_Amount__c', 'Target Amount'),
      ] },
    ],
    validationRules: [
      { object: 'Trade_Deal__c', name: 'End_After_Start', formula: 'End_Date__c &lt; Start_Date__c', message: 'End Date must be on or after Start Date.', field: 'End_Date__c' },
      { object: 'Account', name: 'Tax_ID_Required_BR_MX', formula: "AND(OR(ISPICKVAL(Market__c, 'Brazil'), ISPICKVAL(Market__c, 'Mexico')), ISBLANK(Tax_ID__c), NOT(ISNEW()))", message: 'Tax ID is required for customers in Brazil and Mexico.', field: 'Tax_ID__c' },
    ],
    // Order totals kept by a trigger (a roll-up summary would do), and a credit check that calls the ERP.
    apex: {
      classes: {
        OrderRequestService: `
public with sharing class OrderRequestService {
    public static void recalcTotals(Set<Id> orderIds) {
        orderIds.remove(null);
        if (orderIds.isEmpty()) return;
        Map<Id, Decimal> totals = new Map<Id, Decimal>();
        for (Id i : orderIds) totals.put(i, 0);
        for (Order_Request_Line__c l : [SELECT Order_Request__c, Quantity__c, Unit_Price__c FROM Order_Request_Line__c WHERE Order_Request__c IN :orderIds]) {
            Decimal line = (l.Quantity__c == null ? 0 : l.Quantity__c) * (l.Unit_Price__c == null ? 0 : l.Unit_Price__c);
            totals.put(l.Order_Request__c, totals.get(l.Order_Request__c) + line);
        }
        List<Order_Request__c> upd = new List<Order_Request__c>();
        for (Id i : totals.keySet()) upd.add(new Order_Request__c(Id = i, Order_Total__c = totals.get(i)));
        update upd;
    }
}`,
        ErpCreditService: `
public with sharing class ErpCreditService {
    // Asks the ERP for the customer's credit status. Endpoint is a named credential set up per environment.
    public static String fetchCreditStatus(String erpCode) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ERP_Credit/customers/' + EncodingUtil.urlEncode(erpCode, 'UTF-8') + '/credit');
        req.setMethod('GET');
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) return 'On Hold';
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return (String) body.get('status');
    }
}`,
      },
      triggers: {
        OrderRequestLineTrigger: `
trigger OrderRequestLineTrigger on Order_Request_Line__c (after insert, after update, after delete) {
    Set<Id> ids = new Set<Id>();
    for (Order_Request_Line__c l : Trigger.isDelete ? Trigger.old : Trigger.new) ids.add(l.Order_Request__c);
    OrderRequestService.recalcTotals(ids);
}`,
      },
      tests: {
        OrderRequestServiceTest: `
@isTest
private class OrderRequestServiceTest {
    @isTest static void totalFollowsLines() {
        Account a = new Account(Name = 'Test Customer');
        insert a;
        Order_Request__c o = new Order_Request__c(Account__c = a.Id, Order_Date__c = Date.today(), Status__c = 'Draft');
        insert o;
        Order_Request_Line__c l = new Order_Request_Line__c(Order_Request__c = o.Id, Quantity__c = 3, Unit_Price__c = 10);
        insert l;
        System.assertEquals(30, [SELECT Order_Total__c FROM Order_Request__c WHERE Id = :o.Id].Order_Total__c);
        delete l;
        System.assertEquals(0, [SELECT Order_Total__c FROM Order_Request__c WHERE Id = :o.Id].Order_Total__c);
    }
}`,
        ErpCreditServiceTest: `
@isTest
private class ErpCreditServiceTest {
    private class Mock implements HttpCalloutMock {
        Integer code;
        Mock(Integer code) { this.code = code; }
        public HttpResponse respond(HttpRequest req) {
            HttpResponse r = new HttpResponse();
            r.setStatusCode(code);
            r.setBody('{"status":"OK"}');
            return r;
        }
    }
    @isTest static void readsStatus() {
        Test.setMock(HttpCalloutMock.class, new Mock(200));
        System.assertEquals('OK', ErpCreditService.fetchCreditStatus('C-1'));
    }
    @isTest static void holdsOnError() {
        Test.setMock(HttpCalloutMock.class, new Mock(500));
        System.assertEquals('On Hold', ErpCreditService.fetchCreditStatus('C-1'));
    }
}`,
      },
    },
  },
};

module.exports = { COMPANY, REGIONS, BRANDS, CATEGORIES, CHANNELS, ORGS };
