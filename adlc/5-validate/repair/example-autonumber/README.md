# Repair example: auto-numbers and permission sets

Owner: Repair agent · recorded example, reproduced on 2026-10-08

This is the failure the Org Compiler console walks through in the Validate phase. The fix is in the generator today
(since the first commit). To show it for real, we removed the fix in a throwaway copy of the repository, generated
the SQL again and ran the verification agent. The files here are the actual outputs of that run.

| File | What it is |
|---|---|
| `failing-run.txt` | Console output of `src/verification/run.js` with the fix removed: 16 pass, 1 fail, 2 pending |
| `parity-report-failing.md` | The parity report that run wrote |
| `diagnosis.md` | Root cause and fix, in the form the Repair agent proposes |
| `emit-postgres.js.patch` | The fix: a change to the generator, not to the generated SQL |

With the patch applied (the code as it is in `main`), the same run gives 17 pass, 0 fail, 2 pending; see
`adlc/5-validate/verification/report.md`.

When verification fails in a live run, the Repair agent writes its own proposal next to this folder as
`latest-proposal.md` and `latest-proposal.patch`, and a reviewer approves it before anything changes.

## Reproduce it

1. In a scratch copy, remove `SECURITY DEFINER SET search_path = ${S}, pg_temp` from `next_autonumber` in
   `src/generators/emit-postgres.js`.
2. `node src/generators/emit-postgres.js`, then `node run.js` in `src/verification`.
