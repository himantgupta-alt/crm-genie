// Shared helpers: reuse the Salesforce CLI's own auth (no tokens stored in scripts).
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const globalRoot = execSync('npm root -g').toString().trim();
const { Org } = require(path.join(globalRoot, '@salesforce/cli/node_modules/@salesforce/core'));

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output');
const ALIAS = process.env.SF_ALIAS || 'myorg';

async function connect() {
  const org = await Org.create({ aliasOrUsername: ALIAS });
  const conn = org.getConnection();
  await conn.identity(); // refreshes the access token if needed
  return conn;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Suffixes of system-generated companion objects we don't treat as business objects.
const NOISE = /(Share|Feed|ChangeEvent|Tag|__mdt|__e|__b|__x|__xo|__hd|__dll|__dlm|__chn|History|OwnerSharingRule)$/;
const HISTORY = /(History|FieldHistory)$/;

// Business objects: custom objects plus standard objects with a page layout (Account, Opportunity, ...).
function isBusinessObject(g) {
  if (!g.queryable || !g.retrieveable || g.deprecatedAndHidden || g.customSetting) return false;
  if (NOISE.test(g.name)) return false;
  return g.custom ? g.name.endsWith('__c') : g.layoutable;
}

// Field-history / stage-history tables that belong to a business object.
function isHistoryObject(g, businessNames) {
  if (!g.queryable || !HISTORY.test(g.name)) return false;
  const base = g.name.replace(/__History$/, '__c').replace(/(Field)?History$/, '');
  return businessNames.has(base);
}

module.exports = { connect, writeJson, isBusinessObject, isHistoryObject, ROOT, OUT, ALIAS };
