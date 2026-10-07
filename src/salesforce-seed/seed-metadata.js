// POC seeding: writes the Subscription domain metadata into force-app/.
// Deliberately exercises the hard migration cases — master-detail + roll-ups, cross-object
// formulas, PRIORVALUE/ISCHANGED validation, trigger + batch Apex, record-triggered flow.
const fs = require('fs');
const path = require('path');

const SRC = require('../paths').FORCE_APP;
const X = '<?xml version="1.0" encoding="UTF-8"?>';
const files = {};
const add = (p, body) => { files[p] = X + '\n' + body.trim() + '\n'; };

const field = (obj, name, body) => add(`objects/${obj}/fields/${name}.field-meta.xml`,
  `<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${name}</fullName>\n${body}\n</CustomField>`);

const vrule = (obj, name, formula, message, displayField) => add(
  `objects/${obj}/validationRules/${name}.validationRule-meta.xml`,
  `<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${name}</fullName>
    <active>true</active>
    <errorConditionFormula>${formula}</errorConditionFormula>${displayField ? `\n    <errorDisplayField>${displayField}</errorDisplayField>` : ''}
    <errorMessage>${message}</errorMessage>
</ValidationRule>`);

const apexClass = (name, body) => {
  files[`classes/${name}.cls`] = body.trim() + '\n';
  add(`classes/${name}.cls-meta.xml`, `<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>67.0</apiVersion>\n    <status>Active</status>\n</ApexClass>`);
};
const apexTrigger = (name, body) => {
  files[`triggers/${name}.trigger`] = body.trim() + '\n';
  add(`triggers/${name}.trigger-meta.xml`, `<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>67.0</apiVersion>\n    <status>Active</status>\n</ApexTrigger>`);
};

/* ---------------------------------------------------------------- objects */

add('objects/Subscription__c/Subscription__c.object-meta.xml', `
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <deploymentStatus>Deployed</deploymentStatus>
    <description>Recurring service agreement. POC object for migration testing.</description>
    <enableActivities>true</enableActivities>
    <enableHistory>true</enableHistory>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <label>Subscription</label>
    <nameField>
        <displayFormat>SUB-{0000}</displayFormat>
        <label>Subscription Number</label>
        <type>AutoNumber</type>
    </nameField>
    <pluralLabel>Subscriptions</pluralLabel>
    <sharingModel>ControlledByParent</sharingModel>
</CustomObject>`);

field('Subscription__c', 'Account__c', `    <label>Account</label>
    <referenceTo>Account</referenceTo>
    <relationshipLabel>Subscriptions</relationshipLabel>
    <relationshipName>Subscriptions</relationshipName>
    <relationshipOrder>0</relationshipOrder>
    <reparentableMasterDetail>false</reparentableMasterDetail>
    <type>MasterDetail</type>
    <writeRequiresMasterRead>false</writeRequiresMasterRead>`);

field('Subscription__c', 'Primary_Contact__c', `    <deleteConstraint>SetNull</deleteConstraint>
    <label>Primary Contact</label>
    <referenceTo>Contact</referenceTo>
    <relationshipLabel>Subscriptions</relationshipLabel>
    <relationshipName>Subscriptions</relationshipName>
    <required>false</required>
    <type>Lookup</type>`);

field('Subscription__c', 'Source_Opportunity__c', `    <deleteConstraint>SetNull</deleteConstraint>
    <label>Source Opportunity</label>
    <referenceTo>Opportunity</referenceTo>
    <relationshipLabel>Subscriptions</relationshipLabel>
    <relationshipName>Subscriptions</relationshipName>
    <required>false</required>
    <type>Lookup</type>`);

field('Subscription__c', 'Start_Date__c', `    <label>Start Date</label>
    <required>true</required>
    <trackHistory>true</trackHistory>
    <type>Date</type>`);

field('Subscription__c', 'End_Date__c', `    <label>End Date</label>
    <required>true</required>
    <trackHistory>true</trackHistory>
    <type>Date</type>`);

field('Subscription__c', 'Status__c', `    <label>Status</label>
    <required>true</required>
    <trackHistory>true</trackHistory>
    <type>Picklist</type>
    <valueSet>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value><fullName>Draft</fullName><default>true</default><label>Draft</label></value>
            <value><fullName>Active</fullName><default>false</default><label>Active</label></value>
            <value><fullName>Suspended</fullName><default>false</default><label>Suspended</label></value>
            <value><fullName>Cancelled</fullName><default>false</default><label>Cancelled</label></value>
            <value><fullName>Renewed</fullName><default>false</default><label>Renewed</label></value>
        </valueSetDefinition>
    </valueSet>`);

field('Subscription__c', 'MRR__c', `    <label>MRR</label>
    <precision>16</precision>
    <scale>2</scale>
    <trackHistory>true</trackHistory>
    <type>Currency</type>`);

field('Subscription__c', 'Term_Months__c', `    <label>Term (Months)</label>
    <precision>4</precision>
    <scale>0</scale>
    <type>Number</type>`);

field('Subscription__c', 'Auto_Renew__c', `    <defaultValue>false</defaultValue>
    <label>Auto Renew</label>
    <type>Checkbox</type>`);

field('Subscription__c', 'Health_Score__c', `    <label>Health Score</label>
    <precision>3</precision>
    <scale>0</scale>
    <type>Number</type>`);

field('Subscription__c', 'Cancellation_Reason__c', `    <label>Cancellation Reason</label>
    <length>255</length>
    <type>Text</type>`);

// Row-local formula: compiles straight to a Postgres generated column.
field('Subscription__c', 'Annual_Value__c', `    <formula>MRR__c * 12</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <label>Annual Value</label>
    <precision>18</precision>
    <required>false</required>
    <scale>2</scale>
    <type>Currency</type>`);

// Formula over TODAY(): cannot be a stored generated column — must become a view.
field('Subscription__c', 'Days_To_Renewal__c', `    <formula>End_Date__c - TODAY()</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <label>Days To Renewal</label>
    <precision>18</precision>
    <required>false</required>
    <scale>0</scale>
    <type>Number</type>`);

// Roll-ups: become trigger-maintained columns in the target.
field('Subscription__c', 'Total_Line_Value__c', `    <label>Total Line Value</label>
    <summarizedField>Subscription_Line__c.Line_Total__c</summarizedField>
    <summaryForeignKey>Subscription_Line__c.Subscription__c</summaryForeignKey>
    <summaryOperation>sum</summaryOperation>
    <type>Summary</type>`);

field('Subscription__c', 'Line_Count__c', `    <label>Line Count</label>
    <summaryForeignKey>Subscription_Line__c.Subscription__c</summaryForeignKey>
    <summaryOperation>count</summaryOperation>
    <type>Summary</type>`);

add('objects/Subscription_Line__c/Subscription_Line__c.object-meta.xml', `
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <deploymentStatus>Deployed</deploymentStatus>
    <description>Line item on a subscription. POC object for migration testing.</description>
    <enableActivities>false</enableActivities>
    <enableHistory>true</enableHistory>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <label>Subscription Line</label>
    <nameField>
        <displayFormat>SL-{0000}</displayFormat>
        <label>Line Number</label>
        <type>AutoNumber</type>
    </nameField>
    <pluralLabel>Subscription Lines</pluralLabel>
    <sharingModel>ControlledByParent</sharingModel>
</CustomObject>`);

field('Subscription_Line__c', 'Subscription__c', `    <label>Subscription</label>
    <referenceTo>Subscription__c</referenceTo>
    <relationshipLabel>Subscription Lines</relationshipLabel>
    <relationshipName>Subscription_Lines</relationshipName>
    <relationshipOrder>0</relationshipOrder>
    <reparentableMasterDetail>false</reparentableMasterDetail>
    <type>MasterDetail</type>
    <writeRequiresMasterRead>false</writeRequiresMasterRead>`);

field('Subscription_Line__c', 'Product__c', `    <deleteConstraint>SetNull</deleteConstraint>
    <label>Product</label>
    <referenceTo>Product2</referenceTo>
    <relationshipLabel>Subscription Lines</relationshipLabel>
    <relationshipName>Subscription_Lines</relationshipName>
    <required>false</required>
    <type>Lookup</type>`);

field('Subscription_Line__c', 'Quantity__c', `    <label>Quantity</label>
    <precision>6</precision>
    <scale>0</scale>
    <required>true</required>
    <type>Number</type>`);

field('Subscription_Line__c', 'Unit_Price__c', `    <label>Unit Price</label>
    <precision>16</precision>
    <scale>2</scale>
    <required>true</required>
    <type>Currency</type>`);

field('Subscription_Line__c', 'Line_Total__c', `    <formula>Quantity__c * Unit_Price__c</formula>
    <formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>
    <label>Line Total</label>
    <precision>18</precision>
    <required>false</required>
    <scale>2</scale>
    <type>Currency</type>`);

// Two-hop cross-object formula: needs a join in the target, not a generated column.
field('Subscription_Line__c', 'Account_Name__c', `    <formula>Subscription__r.Account__r.Name</formula>
    <formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>
    <label>Account Name</label>
    <required>false</required>
    <type>Text</type>`);

field('Opportunity', 'Loss_Reason__c', `    <label>Loss Reason</label>
    <type>Picklist</type>
    <valueSet>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value><fullName>Price</fullName><default>false</default><label>Price</label></value>
            <value><fullName>Timing</fullName><default>false</default><label>Timing</label></value>
            <value><fullName>Competitor</fullName><default>false</default><label>Lost to competitor</label></value>
            <value><fullName>No Budget</fullName><default>false</default><label>No budget</label></value>
            <value><fullName>No Decision</fullName><default>false</default><label>No decision made</label></value>
            <value><fullName>Other</fullName><default>false</default><label>Other</label></value>
        </valueSetDefinition>
    </valueSet>`);

/* ------------------------------------------------------- validation rules */

vrule('Subscription__c', 'End_Date_After_Start_Date',
  'AND( NOT(ISBLANK(Start_Date__c)), NOT(ISBLANK(End_Date__c)), End_Date__c &lt;= Start_Date__c )',
  'End Date must be after Start Date.', 'End_Date__c');

// Needs the prior row: impossible as a CHECK constraint, must become a service guard.
vrule('Subscription__c', 'No_Reactivation_After_Cancel',
  'AND( ISCHANGED(Status__c), ISPICKVAL(PRIORVALUE(Status__c), "Cancelled"), NOT(ISPICKVAL(Status__c, "Cancelled")) )',
  'A cancelled subscription cannot be reactivated. Create a new subscription instead.', 'Status__c');

vrule('Subscription__c', 'Cancellation_Reason_Required',
  'AND( ISPICKVAL(Status__c, "Cancelled"), ISBLANK(Cancellation_Reason__c) )',
  'Cancellation Reason is required when Status is Cancelled.', 'Cancellation_Reason__c');

vrule('Subscription__c', 'Active_Requires_MRR',
  'AND( ISPICKVAL(Status__c, "Active"), OR( ISBLANK(MRR__c), MRR__c &lt;= 0 ) )',
  'An active subscription must have an MRR greater than zero.', 'MRR__c');

vrule('Subscription_Line__c', 'Quantity_Must_Be_Positive',
  'Quantity__c &lt;= 0', 'Quantity must be greater than zero.', 'Quantity__c');

// Cross-object validation: reads the parent, so it needs a join at write time.
vrule('Subscription_Line__c', 'Parent_Not_Cancelled',
  'ISPICKVAL(Subscription__r.Status__c, "Cancelled")',
  'You cannot add or change lines on a cancelled subscription.');

vrule('Opportunity', 'Loss_Reason_Required_When_Lost',
  'AND( ISPICKVAL(StageName, "Closed Lost"), ISBLANK(TEXT(Loss_Reason__c)) )',
  'A Loss Reason is required before an opportunity can be marked Closed Lost.', 'Loss_Reason__c');

vrule('Opportunity', 'Closed_Won_Requires_Amount',
  'AND( ISPICKVAL(StageName, "Closed Won"), OR( ISBLANK(Amount), Amount &lt;= 0 ) )',
  'A won opportunity must have an Amount greater than zero.', 'Amount');

/* ------------------------------------------------------------------ apex */

apexTrigger('SubscriptionTrigger', `
trigger SubscriptionTrigger on Subscription__c (before insert, before update, after update) {
    if (Trigger.isBefore) {
        SubscriptionService.applyDefaults(Trigger.new);
    } else if (Trigger.isAfter && Trigger.isUpdate) {
        SubscriptionService.handleStatusChange(Trigger.new, Trigger.oldMap);
    }
}`);

apexTrigger('OpportunityTrigger', `
trigger OpportunityTrigger on Opportunity (after update) {
    OpportunityService.createSubscriptionsForWonDeals(Trigger.new, Trigger.oldMap);
}`);

apexClass('SubscriptionService', `
/**
 * Subscription domain logic. Translation targets: applyDefaults becomes a BEFORE trigger or
 * service hook; handleStatusChange becomes an after-commit service call.
 */
public with sharing class SubscriptionService {

    public static final Integer DEFAULT_HEALTH_SCORE = 70;
    public static final Integer AT_RISK_THRESHOLD = 50;

    /** Fills derived defaults that Salesforce cannot express as field defaults. */
    public static void applyDefaults(List<Subscription__c> subs) {
        for (Subscription__c s : subs) {
            if (s.Health_Score__c == null) {
                s.Health_Score__c = DEFAULT_HEALTH_SCORE;
            }
            if (s.Start_Date__c != null && s.Term_Months__c != null && s.End_Date__c == null) {
                s.End_Date__c = s.Start_Date__c.addMonths(Integer.valueOf(s.Term_Months__c));
            }
            if (s.Start_Date__c != null && s.End_Date__c != null && s.Term_Months__c == null) {
                s.Term_Months__c = s.Start_Date__c.monthsBetween(s.End_Date__c);
            }
        }
    }

    /**
     * On cancellation, stamp the account and raise a save-off task for the owner.
     * Recursion guard matters here: the update below re-enters this trigger.
     */
    private static Boolean processing = false;

    public static void handleStatusChange(List<Subscription__c> subs, Map<Id, Subscription__c> oldMap) {
        if (processing) {
            return;
        }
        List<Task> tasks = new List<Task>();
        Set<Id> accountIds = new Set<Id>();

        for (Subscription__c s : subs) {
            Subscription__c prior = oldMap.get(s.Id);
            Boolean justCancelled = s.Status__c == 'Cancelled' && prior.Status__c != 'Cancelled';
            if (justCancelled) {
                accountIds.add(s.Account__c);
                tasks.add(new Task(
                    Subject = 'Save-off call: ' + s.Name,
                    WhatId = s.Id,
                    ActivityDate = Date.today().addDays(2),
                    Priority = 'High',
                    Status = 'Not Started'
                ));
            }
        }

        if (!tasks.isEmpty()) {
            processing = true;
            insert tasks;
            processing = false;
        }
    }

    /** Aggregate used by reporting and by the renewal batch. */
    public static Decimal totalActiveMrr(Id accountId) {
        AggregateResult[] rows = [
            SELECT SUM(MRR__c) total
            FROM Subscription__c
            WHERE Account__c = :accountId AND Status__c = 'Active'
        ];
        Decimal total = (Decimal) rows[0].get('total');
        return total == null ? 0 : total;
    }
}`);

apexClass('OpportunityService', `
/**
 * Creates a subscription when a deal is won. Translation target: an outbox consumer,
 * since it writes to another aggregate after the opportunity commits.
 */
public with sharing class OpportunityService {

    public static final Integer DEFAULT_TERM_MONTHS = 12;

    public static void createSubscriptionsForWonDeals(List<Opportunity> opps, Map<Id, Opportunity> oldMap) {
        Set<Id> wonOppIds = new Set<Id>();
        for (Opportunity o : opps) {
            Opportunity prior = oldMap.get(o.Id);
            if (o.StageName == 'Closed Won' && prior.StageName != 'Closed Won' && o.AccountId != null) {
                wonOppIds.add(o.Id);
            }
        }
        if (wonOppIds.isEmpty()) {
            return;
        }

        // Idempotency: never create a second subscription for the same opportunity.
        Set<Id> alreadyCreated = new Set<Id>();
        for (Subscription__c existing : [
            SELECT Source_Opportunity__c FROM Subscription__c WHERE Source_Opportunity__c IN :wonOppIds
        ]) {
            alreadyCreated.add(existing.Source_Opportunity__c);
        }

        List<Subscription__c> toCreate = new List<Subscription__c>();
        for (Opportunity o : opps) {
            if (!wonOppIds.contains(o.Id) || alreadyCreated.contains(o.Id)) {
                continue;
            }
            Date startDate = o.CloseDate == null ? Date.today() : o.CloseDate;
            toCreate.add(new Subscription__c(
                Account__c = o.AccountId,
                Source_Opportunity__c = o.Id,
                Start_Date__c = startDate,
                End_Date__c = startDate.addMonths(DEFAULT_TERM_MONTHS),
                Term_Months__c = DEFAULT_TERM_MONTHS,
                Status__c = 'Active',
                MRR__c = o.Amount == null ? 0 : (o.Amount / DEFAULT_TERM_MONTHS).setScale(2),
                Auto_Renew__c = true
            ));
        }
        if (!toCreate.isEmpty()) {
            insert toCreate;
        }
    }
}`);

apexClass('SubscriptionRenewalBatch', `
/**
 * Nightly renewal sweep. Translation target: a cron worker — the governor limits that shaped
 * this batch size do not exist in the target, so the query must be re-bounded deliberately.
 */
public with sharing class SubscriptionRenewalBatch implements Database.Batchable<SObject>, Schedulable {

    public static final Integer NOTICE_WINDOW_DAYS = 30;

    public Database.QueryLocator start(Database.BatchableContext ctx) {
        Date cutoff = Date.today().addDays(NOTICE_WINDOW_DAYS);
        return Database.getQueryLocator([
            SELECT Id, Name, Account__c, End_Date__c, Auto_Renew__c, Health_Score__c
            FROM Subscription__c
            WHERE Status__c = 'Active' AND End_Date__c <= :cutoff AND End_Date__c >= TODAY
        ]);
    }

    public void execute(Database.BatchableContext ctx, List<Subscription__c> scope) {
        List<Task> tasks = new List<Task>();
        for (Subscription__c s : scope) {
            tasks.add(new Task(
                Subject = (s.Auto_Renew__c ? 'Confirm auto-renewal: ' : 'Renewal outreach: ') + s.Name,
                WhatId = s.Id,
                ActivityDate = s.End_Date__c,
                Priority = s.Health_Score__c != null && s.Health_Score__c < SubscriptionService.AT_RISK_THRESHOLD ? 'High' : 'Normal',
                Status = 'Not Started'
            ));
        }
        if (!tasks.isEmpty()) {
            insert tasks;
        }
    }

    public void finish(Database.BatchableContext ctx) {
        // Deliberately empty: the translated worker reports completion through its own job log.
    }

    public void execute(SchedulableContext ctx) {
        Database.executeBatch(new SubscriptionRenewalBatch(), 200);
    }
}`);

apexClass('SubscriptionServiceTest', `
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
}`);

/* ------------------------------------------------------------------ flow */

add('flows/Subscription_At_Risk_Alert.flow-meta.xml', `
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>67.0</apiVersion>
    <description>Raises a check-in task when an active subscription drops below the at-risk health threshold.</description>
    <environments>Default</environments>
    <interviewLabel>Subscription At Risk Alert {!$Flow.CurrentDateTime}</interviewLabel>
    <label>Subscription At Risk Alert</label>
    <processMetadataValues>
        <name>BuilderType</name>
        <value><stringValue>LightningFlowBuilder</stringValue></value>
    </processMetadataValues>
    <processType>AutoLaunchedFlow</processType>
    <recordCreates>
        <name>Create_Health_Check_Task</name>
        <label>Create Health Check Task</label>
        <locationX>176</locationX>
        <locationY>288</locationY>
        <inputAssignments>
            <field>ActivityDate</field>
            <value><elementReference>$Flow.CurrentDate</elementReference></value>
        </inputAssignments>
        <inputAssignments>
            <field>Priority</field>
            <value><stringValue>High</stringValue></value>
        </inputAssignments>
        <inputAssignments>
            <field>Status</field>
            <value><stringValue>Not Started</stringValue></value>
        </inputAssignments>
        <inputAssignments>
            <field>Subject</field>
            <value><stringValue>Health check: at-risk subscription</stringValue></value>
        </inputAssignments>
        <inputAssignments>
            <field>WhatId</field>
            <value><elementReference>$Record.Id</elementReference></value>
        </inputAssignments>
        <object>Task</object>
        <storeOutputAutomatically>true</storeOutputAutomatically>
    </recordCreates>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector><targetReference>Create_Health_Check_Task</targetReference></connector>
        <filterFormula>AND( {!$Record.Health_Score__c} &lt; 50, ISPICKVAL({!$Record.Status__c}, "Active") )</filterFormula>
        <object>Subscription__c</object>
        <recordTriggerType>CreateAndUpdate</recordTriggerType>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Active</status>
</Flow>`);

/* -------------------------------------------------------- permission set */

// Required and master-detail fields are always visible, and Salesforce rejects FLS entries for them.
const subFields = ['Primary_Contact__c', 'Source_Opportunity__c',
  'MRR__c', 'Term_Months__c', 'Auto_Renew__c', 'Health_Score__c', 'Cancellation_Reason__c'];
const subReadOnly = ['Annual_Value__c', 'Days_To_Renewal__c', 'Total_Line_Value__c', 'Line_Count__c'];
const lineFields = ['Product__c'];
const lineReadOnly = ['Line_Total__c', 'Account_Name__c'];

const fp = (obj, name, editable) => `    <fieldPermissions>
        <editable>${editable}</editable>
        <field>${obj}.${name}</field>
        <readable>true</readable>
    </fieldPermissions>`;
// Detail objects inherit sharing from their master, so read on the master is a hard dependency.
const op = (obj, readOnly) => `    <objectPermissions>
        <allowCreate>${!readOnly}</allowCreate>
        <allowDelete>${!readOnly}</allowDelete>
        <allowEdit>${!readOnly}</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>false</modifyAllRecords>
        <object>${obj}</object>
        <viewAllRecords>false</viewAllRecords>
    </objectPermissions>`;

add('permissionsets/Subscription_Management.permissionset-meta.xml', `
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Full access to the POC subscription domain.</description>
    <hasActivationRequired>false</hasActivationRequired>
    <label>Subscription Management</label>
${subFields.map((f) => fp('Subscription__c', f, true)).join('\n')}
${subReadOnly.map((f) => fp('Subscription__c', f, false)).join('\n')}
${lineFields.map((f) => fp('Subscription_Line__c', f, true)).join('\n')}
${lineReadOnly.map((f) => fp('Subscription_Line__c', f, false)).join('\n')}
${fp('Opportunity', 'Loss_Reason__c', true)}
${op('Account', true)}
${op('Opportunity', true)}
${op('Subscription__c')}
${op('Subscription_Line__c')}
</PermissionSet>`);

/* ----------------------------------------------------------------- write */

for (const [rel, body] of Object.entries(files)) {
  const file = path.join(SRC, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
console.log(`wrote ${Object.keys(files).length} files under force-app/main/default`);
