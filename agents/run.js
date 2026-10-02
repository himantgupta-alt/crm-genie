#!/usr/bin/env node
// Runs the migration workflow (agents/workflow.json): six stages, a review gate after each.
//
//   node agents/run.js                       model -> deploy, asks for approval at every gate
//   node agents/run.js --from extract        include extraction (needs `sf org login web --alias myorg`)
//   node agents/run.js --to verify           stop after a stage
//   node agents/run.js --yes                 approve every gate automatically (CI)
//   node agents/run.js --dry-run             LLM agents write their prompts but do not call Claude
//
// LLM agents (Logic, Repair) call Claude with ANTHROPIC_API_KEY or an `ant auth login` profile; with no
// credentials they fall back to a dry run. Every run writes agents/runs/<run-id>/run.json with each
// agent's result and each reviewer decision, plus the prompts and responses of the LLM agents.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));
const WORK = path.join(ROOT, wf.workdir);

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);
const ids = wf.stages.map((s) => s.id);
const from = opt('--from', 'model');
const to = opt('--to', 'deploy');
const family = opt('--family', 'Subscription__c,Subscription_Line__c').split(',');
const autoApprove = flag('--yes');
const hasCreds = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE
  || fs.existsSync(path.join(os.homedir(), '.config', 'anthropic')));
const live = !flag('--dry-run') && hasCreds;
if (!ids.includes(from) || !ids.includes(to)) { console.error(`stages are: ${ids.join(', ')}`); process.exit(2); }

const reviewer = process.env.REVIEWER || os.userInfo().username;
const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const runDir = path.join(__dirname, 'runs', runId);
fs.mkdirSync(runDir, { recursive: true });
const record = { runId, workflow: wf.name, started: new Date().toISOString(), reviewer, family, llm: live ? 'live' : 'dry-run', stages: [] };
const save = () => fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(record, null, 2));
const log = (msg) => console.log(`  ${msg}`);

// ---------------------------------------------------------------- helpers
function sh(cmd) {
  const env = { ...process.env, Path: `${path.join(ROOT, 'tools', 'node')}${path.delimiter}${process.env.Path || process.env.PATH || ''}` };
  const r = spawnSync(cmd, { cwd: WORK, shell: true, stdio: 'inherit', env });
  return r.status ?? 1;
}

let rl = null;
function question(q) {
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, resolve));
}

async function gate(stage, summary) {
  const g = { gate: stage.gate, stage: stage.id, summary, by: reviewer, at: null, decision: null, comment: null };
  if (autoApprove) {
    Object.assign(g, { decision: 'approved', by: 'auto (--yes)', at: new Date().toISOString() });
    return g;
  }
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

async function runAgent(agent, stageRec) {
  const r = { agent: agent.id, name: agent.name, kind: agent.kind, started: new Date().toISOString(), status: 'ok', produces: agent.produces };
  console.log(`\n▶ ${agent.name}`);
  if (agent.kind === 'deterministic') {
    if (agent.id === 'data-load' && !process.env.PGHOST) {
      r.status = 'skipped'; r.reason = 'no target database configured (PGHOST); Verify loads an in-memory PostgreSQL instead';
      log(r.reason);
    }
    for (const step of r.status === 'ok' ? agent.steps : []) {
      log(`$ ${step}`);
      const code = sh(step);
      if (code !== 0) { r.status = 'failed'; r.failedStep = step; r.exitCode = code; break; }
    }
  } else if (agent.kind === 'llm') {
    const mod = require(path.join(__dirname, agent.module));
    try {
      r.result = await mod.run({ root: ROOT, runDir, family, live, log });
    } catch (e) {
      r.status = 'failed'; r.error = e.message;
      log(`error: ${e.message}`);
    }
  } else {
    r.status = 'manual';
    log(agent.note || 'manual step');
  }
  r.ended = new Date().toISOString();
  stageRec.agents.push(r);
  save();
  return r;
}

// ---------------------------------------------------------------- main
(async () => {
  console.log(`Run ${runId} · ${wf.name} · stages ${from} → ${to} · reviewer ${reviewer} · LLM agents ${live ? 'live' : 'dry run'}`);
  const active = wf.stages.slice(ids.indexOf(from), ids.indexOf(to) + 1);

  for (const stage of active) {
    console.log(`\n━━ ${stage.title} (${stage.gate}) ━━`);
    const stageRec = { stage: stage.id, title: stage.title, agents: [], gates: [] };
    record.stages.push(stageRec);

    for (let attempt = 1; attempt <= 3; attempt++) {
      for (const agent of stage.agents.filter((a) => a.runs !== 'on_failure')) await runAgent(agent, stageRec);
      let failed = stageRec.agents.filter((a) => a.status === 'failed');

      // Verify: on failure, the Repair agent proposes a generator patch; a reviewer decides.
      if (stage.id === 'verify' && failed.length) {
        const repair = stage.agents.find((a) => a.runs === 'on_failure');
        const rr = await runAgent(repair, stageRec);
        const proposal = rr.result;
        if (proposal?.patch) {
          console.log(`\n  Root cause: ${proposal.meta?.root_cause ?? '-'}`);
          console.log(`  Proposed patch: ${path.relative(ROOT, proposal.patch)}`);
          const g = await gate(stage, 'approve the Repair agent\'s generator patch?');
          stageRec.gates.push(g); save();
          if (g.decision === 'approved') {
            const applied = spawnSync('git', ['apply', proposal.patch], { cwd: ROOT, stdio: 'inherit' }).status === 0;
            log(applied ? 'patch applied; re-running Build and Verify' : 'patch did not apply cleanly');
            if (applied && sh('node scripts/emit-postgres.js') === 0) { stageRec.agents.length = 0; continue; }
          }
        }
        failed = stageRec.agents.filter((a) => a.status === 'failed');
      }

      const summary = failed.length
        ? `${failed.length} agent(s) failed: ${failed.map((a) => a.name).join(', ')}`
        : `${stageRec.agents.map((a) => `${a.name}: ${a.status}`).join(' · ')}`;
      const g = await gate(stage, summary);
      stageRec.gates.push(g); save();
      if (g.decision === 'approved' && !failed.length) break;
      if (g.decision === 'approved' && failed.length) { record.status = 'stopped: approved with failures is not allowed'; save(); process.exit(1); }
      if (g.decision === 'stopped') { record.status = `stopped at ${stage.gate}`; save(); rl?.close(); process.exit(1); }
      // changes requested: the comment is recorded; re-run the stage
      log(`re-running ${stage.title} (attempt ${attempt + 1}) with reviewer comment: ${g.comment}`);
      stageRec.agents.length = 0;
      if (attempt === 3) { record.status = `stopped: ${stage.title} not approved after 3 attempts`; save(); process.exit(1); }
    }
  }

  record.status = 'completed';
  record.ended = new Date().toISOString();
  save();
  rl?.close();
  console.log(`\nRun ${runId} completed. Record: ${path.relative(ROOT, path.join(runDir, 'run.json'))}`);
  if (active.some((s) => s.id === 'deploy')) console.log('Deploy: commit the approved changes and push to main; .github/workflows/crm-genie.yml re-checks and deploys.');
})().catch((e) => { console.error(e); record.status = `error: ${e.message}`; save(); process.exit(1); });
