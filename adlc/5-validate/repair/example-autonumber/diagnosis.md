# Diagnosis: security.permsetEditsAllowedFields

Owner: Repair agent · recorded example (see README.md)

| | |
|---|---|
| Symptom | Step 5 of the case inserts a subscription line as `sf_permset_subscription_management`; it is rejected with `insufficient_access` (42501). See `failing-run.txt`. |
| Trace | INSERT → column default `line_number = app.next_autonumber(...)` → UPDATE `app.autonumber` |
| Cause | The role has no privilege on `app.autonumber`, an internal counter table. |
| Platform | Salesforce assigns auto-numbers in system context, whatever the user's permissions. |
| Fix | Generate `next_autonumber()` as `SECURITY DEFINER` with a pinned `search_path` (`emit-postgres.js.patch`). |
| Scope | Generator only (`src/generators/emit-postgres.js`). No grant to any user role is widened. |
| Verify | Generate `adlc/3-build` again, rebuild, run all 19 cases: 17 pass, 0 fail, 2 pending. |
