# Node.js standards

Owner: Engineering standards · used for generators, agents, the app and the verification harness.

## Structure

- One script, one job; a usage comment at the top saying what it reads, what it writes and how to run it.
- Paths come from `src/paths.js` only. No string-built paths such as `'output'` or `'target'`.
- Pure functions for transformation (blueprint in, text out); file and network I/O at the edges.
- CommonJS, Node 22+, no build step. Dependencies declared in the nearest `package.json` with a lockfile.

## Errors

- Throw with a message that names the fix (`re-run emit-postgres`), not just the symptom.
- Optional external calls (org queries an edition may not support) are caught and recorded as "unavailable";
  required ones stop the run.
- Exit non-zero on failure so CI and the agent runner notice.

## Async and I/O

- `async`/`await` throughout; no unhandled promise rejections (`main().catch(...)`).
- Synchronous file I/O is fine in build-time scripts; never in the app's request path.
- Database access through a pool; one transaction per request; set the role per request.

## Configuration and secrets

- Configuration from environment variables with safe defaults; secrets never in code, logs or outputs.
- Salesforce access through the Salesforce CLI's own auth (`@salesforce/core`); no stored tokens.

## Output

- Deterministic: sort keys and listings, no timestamps in artifacts, stable JSON formatting (`JSON.stringify(x, null, 2)`).
- Generated files start with an Owner/GENERATED header.

## Quality

- `node --check` passes for every file (enforced in CI); tests with `node:test`.
- Small functions, early returns, meaningful names; comments explain why, not what.
