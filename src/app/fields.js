// Field metadata for the UI, in Salesforce terms (labels, API names, picklists) mapped to the compiled
// Postgres columns. Labels and picklist values come from the org's describe output via the blueprint, so
// the two systems read the same side by side.
const STATUS = ['Draft', 'Active', 'Suspended', 'Cancelled', 'Renewed'];

const SUBSCRIPTION = {
  sobject: 'Subscription__c', label: 'Subscription', plural: 'Subscriptions', table: 'app.subscription', view: 'app.subscription_v',
  fields: [
    { col: 'subscription_number', api: 'Name', label: 'Subscription Number', type: 'text', auto: true },
    { col: 'account_id', api: 'Account__c', label: 'Account', type: 'lookup', ref: 'account', required: true, createOnly: true },
    { col: 'status', api: 'Status__c', label: 'Status', type: 'picklist', values: STATUS, required: true, dflt: 'Draft' },
    { col: 'monthly_recurring_revenue', api: 'MRR__c', label: 'MRR', type: 'currency' },
    { col: 'annual_value', api: 'Annual_Value__c', label: 'Annual Value', type: 'currency', formula: 'MRR__c * 12' },
    { col: 'start_date', api: 'Start_Date__c', label: 'Start Date', type: 'date', required: true },
    { col: 'end_date', api: 'End_Date__c', label: 'End Date', type: 'date', required: true },
    { col: 'term_months', api: 'Term_Months__c', label: 'Term (Months)', type: 'number' },
    { col: 'days_to_renewal', api: 'Days_To_Renewal__c', label: 'Days To Renewal', type: 'number', formula: 'End_Date__c - TODAY()' },
    { col: 'health_score', api: 'Health_Score__c', label: 'Health Score', type: 'number' },
    { col: 'auto_renew', api: 'Auto_Renew__c', label: 'Auto Renew', type: 'checkbox' },
    { col: 'cancellation_reason', api: 'Cancellation_Reason__c', label: 'Cancellation Reason', type: 'text' },
    { col: 'primary_contact_id', api: 'Primary_Contact__c', label: 'Primary Contact', type: 'lookup', ref: 'contact' },
    { col: 'source_opportunity_id', api: 'Source_Opportunity__c', label: 'Source Opportunity', type: 'lookup', ref: 'opportunity' },
    { col: 'line_count', api: 'Line_Count__c', label: 'Line Count', type: 'number', rollup: 'COUNT(Subscription Lines)' },
    { col: 'total_line_value', api: 'Total_Line_Value__c', label: 'Total Line Value', type: 'currency', rollup: 'SUM(Subscription Lines.Line Total)' },
    { col: 'created_date', api: 'CreatedDate', label: 'Created Date', type: 'datetime', system: true },
    { col: 'last_modified_date', api: 'LastModifiedDate', label: 'Last Modified Date', type: 'datetime', system: true },
  ],
};

const LINE = {
  sobject: 'Subscription_Line__c', label: 'Subscription Line', plural: 'Subscription Lines', table: 'app.subscription_line', view: 'app.subscription_line_v',
  fields: [
    { col: 'line_number', api: 'Name', label: 'Line Number', type: 'text', auto: true },
    { col: 'subscription_id', api: 'Subscription__c', label: 'Subscription', type: 'lookup', ref: 'subscription', required: true, createOnly: true },
    { col: 'product_id', api: 'Product__c', label: 'Product', type: 'lookup', ref: 'product2' },
    { col: 'quantity', api: 'Quantity__c', label: 'Quantity', type: 'number', required: true },
    { col: 'unit_price', api: 'Unit_Price__c', label: 'Unit Price', type: 'currency', required: true },
    { col: 'line_total', api: 'Line_Total__c', label: 'Line Total', type: 'currency', formula: 'Quantity__c * Unit_Price__c' },
    { col: 'account_name', api: 'Account_Name__c', label: 'Account Name', type: 'text', formula: 'Subscription__r.Account__r.Name' },
  ],
};

// Each persona is a Salesforce profile or permission set, compiled to a Postgres role by the Security Compiler.
// System Administrator runs as the schema owner (Modify All Data).
const PERSONAS = {
  admin: { label: 'System Administrator', role: null, note: 'Modify All Data' },
  subscription_management: { label: 'Subscription Management', role: 'sf_permset_subscription_management', note: 'Permission set' },
  analytics: { label: 'Analytics Cloud Integration User', role: 'sf_profile_analytics_cloud_integration_user', note: 'Profile · read only' },
};

const isWritable = (f) => !f.auto && !f.formula && !f.rollup && !f.system;

module.exports = { SUBSCRIPTION, LINE, PERSONAS, STATUS, isWritable };
