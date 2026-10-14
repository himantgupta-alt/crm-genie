// Writes one regional org of the assessment demo (model.js) as a deployable Salesforce project:
//
//   node src/salesforce-seed/cpg/seed-cpg.js eu|apac|amer
//
// Output (git-ignored): src/salesforce-seed/cpg/out/<region>/ with sfdx-project.json, force-app/ (objects, fields,
// validation rules, Apex with tests, a permission set) and seed-data.apex. deploy-cpg.ps1 deploys and loads it.
const fs = require('fs');
const path = require('path');
const { COMPANY, REGIONS, BRANDS, CATEGORIES, CHANNELS, ORGS } = require('./model');

const region = process.argv[2];
if (!ORGS[region]) { console.error(`usage: node seed-cpg.js ${Object.keys(ORGS).join('|')}`); process.exit(2); }
const org = ORGS[region];
const R = REGIONS[region];

const OUT = path.join(__dirname, 'out', region);
const SRC = path.join(OUT, 'force-app', 'main', 'default');
const X = '<?xml version="1.0" encoding="UTF-8"?>';
const NS = 'xmlns="http://soap.sforce.com/2006/04/metadata"';
const files = {};
const add = (p, body) => { files[p] = `${X}\n${body.trim()}\n`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------------------------------------------------------- metadata */

function fieldXml(f) {
  const lines = [`    <fullName>${f.name}</fullName>`, `    <label>${esc(f.label)}</label>`];
  switch (f.type) {
    case 'Text': lines.push(`    <length>${f.length}</length>`, '    <required>false</required>'); break;
    case 'LongTextArea': lines.push('    <length>32768</length>', '    <visibleLines>4</visibleLines>'); break;
    case 'Checkbox': lines.push('    <defaultValue>false</defaultValue>'); break;
    case 'Date': lines.push(`    <required>${!!f.required}</required>`); break;
    case 'Number': case 'Currency': case 'Percent': lines.push(`    <precision>${f.precision}</precision>`, `    <scale>${f.scale}</scale>`, '    <required>false</required>'); break;
    case 'Picklist':
      lines.push('    <required>false</required>', '    <valueSet>', '        <restricted>true</restricted>', '        <valueSetDefinition>', '            <sorted>false</sorted>',
        ...f.values.map((v) => `            <value><fullName>${esc(v)}</fullName><default>false</default><label>${esc(v)}</label></value>`),
        '        </valueSetDefinition>', '    </valueSet>');
      break;
    case 'Lookup':
      lines.push('    <deleteConstraint>SetNull</deleteConstraint>', `    <referenceTo>${f.to}</referenceTo>`, `    <relationshipLabel>${esc(f.relationshipName.replace(/_/g, ' '))}</relationshipLabel>`,
        `    <relationshipName>${f.relationshipName}</relationshipName>`, '    <required>false</required>');
      break;
    case 'MasterDetail':
      lines.push(`    <referenceTo>${f.to}</referenceTo>`, `    <relationshipLabel>${esc(f.relationshipName.replace(/_/g, ' '))}</relationshipLabel>`, `    <relationshipName>${f.relationshipName}</relationshipName>`,
        '    <relationshipOrder>0</relationshipOrder>', '    <reparentableMasterDetail>false</reparentableMasterDetail>', '    <writeRequiresMasterRead>false</writeRequiresMasterRead>');
      break;
    case 'Summary':
      if (f.field) lines.push(`    <summarizedField>${f.child}.${f.field}</summarizedField>`);
      lines.push(`    <summaryForeignKey>${f.child}.${f.fk}</summaryForeignKey>`, `    <summaryOperation>${f.op}</summaryOperation>`);
      break;
    default: throw new Error(`unknown field type ${f.type}`);
  }
  lines.push(`    <type>${f.type}</type>`);
  return `<CustomField ${NS}>\n${lines.join('\n')}\n</CustomField>`;
}
const addField = (obj, f) => add(`objects/${obj}/fields/${f.name}.field-meta.xml`, fieldXml(f));

for (const [obj, fields] of Object.entries(org.standardFields)) for (const f of fields) addField(obj, f);

for (const o of org.objects) {
  const detail = o.fields.some((f) => f.type === 'MasterDetail');
  add(`objects/${o.name}/${o.name}.object-meta.xml`, `
<CustomObject ${NS}>
    <deploymentStatus>Deployed</deploymentStatus>
    <description>${esc(`${COMPANY} · ${R.label} sales org (sample).`)}</description>
    <enableActivities>${!detail}</enableActivities>
    <enableFeeds>${!!o.feeds}</enableFeeds>
    <enableHistory>false</enableHistory>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <label>${esc(o.label)}</label>
    <nameField>
        <displayFormat>${o.format}</displayFormat>
        <label>${esc(o.label)} Number</label>
        <type>AutoNumber</type>
    </nameField>
    <pluralLabel>${esc(o.plural)}</pluralLabel>
    <sharingModel>${detail ? 'ControlledByParent' : 'ReadWrite'}</sharingModel>
</CustomObject>`);
  for (const f of o.fields) addField(o.name, f);
}

for (const v of org.validationRules) add(`objects/${v.object}/validationRules/${v.name}.validationRule-meta.xml`, `
<ValidationRule ${NS}>
    <fullName>${v.name}</fullName>
    <active>true</active>
    <errorConditionFormula>${v.formula}</errorConditionFormula>
    <errorDisplayField>${v.field}</errorDisplayField>
    <errorMessage>${esc(v.message)}</errorMessage>
</ValidationRule>`);

const apexMeta = (kind) => `<${kind} ${NS}>\n    <apiVersion>67.0</apiVersion>\n    <status>Active</status>\n</${kind}>`;
// Field access is enforced in Apex at this API version and the new fields are visible only through the permission
// set, so every test runs as a fresh sales user that holds it (created inside runAs to keep setup DML separate).
const SALES_USER = `
    static User salesUser() {
        User u;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
            u = new User(Alias = 'bwtest', Email = 'bw.test@example.com', EmailEncodingKey = 'UTF-8', LastName = 'Tester',
                LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US', ProfileId = p.Id, TimeZoneSidKey = 'America/Los_Angeles',
                Username = 'bw.test.' + String.valueOf(Math.abs(Crypto.getRandomInteger())) + '@example.com');
            insert u;
            insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = [SELECT Id FROM PermissionSet WHERE Name = 'Brightwell_Sales'].Id);
        }
        return u;
    }`;
const withGrant = (body) => body.replace(/(private class \w+ \{)/, `$1${SALES_USER}`)
  .replace(/@isTest static void (\w+)\(\) \{/g, '@isTest static void $1() { System.runAs(salesUser()) { $1Body(); } }\n    static void $1Body() {');
for (const [name, body] of Object.entries({ ...org.apex.classes, ...Object.fromEntries(Object.entries(org.apex.tests).map(([n, b]) => [n, withGrant(b)])) })) {
  files[`classes/${name}.cls`] = `${body.trim()}\n`;
  add(`classes/${name}.cls-meta.xml`, apexMeta('ApexClass'));
}
for (const [name, body] of Object.entries(org.apex.triggers)) {
  files[`triggers/${name}.trigger`] = `${body.trim()}\n`;
  add(`triggers/${name}.trigger-meta.xml`, apexMeta('ApexTrigger'));
}

// Access for the people (and the assessment) that read these fields. Required and master-detail fields are
// always accessible and cannot be listed; roll-ups are read-only.
const fieldPerms = [
  ...Object.entries(org.standardFields).flatMap(([obj, fs_]) => fs_.map((f) => [obj, f])),
  ...org.objects.flatMap((o) => o.fields.map((f) => [o.name, f])),
].filter(([, f]) => !f.required && f.type !== 'MasterDetail')
  .map(([obj, f]) => `    <fieldPermissions>\n        <editable>${f.type !== 'Summary'}</editable>\n        <field>${obj}.${f.name}</field>\n        <readable>true</readable>\n    </fieldPermissions>`);
const objectPerms = org.objects.map((o) => `    <objectPermissions>\n        <allowCreate>true</allowCreate>\n        <allowDelete>true</allowDelete>\n        <allowEdit>true</allowEdit>\n        <allowRead>true</allowRead>\n        <modifyAllRecords>true</modifyAllRecords>\n        <object>${o.name}</object>\n        <viewAllRecords>true</viewAllRecords>\n    </objectPermissions>`);
add('permissionsets/Brightwell_Sales.permissionset-meta.xml', `
<PermissionSet ${NS}>
    <description>${esc(`${COMPANY} sales users, ${R.label}.`)}</description>
${fieldPerms.join('\n')}
    <hasActivationRequired>false</hasActivationRequired>
    <label>Brightwell Sales</label>
${objectPerms.join('\n')}
</PermissionSet>`);

/* ---------------------------------------------------------------- seed data */

// Deterministic sample records, built in Apex so one anonymous run loads the region. Skips if already loaded.
const has = (name) => org.objects.some((o) => o.name === name);
const list = (xs) => `new List<String>{ ${xs.map((x) => `'${x.replace(/'/g, "\\'")}'`).join(', ')} }`;
const taxField = { eu: 'VAT_Number__c', apac: 'GST_Number__c', amer: 'Tax_ID__c' }[region];
const visit = { eu: 'Store_Visit__c', apac: 'Outlet_Visit__c', amer: 'Field_Visit__c' }[region];
const promo = has('Trade_Promotion__c') ? 'Trade_Promotion__c' : 'Trade_Deal__c';

const apex = [`
// ${COMPANY} · ${R.label} sales org · sample data generated by src/salesforce-seed/cpg/seed-cpg.js
if ([SELECT COUNT() FROM Account WHERE Market__c != null] > 0) { System.debug('already seeded'); return; }
List<String> markets = ${list(R.markets)};
List<String> brands = ${list(BRANDS)};
List<String> cats = ${list(CATEGORIES)};
List<String> channels = ${list(CHANNELS)};
List<String> chains = new List<String>{ 'FreshWay', 'CityMart', 'ValueHub', 'Corner Stores', 'Metro Wholesale' };
List<String> items = new List<String>{ 'Laundry Liquid 1L', 'Shampoo 400ml', 'Stock Cubes 12pk', 'Iced Tea 1.5L' };

List<Product2> products = new List<Product2>();
for (Integer b = 0; b < brands.size(); b++) for (Integer c = 0; c < cats.size(); c++) {
    if (Math.mod(b + c, 2) == 1) continue;
    products.add(new Product2(Name = brands[b] + ' ' + items[c], Brand__c = brands[b], Category__c = cats[c], IsActive = true,
        EAN__c = String.valueOf(4000000000000L + b * 1000 + c), Case_Size__c = 6 + c * 6));
}
insert products;

List<Account> accts = new List<Account>();
for (Integer m = 0; m < markets.size(); m++) for (Integer k = 0; k < 4; k++) {
    Integer n = m * 4 + k;
    Boolean dist = k == 3;
    Account a = new Account(Name = dist ? markets[m] + ' Distribution Co' : chains[Math.mod(n, 4)] + ' ' + markets[m] + ' ' + (k + 1),
        Market__c = markets[m], Customer_Channel__c = dist ? 'Wholesale' : channels[Math.mod(n, 3)], Customer_Tier__c = k == 0 ? 'A' : (k == 1 ? 'B' : 'C'),
        Legacy_ERP_Code__c = Math.mod(n, 5) < 3 ? 'ERP-' + String.valueOf(10000 + n) : null);`,
region === 'eu' ? `    if (Math.mod(n, 2) == 0) a.VAT_Number__c = 'EU' + String.valueOf(100000000 + n);
    a.Store_Format__c = dist ? null : new List<String>{ 'Hypermarket', 'Supermarket', 'Convenience' }[k];` : '',
region === 'apac' ? `    if (Math.mod(n, 3) == 0) a.GST_Number__c = 'GST' + String.valueOf(100000 + n);
    a.Store_Format__c = dist ? null : new List<String>{ 'Hypermarket', 'Minimart', 'General Trade' }[k];` : '',
region === 'amer' ? `    a.Tax_ID__c = (markets[m] == 'Brazil' || markets[m] == 'Mexico' || Math.mod(n, 2) == 0) ? 'TX' + String.valueOf(10000000 + n) : null;
    a.Credit_Limit__c = dist ? 250000 : 50000 + k * 10000; a.Credit_Status__c = Math.mod(n, 9) == 0 ? 'On Hold' : 'OK';` : '',
`    accts.add(a);
}
insert accts;

Date base = Date.newInstance(2026, 7, 6);
List<String> statuses = new List<String>{ 'Completed', 'Completed', 'Completed', 'Planned', 'Cancelled' };
List<${visit}> visits = new List<${visit}>();
for (Integer i = 0; i < accts.size(); i++) {
    if (accts[i].Customer_Channel__c == 'Wholesale') continue;
    for (Integer v = 0; v < 5; v++) {
        ${visit} x = new ${visit}(Account__c = accts[i].Id, Visit_Date__c = base.addDays(v * 14 + Math.mod(i, 10)), Status__c = statuses[Math.mod(i + v, 5)]);`,
region === 'eu' ? `        x.Visit_Type__c = v == 2 ? 'Promotion Check' : 'Routine';` : '',
region === 'amer' ? `        x.Planogram_OK__c = Math.mod(i + v, 3) != 0; x.Out_Of_Stocks__c = Math.mod(i * v, 4);` : '',
`        visits.add(x);
    }
}
insert visits;`,
region === 'eu' || region === 'apac' ? `
List<SObject> checks = new List<SObject>();
for (Integer i = 0; i < visits.size(); i++) {
    if (visits[i].Status__c != 'Completed') continue;
    for (Integer p = 0; p < 3; p++) {
        Product2 pr = products[Math.mod(i + p, products.size())];
        ${region === 'eu'
    ? "checks.add(new Shelf_Check__c(Store_Visit__c = visits[i].Id, Product__c = pr.Id, On_Shelf__c = Math.mod(i + p, 7) != 0, Facings__c = 2 + Math.mod(i, 4), Shelf_Price__c = 2.49 + p));"
    : "checks.add(new Outlet_Audit__c(Outlet_Visit__c = visits[i].Id, Product__c = pr.Id, Available__c = Math.mod(i + p, 5) != 0, Facings__c = 1 + Math.mod(i, 3), Price_Observed__c = 1.20 + p));"}
    }
}
insert checks;` : '',
`
List<${promo}> promos = new List<${promo}>();
for (Integer i = 0; i < accts.size(); i += 2) {
    Date s = base.addDays(Math.mod(i, 8) * 7);
    ${promo} t = new ${promo}(Account__c = accts[i].Id, Start_Date__c = s, End_Date__c = s.addDays(21));`,
region === 'eu' ? `    t.Mechanic__c = new List<String>{ 'Price Off', 'Multibuy', 'Display', 'Feature' }[Math.mod(i / 2, 4)]; t.Budget__c = 4000 + Math.mod(i, 6) * 3000; t.Uplift_Pct__c = 8 + Math.mod(i, 5) * 3;
    t.Status__c = Math.mod(i, 3) == 0 ? 'Submitted' : 'Live';` : '',
region === 'apac' ? `    t.Mechanic__c = new List<String>{ 'Price Off', 'Bundle', 'Free Goods', 'Display' }[Math.mod(i / 2, 4)]; t.Budget__c = 3000 + Math.mod(i, 4) * 2500; t.Status__c = 'Live';` : '',
region === 'amer' ? `    t.Discount_Pct__c = 5 + Math.mod(i, 4) * 5; t.Funding__c = 5000 + Math.mod(i, 5) * 4000; t.Status__c = Math.mod(i, 4) == 0 ? 'Settled' : 'Running';` : '',
`    promos.add(t);
}
insert promos;`,
region === 'eu' ? `
List<Promotion_Product__c> pps = new List<Promotion_Product__c>();
for (Integer i = 0; i < promos.size(); i++) for (Integer p = 0; p < 2; p++) pps.add(new Promotion_Product__c(Trade_Promotion__c = promos[i].Id, Product__c = products[Math.mod(i + p, products.size())].Id, Discount_Pct__c = 10 + p * 5));
insert pps;
List<Store_Assortment__c> sa = new List<Store_Assortment__c>();
for (Integer i = 0; i < accts.size(); i++) if (accts[i].Customer_Channel__c != 'Wholesale') for (Integer p = 0; p < 4; p++) sa.add(new Store_Assortment__c(Account__c = accts[i].Id, Product__c = products[Math.mod(i + p, products.size())].Id, Must_Stock__c = p < 2));
insert sa;` : '',
region === 'apac' ? `
List<Beat_Plan__c> beats = new List<Beat_Plan__c>();
List<String> days = new List<String>{ 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday' };
for (Integer m = 0; m < markets.size(); m++) beats.add(new Beat_Plan__c(Day_Of_Week__c = days[Math.mod(m, 5)], Territory__c = markets[m] + ' North'));
insert beats;
List<Beat_Plan_Outlet__c> bpo = new List<Beat_Plan_Outlet__c>();
for (Integer i = 0; i < accts.size(); i++) if (accts[i].Customer_Channel__c != 'Wholesale') bpo.add(new Beat_Plan_Outlet__c(Beat_Plan__c = beats[i / 4].Id, Account__c = accts[i].Id, Sequence__c = Math.mod(i, 4) + 1));
insert bpo;
List<Distributor_Claim__c> claims = new List<Distributor_Claim__c>();
for (Integer i = 0; i < promos.size(); i++) if (Math.mod(i, 2) == 0) claims.add(new Distributor_Claim__c(Trade_Promotion__c = promos[i].Id, Distributor__c = accts[Math.min(i * 2 + 3, accts.size() - 1)].Id, Claim_Amount__c = 800 + Math.mod(i, 4) * 200, Status__c = Math.mod(i, 4) == 0 ? 'Paid' : 'Submitted'));
insert claims;
List<Must_Stock_List__c> msl = new List<Must_Stock_List__c>();
for (Integer i = 0; i < accts.size(); i++) if (Math.mod(i, 4) == 0) for (Integer p = 0; p < 3; p++) msl.add(new Must_Stock_List__c(Account__c = accts[i].Id, Product__c = products[p].Id));
insert msl;` : '',
region === 'amer' ? `
List<Order_Request__c> ors = new List<Order_Request__c>();
for (Integer i = 0; i < accts.size(); i++) if (accts[i].Customer_Channel__c != 'Wholesale') ors.add(new Order_Request__c(Account__c = accts[i].Id, Order_Date__c = base.addDays(Math.mod(i, 30)), Status__c = Math.mod(i, 5) == 0 ? 'Draft' : 'Sent to ERP'));
insert ors;
List<Order_Request_Line__c> orl = new List<Order_Request_Line__c>();
for (Integer i = 0; i < ors.size(); i++) for (Integer p = 0; p < 3; p++) orl.add(new Order_Request_Line__c(Order_Request__c = ors[i].Id, Product__c = products[Math.mod(i + p, products.size())].Id, Quantity__c = 5 + p * 5, Unit_Price__c = 12 + p * 4));
insert orl;` : '',
has('Distributor_Stock__c') ? `
List<Distributor_Stock__c> stock = new List<Distributor_Stock__c>();
for (Integer i = 0; i < accts.size(); i++) if (accts[i].Customer_Channel__c == 'Wholesale') for (Integer p = 0; p < products.size(); p++) stock.add(new Distributor_Stock__c(Distributor__c = accts[i].Id, Product__c = products[p].Id, Week_Ending__c = base.addDays(4), Quantity__c = 40 + Math.mod(i * p, 9) * 10));
insert stock;` : '',
`
List<Sales_Target__c> targets = new List<Sales_Target__c>();
for (Integer i = 0; i < accts.size(); i++) if (accts[i].Customer_Tier__c == 'A') for (Integer q = 0; q < 2; q++) {
    Sales_Target__c t = new Sales_Target__c(Account__c = accts[i].Id, Period_Start__c = Date.newInstance(2026, 7 + q * 3, 1), Target_Amount__c = 120000 + Math.mod(i, 5) * 20000);`,
region !== 'apac' ? '    t.Category__c = cats[Math.mod(i + q, cats.size())];' : '',
`    targets.add(t);
}
insert targets;
System.debug('seeded ' + accts.size() + ' accounts across ' + markets.size() + ' markets');
`].filter(Boolean).join('\n');

// Trade promotion and retail depth for the Europe org, loaded on top of the base sample (its own guard, so an org
// seeded before these objects existed gets them too). Past visits only, so no alert emails go out.
const extra = region !== 'eu' ? '' : `
// ${COMPANY} · ${R.label} · trade funds, post-event results, claims, check-ins and visit tasks
if ([SELECT COUNT() FROM Trade_Fund__c] > 0) { System.debug('trade promotion and retail data already loaded'); return; }
List<Account> stores = [SELECT Id FROM Account WHERE Market__c != null AND Customer_Channel__c != 'Wholesale' ORDER BY Name];
List<Account> custs = [SELECT Id FROM Account WHERE Market__c != null ORDER BY Name];
List<String> fundTypes = new List<String>{ 'Fixed', 'Accrual', 'Off-invoice' };
List<Trade_Fund__c> funds = new List<Trade_Fund__c>();
for (Integer i = 0; i < custs.size(); i++) funds.add(new Trade_Fund__c(Account__c = custs[i].Id, Year__c = 2026, Fund_Type__c = fundTypes[Math.mod(i, 3)], Amount__c = 60000 + Math.mod(i, 5) * 10000, Status__c = 'Open'));
insert funds;
Map<Id, Id> fundByAccount = new Map<Id, Id>();
for (Trade_Fund__c f : funds) fundByAccount.put(f.Account__c, f.Id);

List<Trade_Promotion__c> promos = [SELECT Id, Account__c, Budget__c, Status__c, Uplift_Pct__c, Actual_Spend__c FROM Trade_Promotion__c ORDER BY Name];
for (Integer k = 0; k < promos.size(); k++) {
    Trade_Promotion__c p = promos[k];
    p.Trade_Fund__c = fundByAccount.get(p.Account__c);
    if (p.Status__c == 'Live' && p.Budget__c != null) {
        Decimal base = 800 + Math.mod(k, 7) * 100;
        Decimal uplift = (p.Uplift_Pct__c == null ? 10 : p.Uplift_Pct__c) / 100 + (Math.mod(k, 3) - 1) * 0.05;
        p.Baseline_Volume__c = base;
        p.Actual_Volume__c = (base * (1 + uplift)).round();
        p.Actual_Spend__c = (p.Budget__c * (0.7 + Math.mod(k, 4) * 0.1)).setScale(2);
    }
}
update promos;

List<Promotion_Claim__c> claims = new List<Promotion_Claim__c>();
for (Integer i = 0; i < promos.size(); i++) {
    if (promos[i].Actual_Spend__c == null || Math.mod(i, 2) == 1) continue;
    claims.add(new Promotion_Claim__c(Trade_Promotion__c = promos[i].Id, Account__c = promos[i].Account__c, Invoice_Number__c = 'INV-' + String.valueOf(70000 + i),
        Claim_Amount__c = Math.mod(i, 3) == 0 ? 400 : (promos[i].Actual_Spend__c * 0.6).setScale(2), Status__c = 'Submitted'));
}
insert claims;

List<Store_Visit__c> done = [SELECT Id FROM Store_Visit__c WHERE Status__c = 'Completed' ORDER BY Name];
for (Integer i = 0; i < done.size(); i++) {
    if (Math.mod(i, 6) == 0) continue;
    done[i].Checked_In__c = true;
    done[i].Check_In_Latitude__c = 48.85 + Math.mod(i, 40) * 0.05;
    done[i].Check_In_Longitude__c = 2.35 + Math.mod(i, 30) * 0.07;
    done[i].Compliance_Pct__c = 60 + Math.mod(i * 7, 40);
}
update done;
StoreVisitService.countOutOfStocks(new Map<Id, Store_Visit__c>(done).keySet());

List<String> taskTypes = new List<String>{ 'Check price', 'Check display', 'Take photo', 'Survey' };
List<Visit_Task__c> past = new List<Visit_Task__c>();
for (Integer i = 0; i < done.size(); i++) for (Integer t = 0; t < 2; t++) {
    past.add(new Visit_Task__c(Store_Visit__c = done[i].Id, Task_Type__c = taskTypes[Math.mod(i + t, 4)], Done__c = Math.mod(i + t, 5) != 0, Result__c = Math.mod(i + t, 7) == 0 ? 'Issue found' : 'OK'));
}
insert past;

// Next month's visits: each gets a task per must-stock product of its store.
List<Store_Visit__c> planned = new List<Store_Visit__c>();
Date next = Date.newInstance(2026, 11, 2);
for (Integer i = 0; i < stores.size(); i++) planned.add(new Store_Visit__c(Account__c = stores[i].Id, Visit_Date__c = next.addDays(Math.mod(i, 10)), Status__c = 'Planned', Visit_Type__c = Math.mod(i, 4) == 0 ? 'Promotion Check' : 'Routine'));
insert planned;
System.debug('loaded ' + funds.size() + ' funds, ' + claims.size() + ' claims, ' + planned.size() + ' planned visits');
`;

/* ---------------------------------------------------------------- write */

fs.rmSync(path.join(OUT, 'force-app'), { recursive: true, force: true }); // contents only: the folder may be a shell's working directory
for (const [p, body] of Object.entries(files)) {
  const f = path.join(SRC, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}
fs.writeFileSync(path.join(OUT, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], name: `brightwell-${region}`, namespace: '', sfdcLoginUrl: 'https://login.salesforce.com', sourceApiVersion: '67.0' }, null, 2));
fs.writeFileSync(path.join(OUT, 'seed-data.apex'), apex);
const extraFile = path.join(OUT, 'seed-extra.apex');
if (extra) fs.writeFileSync(extraFile, extra.trim() + '\n'); else fs.rmSync(extraFile, { force: true });
const tests = Object.keys(org.apex.tests);
fs.writeFileSync(path.join(OUT, 'tests.txt'), tests.join(' '));
console.log(`${R.label}: ${org.objects.length} custom objects, ${Object.keys(files).length} metadata files, ${tests.length} test classes -> ${path.relative(process.cwd(), OUT)}`);
