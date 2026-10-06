# History archive plan

Prepared by our team from the org inventory. Owner: **Data load agent**; we review it at that phase's gate.

Salesforce deletes some history after a fixed time. From week one we save each source on a schedule, adding only what is new since the last run, so nothing expires while the project runs. At go-live we load the archive into the new system, which keeps history with no time limit.

| Source | Salesforce keeps | Reaches back to today | Archive |
|---|---|---|---|
| Field history (171 history tables) | 18 months in the UI, 24 via API; longer only with Field Audit Trail | per table | weekly, by `CreatedDate` watermark |
| Setup Audit Trail (configuration changes) | 180 days | 2026-09-13 | weekly |
| Login history | 6 months | 2026-09-13 | weekly |
| Recycle bin (deleted records) | 15 days | — | daily, `queryAll` where `IsDeleted = true` |
| Event Monitoring logs | 1 day, or 30 with Shield | — | daily, if licensed |

| Decision | Value |
|---|---|
| Retention required by compliance (years, per source) | _to confirm_ |
| History older than today's reach: accepted as not available | _to confirm_ |
| Fields never tracked: changes were not recorded and cannot be recovered | noted |
