# Built-in platform behaviour

Prepared by our team from the org inventory. Owner: **Verification agent**; we review it at that phase's gate.

These behaviours are how Salesforce itself works, so no configuration describes them. We build each one into our platform once and reuse it for every client. For each, we run the same operation in Salesforce and in the new system and compare the result.

| Behaviour | How the target does it | Status |
|---|---|---|
| Restricted picklists reject unknown values | lookup table + foreign key | tested (`platform.restrictedPicklist`) |
| Master-detail delete removes the children | ON DELETE CASCADE | tested (`platform.masterDetailCascade`) |
| Blank numbers count as zero in formulas | COALESCE in the compiled expression | tested (formula values) |
| Roll-up summaries stay current | trigger-maintained column + recompute backstop | tested (roll-up values) |
| TODAY() in the org's time zone | app.today() evaluated in the org time zone | tested (Days_To_Renewal) |
| Field-level security | column grants per role | tested (`security.readOnlyFieldsNotWritable`) |
| Sharing inherited from the parent record | row-level security policy | tested (`security.permsetEditsAllowedFields`) |
| Order of execution on save | save pipeline calling generated hooks in Salesforce order, one transaction | planned |
| Lead conversion | service using the retrieved LeadConvertSettings field mapping | planned |
| Owner change moves open opportunities and cases | service rule on owner change | planned |
| Duplicate and matching rules | check before insert, using retrieved rule definitions | planned |
| Assignment and escalation rules | ordered rule engine + scheduler | planned (rules already extracted) |

7 of 12 behaviours tested today; the rest are on the playbook backlog.
