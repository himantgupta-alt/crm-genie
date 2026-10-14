// node --test src/generators/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseApex } = require('../apex-functions');

const SERVICE = `
public with sharing class PromoService {
    public static final Decimal LIMIT_AMOUNT = 500;
    // Posts to the feed.
    public static void announce(List<Promo__c> ps) {
        List<FeedItem> posts = new List<FeedItem>();
        for (Promo__c p : ps) posts.add(new FeedItem(ParentId = p.Id, Body = 'Approved'));
        Database.insert(posts, false);
    }
    public static void check(List<Promo__c> ps) {
        Map<Id, Fund__c> funds = new Map<Id, Fund__c>([SELECT Id, Amount__c FROM Fund__c]);
        for (Promo__c p : ps) if (p.Budget__c > 10) p.addError('Too much');
    }
    public static void roi(List<Promo__c> ps) {
        for (Promo__c p : ps) p.ROI__c = p.Volume__c * 2;
    }
    @future(callout=true)
    public static void send(Set<Id> ids) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ERP/x');
        try { new Http().send(req); } catch (Exception e) { System.debug(e.getMessage()); }
        if (Test.isRunningTest()) return;
        local(ids);
    }
    private static void local(Set<Id> ids) {}
}`;

test('splits a class into one business function per job, each with its own verdict', () => {
  const a = analyseApex('PromoService', SERVICE, { kind: 'class' });
  const by = Object.fromEntries(a.functions.map((f) => [f.method, f]));
  assert.equal(by.announce.kind, 'chatter');
  assert.equal(by.announce.verdict, 'configure');
  assert.equal(by.check.kind, 'check');
  assert.equal(by.check.verdict, 'retain');
  assert.equal(by.roi.kind, 'calc');
  assert.equal(by.send.kind, 'integration');
  assert.match(by.send.what, /@future/);
});

test('finds the cross-cutting risks in the source', () => {
  const ids = analyseApex('PromoService', SERVICE, { kind: 'class' }).issues.map((i) => i.id).sort();
  assert.deepEqual(ids, ['hidden-errors', 'test-code', 'thresholds']);
});

test('records calls between methods and from triggers, for trigger groups and order of execution', () => {
  const a = analyseApex('PromoService', SERVICE, { kind: 'class' });
  assert.deepEqual(a.methodInfo.find((m) => m.name === 'send').local, ['local']);
  const t = analyseApex('PromoTrigger', 'trigger PromoTrigger on Promo__c (before insert) { PromoService.check(Trigger.new); }', { kind: 'trigger', object: 'Promo__c' });
  assert.deepEqual(t.calls, ['PromoService.check']);
  assert.equal(t.functions.length, 0);
});

test('a simple field rule becomes a validation rule; comments are ignored', () => {
  const a = analyseApex('V', 'public class V { public static void v(List<A__c> xs) { for (A__c x : xs) if (x.B__c == null) x.addError(\'B\'); /* new FeedItem( */ } }', { kind: 'class' });
  assert.deepEqual(a.functions.map((f) => [f.kind, f.verdict]), [['rule', 'configure']]);
});
