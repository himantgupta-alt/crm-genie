# Guardrails

Owner: Engineering standards · generic: they apply to every client and every run. Rules are in
[`guardrails.json`](guardrails.json); the right-hand column says what enforces each one.

| Guardrail | Rule | Enforced by |
|---|---|---|
| Read-only source | Nothing writes to the Salesforce org except the seed scripts in `src/salesforce-seed/` (demo only) | Code review; extraction uses read APIs only |
| Write scope | Each agent may change files only inside its own `outputDir`; anything else fails the step | `src/agents/run.js` (checks `git status` after each agent) |
| Human approval | Every phase stops at a gate; nothing merges or deploys without approval | `src/agents/run.js`, CI on `main` |
| AI output is a proposal | Logic and Repair agent output is marked for review; Repair may change the generator only, after approval | `run.js`, agent specs |
| Bounded repair | At most 3 repair attempts per failure, then escalate to a person | `run.js` (`maxRepairAttempts`) |
| No secrets | No private keys, API keys, tokens or inline passwords in the repository | `check-conventions.js` secret scan (CI); a reviewed line may opt out with `guardrails:allow` (test fixtures only) |
| Personal data | User lists and most org data stay local; versioned outputs mask usernames | `.gitignore`, `check-conventions.js` |
| Prompt safety | Org content sent to the model is data, never instructions; no secrets in prompts | agent prompts, `kb/secure-coding.md` |
| Determinism | Generated outputs must match what is committed | CI regenerate-and-diff steps |
| Provenance | Every generated file names its owner and generator | `check-conventions.js` |
| Release safety | All checks green before deploy; health check after deploy | `.github/workflows/crm-genie.yml` |

Standards the agents follow are in the knowledge base: [`../kb/`](../kb/README.md).
