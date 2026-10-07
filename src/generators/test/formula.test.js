// node --test scripts/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse, analyse, print } = require('../formula');

const { LOGIC } = require('../../paths');

test('precedence: * binds tighter than +, comparisons below arithmetic', () => {
  assert.equal(print(parse('a + b * c > d')), '((a + (b * c)) > d)');
  assert.equal(print(parse('(a + b) * c')), '((a + b) * c)');
});

test('AND/OR flatten whether written as functions or operators', () => {
  assert.deepEqual(parse('a && b && c'), parse('AND(a, b, c)'));
  assert.equal(parse('a || b').t, 'or');
});

test('operator spellings normalise: == to =, <> to !=', () => {
  assert.equal(parse('a == 1').op, '=');
  assert.equal(parse('a <> 1').op, '!=');
});

test('relationship paths and flow merge fields become refs', () => {
  assert.deepEqual(parse('Subscription__r.Account__r.Name'), { t: 'ref', path: ['Subscription__r', 'Account__r', 'Name'] });
  assert.deepEqual(parse('{!$Record.Health_Score__c}'), { t: 'ref', path: ['Health_Score__c'] });
  assert.deepEqual(parse('$Flow.CurrentDate'), { t: 'global', name: '$Flow.CurrentDate' });
});

test('literals: strings in either quote, booleans, null, decimals', () => {
  assert.deepEqual(parse('"Closed Won"'), { t: 'lit', v: 'Closed Won', type: 'text' });
  assert.deepEqual(parse("'x\\'y'"), { t: 'lit', v: "x'y", type: 'text' });
  assert.deepEqual(parse('true'), { t: 'lit', v: true, type: 'boolean' });
  assert.deepEqual(parse('NULL'), { t: 'lit', v: null, type: 'null' });
  assert.deepEqual(parse('0.5'), { t: 'lit', v: 0.5, type: 'number' });
});

test('comments are ignored and unary minus parses', () => {
  assert.equal(print(parse('/* note */ -a * 2')), '(-(a) * 2)');
});

test('syntax errors are reported, not swallowed', () => {
  assert.throws(() => parse('AND(a, b'), /expected '\)'/);
  assert.throws(() => parse('a +'), /unexpected end/);
  assert.throws(() => parse('a # b'), /unexpected character/);
});

test('analysis drives the translation strategy', () => {
  const prior = analyse(parse('AND( ISCHANGED(Status__c), ISPICKVAL(PRIORVALUE(Status__c), "Cancelled") )'));
  assert.equal(prior.usesPrior, true);
  assert.equal(prior.crossObject, false);
  assert.equal(analyse(parse('End_Date__c - TODAY()')).volatile, true);
  assert.equal(analyse(parse('ISPICKVAL(Subscription__r.Status__c, "Cancelled")')).crossObject, true);
  const local = analyse(parse('Quantity__c * Unit_Price__c'));
  assert.deepEqual([local.usesPrior, local.volatile, local.crossObject], [false, false, false]);
});

// Every formula the org actually contains must parse and survive a print/parse round trip.
test('all extracted org formulas parse and round-trip', () => {
  const read = (n) => JSON.parse(fs.readFileSync(path.join(LOGIC, `${n}.json`), 'utf8'));
  const sources = [
    ...read('validationRules').map((v) => v.condition),
    ...read('formulaFields').filter((f) => f.formula).map((f) => f.formula),
    ...read('flows').map((f) => f.trigger?.filterFormula).filter(Boolean),
  ];
  assert.ok(sources.length >= 13, `expected the seeded formulas, found ${sources.length}`);
  for (const src of sources) {
    const ast = parse(src);
    assert.deepEqual(parse(print(ast)), ast, src);
  }
});
