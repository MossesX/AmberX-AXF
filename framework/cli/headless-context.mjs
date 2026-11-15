#!/usr/bin/env node
/**
 * headless-context — the brief-only launch of a headless Claude Code run (headless-context@1, framework/core/headless-
 * context.mjs; build brief-only-headless, Nov 8 2026). deploy/claude-headless.sh asks it for the plan of each run.
 *
 *   node framework/cli/headless-context.mjs plan --brief <file> --out <dir> [--session s]   launch plan, one item a line:
 *        `env K=V` · `arg <value>` (an empty value is an empty argument) · `line <log line>` · `warn <text>` · `mcp <id>`
 *        writes <dir>/<session>.settings.json (lean hooks) and <dir>/<session>.mcp.json (only when the job needs MCP)
 *        and <dir>/<session>.rules.md (`rules <file>`: the rules block the launcher appends when the brief has none)
 *   … show [--brief <file>] [--json]               what a run would load, in plain words
 *   … budget --brief <file> [--json]               the brief's size (with its rules block) against the budget (exit 0 always)
 *   … compose --brief <file> [--model m] [--agent a] [--name n] [--json]
 *        the brief's rules block: the rules brief (rules-briefs@1, framework/cli/rules-brief.mjs) plus every rule bullet
 *        whose tag (`<!-- axf-plugin:x -->`) the brief names. Empty when the brief already has "## Rules for this job".
 *   … measure [--profile brief|full] [--cwd d] [--model m] [--prompt "…" | --brief <file>] [--first-only] [--json]
 *        one real `claude -p` run: what loaded (init) and its start tokens and cost; costs a few cents.
 *        --first-only stops it after the first request (a real build brief, measured without doing the build)
 *   … runs [--build <id>] [--json]                 headless runs on this host with start tokens and cost (meters)
 *   … summary --meter <file> [--json]              the end-of-run line the launcher puts on the build's notes
 *
 * Settings: Claude settings group "Headless sessions" (`headless.*`) in the settings document on axHub
 * (/projects/_shared/_data/claude/settings.json, or AXF_CLAUDE_SETTINGS_FILE). AXF_BRIEF_ONLY=off forces the full chain
 * for one launch (tests, a debugging run).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MCP_SERVERS, briefBudget, briefNeeds, briefTools, composeRules, launchPlan, leanSettings, loadedFrom, policyOf, startOf, startWarning } from '../core/headless-context.mjs';
import { compose as composeRulesBrief, launchContext } from '../core/rules-brief.mjs';
import { load as loadRulesBriefs } from './rules-brief.mjs';
import { settingsFile } from './upgrade-policy.mjs';
import { costUsd, loadPricing } from './model-pricing.mjs';

const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const RULE_FILES = ['_claude/shared/rules/RULES.md', '_claude/rules/RULES.md'];
const readJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; } };
const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

/** The `headless.*` Claude settings in force (document on axHub), as a policy. */
export function readPolicy(env = process.env) {
  const values = readJson(settingsFile(env))?.values ?? {};
  const p = policyOf(values);
  if (String(env.AXF_BRIEF_ONLY ?? '').toLowerCase() === 'off') p.briefOnly = false;
  return p;
}

/** Settings files Claude Code would have read for a run in `cwd` (user, project, local). */
export function settingsSources(cwd, env = process.env) {
  const user = join(env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude'), 'settings.json');
  return [user, join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')].map(readJson).filter(Boolean);
}

/** MCP servers whose secrets are in this environment. */
export const mcpAtHand = (env = process.env) => Object.entries(MCP_SERVERS).filter(([, s]) => s.needs.every((k) => env[k])).map(([id]) => id);

/** An MCP config for the given servers: secrets stay ${VAR} placeholders that Claude Code fills from the environment. */
export function mcpConfig(ids, env = process.env) {
  const servers = {};
  if (ids.includes('axhub')) {
    let hub = (env.AXHUB_URL || 'https://axhub.amberxai.com').replace(/\/+$/, '').replace(/\/mcp$/, '');
    servers.axhub = { type: 'http', url: `${hub}/mcp`, headers: { Authorization: 'Bearer ${AXHUB_TOKEN}', ...(env.AXF_SESSION ? { 'X-Axhub-Session': '${AXF_SESSION}' } : {}) } };
  }
  return { mcpServers: servers };
}

/** The rules block for a brief (see composeRules); `ctx` = model / agent / name for the rules-brief conditions. */
export function rulesFor(brief, { model = '', agent = '', name = '', env = process.env } = {}) {
  const readRel = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } };
  let rulesBrief = '';
  try {
    const doc = loadRulesBriefs();
    if (doc.lean) rulesBrief = composeRulesBrief(doc, launchContext({ task: brief, surface: env.AXF_SURFACE || 'headless', model, agent, job: env.AXF_AGENT_JOB || '', build: env.AXF_BUILD_ID || name, profile: env.AXF_BUILD_PROFILE || '' }), readRel).text;
  } catch { rulesBrief = ''; }
  return composeRules({ brief, rulesBrief, ruleTexts: RULE_FILES.map((f) => readRel(f) ?? '') });
}

/** The full plan with its files written. → { plan, files: {settings, mcp}, budget, hooks: {kept, muted, dropped} } */
export function planRun({ brief = '', out = '', session = 'run', cwd = process.cwd(), env = process.env, policy = readPolicy(env) } = {}) {
  const plan = launchPlan(policy, { needs: briefNeeds(brief), tools: briefTools(brief), have: mcpAtHand(env) });
  const rules = plan.briefOnly ? rulesFor(brief, { model: env.AXF_MODEL || '', agent: env.AXF_AGENT || '', name: session.replace(/^axf-/, ''), env }) : { text: '', chars: 0, tags: [], snippets: 0 };
  const budget = briefBudget(rules.text ? `${brief}\n\n${rules.text}` : brief, policy);
  const lean = leanSettings(settingsSources(cwd, env), policy.hooks);
  const files = { settings: '', mcp: '', rules: '' };
  if (out) {
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const base = join(out, session.replace(/[^A-Za-z0-9._-]/g, '-'));
    if (plan.briefOnly) { files.settings = `${base}.settings.json`; writeFileSync(files.settings, `${JSON.stringify(lean.settings, null, 1)}\n`, { mode: 0o600 }); }
    if (rules.text) { files.rules = `${base}.rules.md`; writeFileSync(files.rules, `${rules.text}\n`, { mode: 0o600 }); }
    if (plan.mcp.length) { files.mcp = `${base}.mcp.json`; writeFileSync(files.mcp, `${JSON.stringify(mcpConfig(plan.mcp, env))}\n`, { mode: 0o600 }); }
  }
  plan.args = plan.args.map((a) => (a === '{SETTINGS}' ? files.settings || '{}' : a === '{MCP}' ? files.mcp : a));
  return { plan, files, budget, rules: { chars: rules.chars, tags: rules.tags, snippets: rules.snippets }, hooks: { kept: lean.kept, muted: lean.muted, dropped: lean.dropped }, policy };
}

/** The launcher's line protocol (one item a line; values never hold a newline). */
export function planLines(r) {
  const one = (s) => String(s).replace(/[\r\n]+/g, ' ');
  const lines = [];
  for (const [k, v] of Object.entries(r.plan.env)) lines.push(`env ${k}=${one(v)}`);
  for (const a of r.plan.args) lines.push(`arg ${one(a)}`);
  for (const m of r.plan.mcp) lines.push(`mcp ${m}`);
  if (r.files?.rules) lines.push(`rules ${r.files.rules}`);
  lines.push(`line ${one(r.plan.line)}${r.plan.briefOnly ? ` · brief ~${r.budget.tokens} tokens${r.rules?.chars ? ` incl. rules (${r.rules.tags.length ? `tags ${r.rules.tags.join(', ')}` : 'no tags'})` : ''}` : ''}`);
  if (!r.budget.ok) lines.push(`warn ${one(r.budget.warning)}`);
  for (const s of r.plan.skippedMcp) lines.push(`warn MCP ${s.id} asked for but not started: ${s.why}`);
  return lines;
}

/** One real run: init + first request usage + result. Resolves { loaded, start, costUsd, turns, exit }. */
export function measure({ profile = 'brief', cwd = process.cwd(), model = 'opus', prompt = 'Reply with the single word ok.', env = process.env, firstOnly = false } = {}) {
  return new Promise((done) => {
    const runEnv = { ...env };
    let args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'];
    let tmp = '';
    if (profile === 'brief') {
      tmp = join(env.TMPDIR || '/tmp', `axf-hc-measure-${process.pid}`);
      const r = planRun({ brief: prompt, out: tmp, session: 'measure', cwd, env, policy: { ...readPolicy(env), briefOnly: true } });
      Object.assign(runEnv, r.plan.env); args = [...args, ...r.plan.args];
      if (r.files.rules) prompt = `${prompt}\n\n${readText(r.files.rules)}`;   // what the launcher sends
    }
    const ch = spawn('claude', [...args, prompt], { cwd, env: runEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = ''; let init = null; let first = null; let result = null;
    ch.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(l); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') init = ev;
        else if (ev.type === 'assistant' && !first && ev.message?.usage) { first = ev.message.usage; if (firstOnly) ch.kill('SIGTERM'); }
        else if (ev.type === 'result') result = ev;
      }
    });
    ch.on('close', (code) => {
      const start = startOf(first); const m = init?.model || model;
      const c = costUsd(m, { input: start.input, output: 0, cacheRead: start.cacheRead, cacheWrite: start.cacheWrite }, loadPricing());
      done({ profile, cwd, model: m, loaded: loadedFrom(init), start: { ...start, costUsd: c == null ? null : Math.round(c * 10000) / 10000 }, costUsd: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null, exit: code, firstOnly });
    });
  });
}

/** Headless runs on this host (meters in AXF_HEADLESS_DIR), newest first. */
export function runs({ build = '', env = process.env } = {}) {
  const dir = env.AXF_HEADLESS_DIR || env.HDIR || '/var/tmp/axf-headless';
  let files = []; try { files = readdirSync(dir).filter((f) => f.endsWith('.meter.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const m = readJson(join(dir, f)); if (!m || m.$axf !== 'headless-meter@1') continue;
    const id = m.build || '';
    if (build && id !== build && !String(m.name || '').startsWith(build) && !String(m.session || '').includes(build)) continue;
    out.push({ session: m.session, name: m.name, build: id, agent: m.agent, model: m.model, startedAt: m.startedAt, status: m.status, costUsd: m.costUsd, startTokens: m.start?.tokens ?? null, briefOnly: m.context?.briefOnly ?? null, loaded: m.context?.loaded ?? null, warning: m.start?.warning || '' });
  }
  return out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** A build's runs from its notes (the launcher's end-of-run `Headless run …` line): works where the meters can't be read. */
export function parseRunNote(text, at = '') {
  const m = /^Headless run (\S+): (brief only|full chain) · (?:start ([\d.]+)(K?) tokens(?: \(\$([\d.]+)\))?|no start recorded) · cost \$([\d.]+)/.exec(String(text ?? ''));
  if (!m) return null;
  return { session: m[1], briefOnly: m[2] === 'brief only', startTokens: m[3] ? Math.round(Number(m[3]) * (m[4] ? 1000 : 1)) : null, startCostUsd: m[5] ? Number(m[5]) : null, costUsd: Number(m[6]), at, from: 'note' };
}
export function noteRuns(buildId, env = process.env) {
  const f = env.AXF_BUILDS_STORE || join(ROOT, '_claude', 'builds', 'store.json');
  const b = (readJson(f)?.builds ?? []).find((x) => x.id === buildId);
  return (b?.notes ?? []).map((n) => parseRunNote(n.text, n.at)).filter(Boolean).reverse();
}

const kfmt = (n) => (n == null ? '?' : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'show';
  const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; } } }
  const brief = o.brief ? readText(o.brief) : '';
  const say = (obj, text) => console.log(o.json ? JSON.stringify({ ok: true, ...obj }) : text);
  if (cmd === 'plan') {
    try { for (const l of planLines(planRun({ brief, out: o.out || '', session: o.session || 'run' }))) console.log(l); } catch (e) { console.error(`headless-context: ${e.message}`); process.exit(1); }
  } else if (cmd === 'show') {
    const r = planRun({ brief });
    say(r, [r.plan.line, `hooks: ${r.hooks.kept} kept, ${r.hooks.muted} muted (their output never reaches the context), ${r.hooks.dropped} dropped`,
      `env: ${Object.entries(r.plan.env).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`, `args: ${r.plan.args.map((a) => (a === '' ? '""' : a)).join(' ') || 'none'}`,
      `brief: ${r.budget.chars} chars (~${r.budget.tokens} tokens) of ${r.budget.budget}${r.budget.ok ? '' : ' — OVER BUDGET'}`].join('\n'));
  } else if (cmd === 'compose') {
    const r = rulesFor(brief, { model: o.model || '', agent: o.agent || '', name: o.name || '' });
    say(r, r.already ? '(the brief already has its rules block)' : r.text || '(no rules apply)');
  } else if (cmd === 'budget') {
    const b = briefBudget(brief, readPolicy()); say(b, b.ok ? `brief ok: ${b.chars} of ${b.budget} characters (~${b.tokens} tokens)` : `warning: ${b.warning}`);
  } else if (cmd === 'measure') {
    const r = await measure({ profile: o.profile === 'full' ? 'full' : 'brief', cwd: o.cwd ? resolve(o.cwd) : process.cwd(), model: o.model || 'opus', firstOnly: !!o['first-only'], ...(typeof o.prompt === 'string' ? { prompt: o.prompt } : o.brief ? { prompt: brief } : {}) });
    say(r, `${r.profile}: start ${kfmt(r.start.tokens)} tokens (read ${kfmt(r.start.cacheRead)}, write ${kfmt(r.start.cacheWrite)}, new ${r.start.input}) · start cost $${(r.start.costUsd ?? 0).toFixed(4)}${r.costUsd != null ? ` · run cost $${r.costUsd.toFixed(4)}` : ''} · tools ${r.loaded.tools} (MCP ${r.loaded.mcpTools}) · MCP servers ${r.loaded.mcp.join(', ') || 'none'} · skills/commands ${r.loaded.skills + r.loaded.slashCommands}${startWarning(r.start.tokens, readPolicy()) ? ` · ${startWarning(r.start.tokens, readPolicy())}` : ''}`);
  } else if (cmd === 'summary') {
    // one line for the build's notes at the end of a run (deploy/claude-headless.sh): start tokens, cost, what loaded
    const m = o.meter ? readJson(o.meter) : null;
    if (!m || m.$axf !== 'headless-meter@1') process.exit(0);
    const l = m.context?.loaded;
    const parts = [`Headless run ${m.session}: ${m.context?.briefOnly ? 'brief only' : 'full chain'}`,
      m.start ? `start ${kfmt(m.start.tokens)} tokens${typeof m.start.costUsd === 'number' ? ` ($${m.start.costUsd.toFixed(2)})` : ''}` : 'no start recorded',
      `cost $${(Number(m.costUsd) || 0).toFixed(2)}${m.costEstimated ? ' (estimate)' : ''}`, `${m.turns ?? 0} turns`,
      l ? `${l.tools} tools, MCP ${l.mcp.length ? l.mcp.join(', ') : 'none'}` : '', m.start?.warning || ''];
    say({ meter: m }, parts.filter(Boolean).join(' · '));
  } else if (cmd === 'runs') {
    const live = runs({ build: o.build || '' });
    const seen = new Set(live.map((r) => r.session));
    const rs = o.build ? [...live, ...noteRuns(o.build).filter((r) => !seen.has(r.session))] : live;
    say({ build: o.build || '', runs: rs }, rs.length ? rs.map((r) => `${r.session} · ${r.status} · start ${kfmt(r.startTokens)} · $${(r.costUsd ?? 0).toFixed(2)} · ${r.briefOnly === false ? 'full chain' : r.briefOnly ? 'brief only' : '?'}${r.warning ? ` · ${r.warning}` : ''}`).join('\n') : 'no headless runs on this host');
  } else { console.error('usage: headless-context.mjs plan|show|budget|measure|runs (see the header)'); process.exit(2); }
}
