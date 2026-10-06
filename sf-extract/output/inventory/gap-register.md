# Gap register

Generated 2026-10-06 by `scripts/extract-inventory.js` for Ascendion (Developer Edition, time zone America/Los_Angeles).

Everything below is either collected automatically or has an agreed way to be handled. Items marked
**client input** are confirmed with the client during the assessment.

## 1. Collected automatically

| Area | Count | Where |
|---|---|---|
| Metadata types requested | 89 | `manifest/package.xml` |
| Report (folder-based): listed / retrieved | 30 / 6 | `force-app/` |
| Dashboard (folder-based): listed / retrieved | 2 / 0 | `force-app/` |
| EmailTemplate (folder-based): listed / retrieved | 28 / 28 | `force-app/` |
| Document (folder-based): listed / retrieved | 0 / 0 | `force-app/` |
| Reports with usage dates | 30 | `reports.json` |
| Dashboards | 2 | `dashboards.json` |
| Email templates with usage | 28 | `emailTemplates.json` |
| Scheduled jobs | 3 | `scheduledJobs.json` |
| Named credentials (endpoints) | 0 | `namedCredentials.json` |
| Remote sites (endpoints) | 1 | `remoteSites.json` |
| Connected apps | 0 | `connectedApps.json` |
| Installed packages | 1 | `packages.json` |
| Currencies | not offered by this org | `currencies.json` |
| Field history tables | 171 | `fieldHistory.json` |
| Encrypted fields | 0 | `encryptedFields.json` |

## 2. Not exported by Salesforce, and how each is handled

| Item | In this org | How we handle it | Owner |
|---|---|---|---|
| Managed package source code | Developer Edition (devedapp) | Configuration exported as data; behaviour captured as tests from the outside; rebuild or replace decided per package | Assessment, **client input** |
| Passwords, tokens, secrets, private keys | 0 credentials, 0 connected apps | Users move to SSO or reset at go-live; integration owners issue new credentials, tracked on the cutover checklist | Client IT |
| Who calls Salesforce from outside | 4 login sources in 90 days | Login history per application and integration user, confirmed in interviews; the compatibility layer keeps callers working during migration | Assessment, **client input** |
| History older than Salesforce keeps | audit trail from 2026-09-13, logins from 2026-09-13 | Archived from day one of the engagement; retention agreed with compliance | **client input** |
| Built-in platform behaviour (lead conversion, owner-change cascades, order of execution) | not configuration | Written once into the translation playbook; checked by the parity harness | Our team |
| Work in flight at cutover | 0 pending approvals, 0 paused flows, 3 scheduled jobs | Drained before the freeze or carried over, decided per item | Cutover plan |
| Encryption keys | 0 encrypted fields | Data read decrypted by an authorised user; re-encrypted in the target with client-held keys | Client security |
| Folder items listed but not retrieved | Report 24 of 30, Dashboard 2 of 2 | Usually Salesforce-managed or private folders; confirmed with the client whether they are in use, then retrieved by the folder owner | Assessment |
| Items the extraction user could not read | Dashboard (2), Layout (2) | Re-run with a user who has View All Data and Manage Reports/Dashboards, or ask the folder owner to share | Client admin |
| Email captured by Einstein Activity Capture | ask | Re-synced from the mail server into the target | **client input** |
| Separate products (Marketing Cloud, Account Engagement, CRM Analytics, Tableau) | ask | Scoped separately in the assessment if used | **client input** |

## 3. Ways we keep the remaining gap small

- **Coverage check.** The org lists 187 further metadata types that are not requested today (`coverage.json`). Each is reviewed once and added to the manifest or marked not relevant.
- **Usage evidence.** 30 reports and 28 email templates have not been used in 180 days. Confirming these with the client reduces what needs rebuilding.
- **Shadow run.** Salesforce and the target run side by side; differences in outbound calls and results are recorded and turned into tests.
- **Archive early.** Audit trail, login history and field history are exported on a schedule from the first week, so nothing expires during the project.
- **Assessment questionnaire.** The **client input** items above are asked in one workshop, with this register as the agenda.

## Top login sources

| Application | Login type | Logins | Users | Last login |
|---|---|---|---|---|
| Browser | Application | 8 | 1 | 2026-10-05 |
| Salesforce CLI | Remote Access 2.0 | 5 | 1 | 2026-10-06 |
| orgfarm_app_1 | Remote Access 2.0 | 3 | 1 | 2026-09-22 |
| Browser | Remote Access Client | 3 | 1 | 2026-10-01 |
