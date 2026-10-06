# Gap register

Prepared 2026-10-06 from Ascendion org (Developer Edition, time zone America/Los_Angeles).

This is our list of everything Salesforce does not hand over, and how we will handle each item. Items marked
**client input** are the ones we confirm during the assessment.

## 1. What we have already collected

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
| Installed packages | 2 | `packages.json` |
| Currencies | not offered by this org | `currencies.json` |
| Field history tables | 171 | `fieldHistory.json` |
| Encrypted fields | 0 | `encryptedFields.json` |

## 2. What Salesforce keeps, and how we will handle it

| Item | In this org | How we handle it | Owner |
|---|---|---|---|
| Managed package source code | Developer Edition (devedapp); Declarative Lookup Rollup Summaries Tool (dlrs) | We export the package settings as data, record what the package does as test cases, then rebuild, replace or retain it | Assessment, **client input** |
| Passwords, tokens, secrets, private keys | 0 credentials, 0 connected apps | We move users to single sign-on (or a new password on day one); each integration owner issues a new credential, tracked on our cutover checklist | Client IT |
| Who calls Salesforce from outside | 4 login sources in 90 days | We identify each caller from login history and confirm its owner; a Salesforce-compatible connection keeps them working while they move | Assessment, **client input** |
| History older than Salesforce keeps | audit trail from 2026-09-13, logins from 2026-09-13 | We start archiving in week one and agree retention with compliance | **client input** |
| Built-in platform behaviour (lead conversion, owner-change cascades, order of execution) | not configuration | We build this behaviour into the platform once and test it against the org | Our team |
| Work in flight at cutover | 0 pending approvals, 0 paused flows, 3 scheduled jobs | We finish each item before the freeze or carry it over in the same state | Cutover plan |
| Encryption keys | 0 encrypted fields | We read the data through an authorised user and encrypt it again in the new system with keys held in the target environment | Client security |
| Folder items listed but not retrieved | Report 24 of 30, Dashboard 2 of 2 | Usually Salesforce-managed or private folders; we check whether they are used, then the folder owner shares them | Assessment |
| Items the extraction user could not read | Dashboard (2), Layout (2) | We run again with a user who has View All Data, or the folder owner shares them | Client admin |
| Email captured by Einstein Activity Capture | ask | We sync email history again from the mail server | **client input** |
| Separate products (Marketing Cloud, Account Engagement, CRM Analytics, Tableau) | ask | Where they are used, we scope them separately | **client input** |

## 3. How we keep this list short

- **Coverage check.** The org lists 187 further metadata types that are not requested today (`coverage.json`). We review each one once and either add it or mark it as not relevant.
- **Usage evidence.** 30 reports and 28 email templates have not been used in 180 days. We retire the unused ones, so we rebuild less.
- **Side-by-side run.** We run Salesforce and the new system in parallel; any difference becomes a new test.
- **Archive early.** We save audit trail, login history and field history on a schedule from week one, so nothing expires during the project.
- **One workshop.** We confirm the **client input** items in one session, using this list as the agenda.

## Top login sources

| Application | Login type | Logins | Users | Last login |
|---|---|---|---|---|
| Browser | Application | 8 | 1 | 2026-10-05 |
| Salesforce CLI | Remote Access 2.0 | 6 | 1 | 2026-10-06 |
| orgfarm_app_1 | Remote Access 2.0 | 3 | 1 | 2026-09-22 |
| Browser | Remote Access Client | 3 | 1 | 2026-10-01 |
