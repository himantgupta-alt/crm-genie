# Review checklists

Owner: Engineering standards · what a reviewer checks at each gate. Agent-specific checks are in each agent's
spec (`reviewer_checks`) and README; these apply to every gate.

## Every gate

- [ ] Outputs are in the agent's own folder and nothing else changed (the runner enforces this; confirm the report).
- [ ] Every new or changed file has its Owner/GENERATED header.
- [ ] No secrets, no unmasked personal data (CI scans; spot-check new files).
- [ ] Counts and summaries make sense against the previous run.

## G1 Discover (Extraction)

- [ ] Object, metadata and row counts look complete; refused items are expected (system tables, managed folders).
- [ ] Gap register: every item has a route and an owner.

## G2 Design (Modelling)

- [ ] Blueprint validates; warnings understood.
- [ ] Each strategy choice matches an ADR; new choices have a new ADR.
- [ ] Business process diagrams match how the business describes the process.
- [ ] Traceability matrix covers every element in scope.

## G3 Build (Schema, Logic, Security)

- [ ] SQL follows `kb/postgres-standards.md`; migrations numbered and in the owner's folder.
- [ ] Each Apex translation compared with its source; blocked methods have a reason.
- [ ] Read-only fields have no UPDATE grant; sharing mirrors the org.
- [ ] Generated code follows `kb/secure-coding.md`.

## G4 Migrate (Data load)

- [ ] Row counts per object match the export; rejected rows explained.
- [ ] Roll-ups recomputed; auto-number counters resynced.

## G5 Validate (Verification, Repair)

- [ ] Parity report: every value matches; failing cases routed to Repair; pending cases listed.
- [ ] A repair patch changes the generator only, widens no grant, and comes with the case that proves it.

## G6 Go-live

- [ ] CI green on every step; health check passes; cutover checklist (credentials, jobs, history) signed off.
