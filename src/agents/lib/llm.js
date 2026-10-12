// Shared language-model client for the Logic and Repair agents. Prompts live in agents/<agent>/prompt.md
// with "## System" and "## Task" sections and {{placeholders}}; every prompt and response is saved under
// the run directory for review.
//
// Configuration: LLM_API_KEY (API key passed to the SDK client; if unset, the SDK's own default
// environment variables are used) and AGENT_MODEL (model id).
const fs = require('fs');
const path = require('path');
const { Anthropic: SdkClient } = require('@anthropic-ai/sdk');

const MODEL = process.env.AGENT_MODEL || 'claude-opus-5-5';

// LLM_API_KEY wins; otherwise the SDK reads its default environment variables.
function newClient() {
  return new SdkClient(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {});
}

// True when an API key or token is configured, so the agents can call the model instead of a dry run.
function hasCredentials() {
  if (process.env.LLM_API_KEY) return true;
  const c = newClient();
  return !!(c.apiKey || c.authToken);
}

function loadPrompt(file, vars) {
  const raw = fs.readFileSync(file, 'utf8');
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`prompt ${path.basename(file)} needs {{${k}}}`);
    return String(vars[k]);
  });
  const system = raw.split(/^## System\s*$/m)[1]?.split(/^## Task\s*$/m)[0]?.trim();
  const task = raw.split(/^## Task\s*$/m)[1]?.trim();
  if (!system || !task) throw new Error(`${file} must have "## System" and "## Task" sections`);
  return { system: fill(system), task: fill(task) };
}

// One request. Streams (long outputs) and returns the final message's text.
async function ask({ system, task, saveAs }) {
  fs.mkdirSync(path.dirname(saveAs), { recursive: true });
  fs.writeFileSync(`${saveAs}.prompt.md`, `# System\n\n${system}\n\n# Task\n\n${task}\n`);
  const client = newClient();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: 'high' },
    // If a safety classifier declines, the API re-runs the request on a fallback model it picks.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: task }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`model declined the request (${msg.stop_details?.category ?? 'no category'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('response hit max_tokens; output is incomplete');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  fs.writeFileSync(`${saveAs}.response.md`, `<!-- model: ${msg.model}; input tokens ${msg.usage.input_tokens}; output tokens ${msg.usage.output_tokens} -->\n\n${text}\n`);
  return { text, model: msg.model, usage: msg.usage };
}

// Saves the prompt only, for --dry-run or when no credentials are configured.
function dryRun({ system, task, saveAs }) {
  fs.mkdirSync(path.dirname(saveAs), { recursive: true });
  fs.writeFileSync(`${saveAs}.prompt.md`, `# System\n\n${system}\n\n# Task\n\n${task}\n`);
}

function fenced(text, lang) {
  const m = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```').exec(text);
  return m ? m[1].trim() : null;
}

module.exports = { MODEL, hasCredentials, loadPrompt, ask, dryRun, fenced };
