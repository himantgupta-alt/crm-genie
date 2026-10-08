# Migrate: how does the data move?

## 1. Purpose and scope

We move every record parent first, keep its Salesforce ID, and reconcile object by object. The load order is designed in the HLD, section 8.3, and the LLD, section 7.

## 2. The agents in this phase

### 2.1 Data load agent

<div class="agent">

**What it does**

Loads every record in dependency order, keeps the Salesforce record IDs, then recomputes totals.

**What it produces**

- Loaded database and load report
- `history-archive.md`
- `work-in-progress.md`

</div>

## 3. Inputs

- The data export from Agent 01
- The database built by Agent 03

## 4. Outputs and results

| Object | Records in Salesforce | Reconciliation |
|---|---|---|
| Subscription | 107 | count and IDs match |
| Subscription Line | 219 | count and IDs match |
| Account | 22 | count and IDs match |
| Contact | 20 | count and IDs match |
| Opportunity | 31 | count and IDs match |
| Product | 17 | count and IDs match |

## 5. How we keep it safe

- Salesforce stays the system of record until each module is switched over
- Changes in Salesforce keep flowing to the new system until cutover
- The final switch happens in a short, rehearsed freeze
- We split big objects into parts and load them in parallel, parents before children
- We recalculate totals once after the load, then check them against Salesforce

## 6. History archive

Salesforce deletes some history after a fixed time. From week one we save each source on a schedule, adding only what is new, so nothing expires while the project runs. At go-live we load the archive into the new system, which keeps history with no time limit.

| Source | Salesforce keeps | Reaches back to today | Archive |
|---|---|---|---|
| Field history (171 history tables) | 18 months in the UI, 24 via API; longer only with Field Audit Trail | per table | weekly, by `CreatedDate` watermark |
| Setup Audit Trail (configuration changes) | 180 days | 2026-09-13 | weekly |
| Login history | 6 months | 2026-09-13 | weekly |
| Recycle bin (deleted records) | 15 days | — | daily, `queryAll` where `IsDeleted = true` |
| Event Monitoring logs | 1 day, or 30 with Shield | — | daily, if licensed |

## 7. Work in progress at go-live

Processes that are halfway through on the day we switch live inside Salesforce, not in the records. We finish each one before the freeze, or carry it over in the same state.

| Item | Today | Route |
|---|---|---|
| Pending approvals | 0 | finish before the freeze, or carry over |
| Paused flows | 0 | finish before the freeze, or carry over |
| Scheduled jobs | 3 | switched in one step at cutover (Agent 06 - Go-live, section 7) |

## 8. Review gate and items to confirm

**What a person checks before the next phase starts**

- Record counts and IDs match Salesforce for every object
- The history archive runs on schedule

**What we ask you to confirm**

- How long history must be kept, per source
- The freeze window for the final switch

## 9. Where the artifacts live

| Artifact | Location |
|---|---|
| Load scripts and report | `adlc/4-migrate/data-load` |
| History archive plan | `adlc/4-migrate/data-load/history-archive.md` |
| Work in progress at go-live | `adlc/4-migrate/data-load/work-in-progress.md` |
