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
  assert.deepEqual(t.calls.map((c) => [c.to, c.phase]), [['PromoService.check', 'before']]);
  assert.equal(t.functions.length, 0);
});

test('every function carries the line range of its method; comments do not shift lines', () => {
  const a = analyseApex('PromoService', SERVICE, { kind: 'class' });
  const by = Object.fromEntries(a.functions.map((f) => [f.method, f.lines]));
  const at = (s) => SERVICE.split('\n').findIndex((l) => l.includes(s)) + 1;
  assert.deepEqual(by.announce, [at('void announce('), at('Database.insert(posts') + 1]);
  assert.equal(by.send[0], at('@future'));
});

test('trigger calls know whether they run before or after the save, and on insert or update', () => {
  const src = `trigger T on A__c (before insert, before update, after insert, after update) {
    if (Trigger.isBefore) {
        H.one(Trigger.new);
    } else {
        H.two(Trigger.new);
        if (Trigger.isUpdate) H.three(Trigger.new, Trigger.oldMap);
    }
}`;
  const t = analyseApex('T', src, { kind: 'trigger', object: 'A__c' });
  assert.deepEqual(t.calls.map((c) => [c.to, c.phase, c.insert, c.line]), [['H.one', 'before', undefined, 3], ['H.two', 'after', undefined, 5], ['H.three', 'after', false, 6]]);
  const only = analyseApex('U', 'trigger U on A__c (after insert, before update) {\n if (Trigger.isInsert) H.a(Trigger.new);\n else H.b(Trigger.new);\n}', { kind: 'trigger' });
  assert.deepEqual(only.calls.map((c) => [c.to, c.phase]), [['H.a', 'after'], ['H.b', 'before']]);
});

test('fields read and written per method; values before the save are not a dependency', () => {
  const a = analyseApex('S', `public class S {
    public static void setIt(List<A__c> xs) { for (A__c x : xs) x.Status__c = 'On'; }
    public static void useIt(List<A__c> xs, Map<Id, A__c> oldMap) {
        for (A__c x : xs) if (x.Status__c == 'On' && oldMap.get(x.Id).Level__c != null) update new B__c(Id = x.B__c, Total__c = 1);
    }
}`, { kind: 'class' });
  const f = Object.fromEntries(a.methodInfo.map((m) => [m.name, m.fields]));
  assert.deepEqual(f.setIt.writes, ['Status__c']);
  assert.deepEqual(f.useIt.writes, ['Total__c']);
  assert.ok(f.useIt.reads.includes('Status__c') && !f.useIt.reads.includes('Level__c'));
});

test('a simple field rule becomes a validation rule; comments are ignored', () => {
  const a = analyseApex('V', 'public class V { public static void v(List<A__c> xs) { for (A__c x : xs) if (x.B__c == null) x.addError(\'B\'); /* new FeedItem( */ } }', { kind: 'class' });
  assert.deepEqual(a.functions.map((f) => [f.kind, f.verdict]), [['rule', 'configure']]);
});
