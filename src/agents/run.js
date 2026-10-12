#!/usr/bin/env node
// Runs the migration workflow (src/agents/workflow.json): six transformation phases, a review gate after each.
// Each agent is a folder under agents/ with agent.json (spec) and index.js (run).
//
//   node agents/run.js                       design -> go-live, asks for approval at every gate
//   node agents/run.js --from discover       include extraction (needs `sf org login web --alias myorg`)
//   node agents/run.js --to validate         stop after a phase
//   node agents/run.js --yes                 approve every gate automatically (CI)
//   node agents/run.js --dry-run             LLM agents save their prompts but do not call the model
//   node agents/run.js --list                print the agents and what they do
//
// LLM agents (Logic, Repair) call a language model with the key in LLM_API_KEY (see agents/lib/llm.js);
// with no credentials they fall back to a dry run. Every run writes agents/runs/<run-id>/run.json with each
// agent's result and each reviewer decision, plus the prompts and responses of the LLM agents.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = require('../paths').ROOT;
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));
const WORK = path.join(ROOT, wf.workdir);
const agent = (id) => require(path.join(__dirname, id));

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);
const ids = wf.phases.map((s) => s.id);

if (flag('--list')) {
  for (const s of wf.phases) {
    console.log(`${s.gate}  ${s.title}`);
    for (const id of [...s.agents, ...(s.on_failure ? [s.on_failure] : [])]) {
      const a = agent(id).spec;
      console.log(`    ${a.name} (${a.kind}${a.runs ? `, ${a.runs}` : ''}): ${a.role}`);
    }
    if (s.pipeline) console.log(`    CI/CD pipeline: ${s.pipeline}`);
  }
  process.exit(0);
}

const from = opt('--from', 'design');
const to = opt('--to', 'go-live');
const family = opt('--family', 'Subscription__c,Subscription_Line__c').split(',');
const autoApprove = flag('--yes');
const live = !flag('--dry-run') && require('./lib/llm').hasCredentials();
if (!ids.includes(from) || !ids.includes(to)) { console.error(`phases are: ${ids.join(', ')}`); process.exit(2); }

const reviewer = process.env.REVIEWER || os.userInfo().username;
const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const runDir = path.join(__dirname, 'runs', runId);
fs.mkdirSync(runDir, { recursive: true });
const record = { runId, workflow: wf.name, started: new Date().toISOString(), reviewer, family, llm: live ? 'live' : 'dry-run', stages: [] };
const save = () => fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(record, null, 2));
const log = (msg) => console.log(`  ${msg}`);

// ---------------------------------------------------------------- helpers
// opts.env adds variables for this command only; opts.quiet hides its output (for checks).
function sh(cmd, opts = {}) {
  const env = { ...process.env, ...opts.env, Path: `${path.join(ROOT, 'tools', 'node')}${path.delimiter}${process.env.Path || process.env.PATH || ''}` };
  return spawnSync(cmd, { cwd: WORK, shell: true, stdio: opts.quiet ? 'ignore' : 'inherit', env }).status ?? 1;
}
const ctx = { root: ROOT, workdir: WORK, runDir, family, live, log, sh };

let rl = null;
const question = (q) => { rl ??= readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise((r) => rl.question(q, r)); };

async function gate(stage, summary) {
  const g = { gate: stage.gate, stage: stage.id, summary, by: reviewer, at: null, decision: null, comment: null };
  if (autoApprove) return Object.assign(g, { decision: 'approved', by: 'auto (--yes)', at: new Date().toISOString() });
  console.log(`\n◆ Review gate ${stage.gate} · ${stage.title}: ${summary}`);
  console.log(`  Outputs and logs: ${path.relative(ROOT, runDir)}`);
  for (;;) {
    const a = (await question('  [a]pprove, [r]eject with a comment, or [q]uit: ')).trim().toLowerCase();
    if (a === 'a') { g.decision = 'approved'; break; }
    if (a === 'r') { g.decision = 'changes requested'; g.comment = await question('  Comment for the agent: '); break; }
    if (a === 'q') { g.decision = 'stopped'; break; }
  }
  g.at = new Date().toISOString();
  return g;
}

// Guardrail: an agent may change files only inside its own outputDir (guardrails/guardrails.json).
const GUARD = JSON.parse(fs.readFileSync(path.join(ROOT, 'guardrails', 'guardrails.json'), 'utf8'));
const changed = () => new Set(spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT }).stdout.toString().split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '')));
const ALWAYS_ALLOWED = [/^adlc\/README\.md$/, /\/README\.md$/, /^src\/console\/org-compiler\.html$/, /^src\/agents\/runs\//, /^adlc\/5-validate\/verification\/report\./];

async function runAgent(id, stageRec) {
  const a = agent(id);
  console.log(`\n▶ ${a.spec.name}`);
  const r = { agent: id, name: a.spec.name, kind: a.spec.kind, started: new Date().toISOString(), outputs: a.spec.outputs };
  try {
    const before = changed();
    Object.assign(r, await a.run(ctx));
    const scope = a.spec.outputDir;
    const shared = id === 'modelling' ? [/^adlc\/2-design\//] : id === 'schema' || id === 'logic' || id === 'security' ? [/^adlc\/3-build\/manifest\.json$/] : id === 'verification' ? [/^evals\//] : [];
    const outside = [...changed()].filter((f) => !before.has(f) && scope && !f.startsWith(scope + '/') && !ALWAYS_ALLOWED.some((re) => re.test(f)) && !shared.some((re) => re.test(f)));
    if (outside.length) { r.status = 'failed'; r.summary = `guardrail: wrote outside ${scope}: ${outside.slice(0, 5).join(', ')}`; }
    r.writeScope = { outputDir: scope, outside };
  } catch (e) {
    Object.assign(r, { status: 'failed', summary: e.message });
  }
  r.ended = new Date().toISOString();
  log(`${r.status}: ${r.summary}`);
  stageRec.agents.push(r);
  save();
  return r;
}

// ---------------------------------------------------------------- main
(async () => {
  console.log(`Run ${runId} · ${wf.name} · phases ${from} → ${to} · reviewer ${reviewer} · LLM agents ${live ? 'live' : 'dry run'}`);
  const active = wf.phases.slice(ids.indexOf(from), ids.indexOf(to) + 1);

  for (const stage of active) {
    console.log(`\n━━ ${stage.title} (${stage.gate}) ━━`);
    const stageRec = { stage: stage.id, title: stage.title, agents: [], gates: [] };
    record.stages.push(stageRec);
    if (stage.pipeline) {
      log(`${stage.note} (${stage.pipeline})`);
      stageRec.pipeline = stage.pipeline;
    }

    for (let attempt = 1; attempt <= GUARD.agents.maxRepairAttempts; attempt++) {
      for (const id of stage.agents) await runAgent(id, stageRec);
      let failed = stageRec.agents.filter((a) => a.status === 'failed');

      // On failure, the stage's repair agent proposes a generator patch; a reviewer decides.
      if (stage.on_failure && failed.length) {
        const rr = await runAgent(stage.on_failure, stageRec);
        const patch = rr.details?.patch;
        if (patch) {
          const g = await gate(stage, `approve the ${rr.name}'s patch? ${rr.summary}`);
          stageRec.gates.push(g); save();
          if (g.decision === 'approved' && spawnSync('git', ['apply', patch], { cwd: ROOT, stdio: 'inherit' }).status === 0) {
            log('patch applied; regenerating and re-verifying');
            if (sh(`node src/generators/emit-postgres.js ${family.join(',')}`) === 0) { stageRec.agents.length = 0; continue; }
          }
        }
        failed = stageRec.agents.filter((a) => a.status === 'failed');
      }

      const summary = failed.length
        ? `${failed.length} agent(s) failed: ${failed.map((a) => a.name).join(', ')}`
        : stageRec.agents.map((a) => `${a.name}: ${a.summary}`).join(' · ') || stage.note || 'no agents';
      const g = await gate(stage, summary);
      stageRec.gates.push(g); save();
      if (g.decision === 'approved' && !failed.length) break;
      if (g.decision === 'stopped' || failed.length) { record.status = `stopped at ${stage.gate}`; save(); rl?.close(); process.exit(1); }
      log(`re-running ${stage.title} (attempt ${attempt + 1}) with reviewer comment: ${g.comment}`);
      stageRec.agents.length = 0;
      if (attempt === GUARD.agents.maxRepairAttempts) { record.status = `stopped: ${stage.title} not approved after ${attempt} attempts`; save(); process.exit(1); }
    }
  }

  record.status = 'completed';
  record.ended = new Date().toISOString();
  save();
  rl?.close();
  console.log(`\nRun ${runId} completed. Record: ${path.relative(ROOT, path.join(runDir, 'run.json'))}`);
})().catch((e) => { console.error(e); record.status = `error: ${e.message}`; save(); process.exit(1); });
