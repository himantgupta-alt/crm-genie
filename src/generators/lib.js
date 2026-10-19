// Shared helpers. Two ways to reach an org, neither stores tokens in scripts:
//  - Salesforce CLI auth (SF_ALIAS, default myorg): on a laptop or runner where `sf org login` was done.
//  - OAuth refresh token (SF_REFRESH_TOKEN + SF_INSTANCE_URL + SF_CLIENT_ID, optional SF_LOGIN_URL): used by the
//    Org Compiler server after "Connect with Salesforce"; the token comes from its encrypted store.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const P = require('../paths');
const ROOT = P.ROOT;
const OUT = P.EXTRACTION; // schema/, logic/, data/, inventory/ live under the Extraction agent's folder
const ALIAS = process.env.SF_ALIAS || 'myorg';

async function connect() {
  if (process.env.SF_REFRESH_TOKEN) {
    const jsforce = require('jsforce');
    const conn = new jsforce.Connection({
      oauth2: { clientId: process.env.SF_CLIENT_ID, loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com', redirectUri: process.env.SF_REDIRECT_URI || 'http://localhost:1717/OauthRedirect' },
      instanceUrl: process.env.SF_INSTANCE_URL, refreshToken: process.env.SF_REFRESH_TOKEN, version: '67.0',
    });
    await conn.oauth2.refreshToken(process.env.SF_REFRESH_TOKEN).then((r) => { conn.accessToken = r.access_token; conn.instanceUrl = r.instance_url || conn.instanceUrl; });
    return conn;
  }
  const globalRoot = execSync('npm root -g').toString().trim();
  const { Org } = require(path.join(globalRoot, '@salesforce/cli/node_modules/@salesforce/core'));
  const org = await Org.create({ aliasOrUsername: ALIAS });
  const conn = org.getConnection();
  await conn.identity(); // refreshes the access token if needed
  return conn;
}

// Queries in flight at once. A large org (managed packages with thousands of fields) needs thousands of COUNT()
// queries; one at a time they take over an hour. DISCOVERY_CONCURRENCY tunes it within the org's API limits.
const CONCURRENCY = Math.max(1, Number(process.env.DISCOVERY_CONCURRENCY) || 8);
// Runs fn over items with at most n in flight; results keep the input order, so outputs stay deterministic.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
// One progress line per step; the Org Compiler turns the latest into its progress bar.
const progress = (step, done, total) => console.log(`discovery: ${step} ${done}/${total} (${Math.round((done / Math.max(total, 1)) * 100)}%)`);

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

module.exports = { connect, writeJson, isBusinessObject, isHistoryObject, pool, progress, CONCURRENCY, ROOT, OUT, ALIAS, P };
