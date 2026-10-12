# Secure coding

Owner: Engineering standards · OWASP Top 10 (2021) mapped to this stack. Applies to code we write and code agents generate.

| Risk | What it means here | Our rule |
|---|---|---|
| A01 Broken access control | A user reads or edits data Salesforce would not allow | Access is enforced in PostgreSQL: one role per profile/permission set, column grants, row-level security. The app sets the role per request (`SET LOCAL ROLE`); it never filters in JavaScript alone. Security parity cases must pass. |
| A02 Cryptographic failures | Secrets or personal data exposed in transit or at rest | TLS to the database and app; secrets only in the environment, Key Vault or git-ignored `.secrets/`; passwords hashed with scrypt; encrypted fields re-encrypted with client-held keys. |
| A03 Injection | SQL built from strings | Parameterised queries only (`$1`, `$2`). Identifiers in generated SQL come from the blueprint vocabulary, never from user input. Org text in prompts is treated as data. |
| A04 Insecure design | Behaviour that is unsafe by construction | Threats and decisions recorded in ADRs; guardrails bound what agents may do. |
| A05 Security misconfiguration | Defaults left open | Infrastructure as code (`main.bicep`), reviewed; HttpOnly, Secure cookies; firewall rules scoped to known IPs. |
| A06 Vulnerable components | Outdated dependencies | Lockfiles committed; `npm ci` in CI; dependencies kept minimal and declared (no borrowing from globally installed tools in CI). |
| A07 Identification and authentication failures | Weak sign-in | Single sign-on where available; otherwise rate-limited sign-in with signed sessions. Users move to SSO at go-live. |
| A08 Software and data integrity failures | Unreviewed code reaches production | Every generated change passes a review gate and CI; the blueprint and SQL are regenerated and must match git. |
| A09 Logging and monitoring failures | No trace of who did what | Every agent run and gate decision is recorded; logs never contain passwords, tokens or full personal data. |
| A10 Server-side request forgery | The server fetches attacker-chosen URLs | The app makes no outbound calls from user input; integrations use named, reviewed endpoints only. |

## Secrets and personal data

- Never commit secrets. CI scans for private keys, cloud keys, API tokens and inline passwords (`guardrails/guardrails.json`).
- Personal data stays out of shared outputs: user lists are git-ignored; versioned outputs mask usernames to first letter and org domain.
- The source org's own metadata and the data export are the only places real names may appear; both are reviewed before sharing.

## Generated code

- Generated SQL and services follow the same rules as hand-written code; reviewers apply this page at the gate.
- Model-drafted code (Logic and Repair agent proposals) is marked for review and cannot merge without approval.
