#!/usr/bin/env node
/**
 * chain-control — the shared registry for headless sessions (chain-control@1, framework/core/chain-control.mjs). The
 * console API, MCP, both plugins' controls and the launcher all come through here.
 *
 *   node framework/cli/chain-control.mjs state [--build b] [--step s] [--model m]    everything the controls show
 *   … get [key] [--build b] [--step s]              the config that applies (or one dotted key)
 *   … set k=v… [--build b] [--step s] [--by who]    change the global config or an override (or {patch} JSON on stdin)
 *   … clear --build b [--step s]                    drop an override
 *   … file <path> always|demand|never [--build b] [--step s]
 *   … order <path,path,…> [--build b] [--step s]    reorder the chain
 *   … preset list | apply <id> | save "<name>" | delete <id>
 *   … reset                                         back to the Lean preset, overrides gone
 *   … history [--limit n]  ·  restore <rev>  ·  events --since <rev>
 *   … chain                                         the files in load order with size and tokens
 *   … read <path>  ·  write <path>  ({content, if_version} on stdin)   a chain file, conflict-safe
 *   … preview [--build b] [--step s] [--model m]    tokens and cost of what a launch would send
 *   … suggest <build>                               the model the rules suggest for each open step
 *   … compare --before k=v[,k=v] --after k=v[,k=v]  token log totals, per turn and per step, side by side
 *   … plan --brief f --dir d [--build b] [--prev s] [--model m] [--name n] [--agent a]     what the launcher runs next
 *
 * Add --json for one JSON line. Store: /projects/_shared/_data/claude/chain-control.json on the hub, with its history next
 * to it (AXF_CHAIN_CONTROL_FILE elsewhere); framework/schemas/chain-control.json applies until it exists. A write takes a
 * short lock, bumps `rev` and appends a change event, so every reader sees the same order. Exit: 0 ok · 1 failed · 2 usage.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cc from '../core/chain-control.mjs';
import { memoryChain, readText } from '../core/memory-chain.mjs';
import { modelId, modelRank, coerceModel } from '../core/model-policy.mjs';
import { compose, launchContext } from '../core/rules-brief.mjs';
import { costUsd, loadPricing } from './model-pricing.mjs';
import { load as loadBriefs } from './rules-brief.mjs';
import { progressFile, readProgress } from './build-progress.mjs';
import { readRecords } from './token-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '..', '..'));
const SEED = join(HERE, '..', 'schemas', 'chain-control.json');
const HISTORY_MAX = 200;
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
class Fail extends Error { constructor(code, message, exit = 1) { super(message); this.code = code; this.exit = exit; } }

export function storeFile() {
  if (process.env.AXF_CHAIN_CONTROL_FILE) return process.env.AXF_CHAIN_CONTROL_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  return existsSync(projects) ? join(projects, '_shared', '_data', 'claude', 'chain-control.json') : join(ROOT, '.axf-console', 'chain-control', 'chain-control.json');
}
const historyFile = () => storeFile().replace(/\.json$/, '-history.jsonl');
const blobDir = () => storeFile().replace(/\.json$/, '-files');
export const load = () => cc.normDoc(readJson(storeFile()), readJson(SEED));

function locked(fn) {
  const lock = `${storeFile()}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  for (let i = 0; ; i += 1) {
    try { mkdirSync(lock); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 10000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { /* it just went */ }
      if (i > 200) throw new Fail('busy', 'the chain control store is locked');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
const readHistory = () => { try { return readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };
function record(entry) {
  appendFileSync(historyFile(), `${JSON.stringify(entry)}\n`);
  const lines = readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean);
  if (lines.length > HISTORY_MAX * 1.5) { const tmp = `${historyFile()}.tmp-${process.pid}`; writeFileSync(tmp, `${lines.slice(-HISTORY_MAX).join('\n')}\n`); renameSync(tmp, historyFile()); }
}
const snapshot = (d) => ({ preset: d.preset, config: d.config, overrides: d.overrides, presets: Object.fromEntries(Object.entries(d.presets).filter(([, p]) => !p.builtin)) });
/** One write: read the current doc, change it, bump rev, log the event. `change` returns the new doc or null (nothing to do). */
export function write(what, by, change) {
  return locked(() => {
    const cur = load();
    const next = change(cur);
    if (!next) return cur;
    const rev = cur.rev + 1; const at = new Date().toISOString(); const who = String(by || process.env.AXF_SESSION || 'cli').slice(0, 80);
    const out = { ...next, rev, updatedAt: at, updatedBy: who };
    const file = storeFile(); const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ ...out, presets: snapshot(out).presets }, null, 1)}\n`);
    renameSync(tmp, file);
    record({ rev, at, by: who, kind: 'config', what, doc: snapshot(out) });
    return out;
  });
}

/* ---------------- the chain on disk ---------------- */

const home = () => process.env.AXF_CHAIN_HOME || homedir();
const abs = (p) => (p.startsWith('~/') ? join(home(), p.slice(2)) : isAbsolute(p) ? p : join(ROOT, p));
const rel = (p) => { const r = relative(ROOT, p); return r && !r.startsWith('..') ? r : p.startsWith(`${home()}/`) ? `~/${relative(home(), p)}` : p; };
export function foundChain() {
  return memoryChain(ROOT, { home: home() }).map((m) => ({ path: rel(m.path), via: m.via, depth: m.depth, parent: m.parent ? rel(m.parent) : '', chars: (readText(m.path) ?? '').length }));
}
const readFile = (p) => readText(abs(p));
/** Rows for a config: load order, sizes filled in for files the config added. */
function rowsFor(config) {
  return cc.chainRows(foundChain(), config).map((r) => { if (!r.missing) return r; const t = readFile(r.path); return t == null ? r : { ...r, missing: false, chars: t.length, tokens: Math.ceil(t.length / 4) }; });
}
const versionOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/* ---------------- builds ---------------- */

const buildOf = (id) => (id ? readJson(join(process.cwd(), '_claude', 'builds', 'store.json')) ?? readJson(join(ROOT, '_claude', 'builds', 'store.json')) : null)?.builds?.find((b) => b.id === id) ?? null;
const progressOf = (id) => { try { return existsSync(progressFile(id)) ? readProgress(id) : null; } catch { return null; } };
/** Builds with work left, for the pickers; only the picked one carries its steps. */
const openBuilds = (picked) => (readJson(join(ROOT, '_claude', 'builds', 'store.json'))?.builds ?? []).filter((b) => b.id === picked || (!b.deleted && !b.hidden && !['complete', 'archived'].includes(b.status) && (b.steps ?? []).some((s) => !s.done && !s.skip))).map((b) => ({ id: b.id, title: b.title || b.id, steps: b.id === picked ? b.steps.map((s) => ({ id: s.id, text: String(s.text ?? '').slice(0, 80), done: !!s.done })) : [] }));

function briefFor(task, ctx = {}) {
  const docs = loadBriefs();
  if (!docs.lean) return { text: '', chars: 0, tokens: 0, off: true };
  return compose(docs, launchContext({ task, ...ctx }), (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } });
}

/** Tokens and cost of a launch under the config that applies. */
export function preview({ build = '', step = '', model = 'opus' } = {}) {
  const doc = load();
  const { config, sources } = cc.resolve(doc, { build, step });
  const rows = rowsFor(config);
  const b = build ? buildOf(build) : null;
  const open = b ? cc.openSteps(b, progressOf(build)) : [];
  const stepRec = b?.steps?.find((s) => s.id === step) ?? open[0] ?? null;
  const brief = briefFor(stepRec?.text ?? '', { build, model });
  const plan = cc.loadPlan(rows, config, brief.text, readFile);
  const steps = open.length || 1;
  const sessions = config.session.mode === 'per-build' ? 1 : config.session.mode === 'per-step' ? steps : Math.max(1, new Set(open.map((s) => s.model)).size);
  const pricing = loadPricing();
  const price = (m, t) => costUsd(m, t, pricing);
  const cost = cc.costPreview({ tokens: plan.tokens.total + (config.session.mode === 'per-build' ? 0 : Math.ceil(config.session.handoffChars / 4)), fullTokens: plan.tokens.full, model, sessions, steps, price });
  return { config, sources, rows, plan: { ...plan, append: undefined }, cost, briefPicked: brief.picked ?? [], session: { mode: config.session.mode, sessions, steps }, step: stepRec ? { id: stepRec.id, text: stepRec.text ?? '', files: cc.stepFiles(stepRec, config), suggestion: cc.suggestModel(stepRec, config) } : null };
}

export function state(opts = {}) {
  const doc = load();
  return { rev: doc.rev, preset: doc.preset, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, store: storeFile(), live: storeFile().startsWith(process.env.AXHUB_PROJECTS_DIR || '/projects'), global: doc.config,
    presets: Object.values(doc.presets).map(({ config, ...p }) => p), overrides: { builds: Object.keys(doc.overrides.builds), steps: Object.keys(doc.overrides.steps) },
    override: opts.build ? (opts.step ? doc.overrides.steps[cc.stepKey(opts.build, opts.step)] : doc.overrides.builds[opts.build]) ?? {} : null,
    builds: openBuilds(opts.build), suggestions: opts.build && buildOf(opts.build) ? cc.suggestions(buildOf(opts.build), cc.resolve(doc, { build: opts.build }).config) : [], history: history(30), options: { fileModes: cc.FILE_MODES, sessionModes: cc.SESSION_MODES, scopeModes: cc.SCOPE_MODES }, ...preview(opts) };
}
export const history = (limit = 50) => readHistory().slice(-limit).reverse().map(({ doc, ...e }) => e);

/** The model the rules suggest for each open step of a build. */
export function suggestFor(id) {
  const b = buildOf(id);
  if (!b) throw new Fail('not_found', `no build ${id}`);
  return cc.suggestions(b, cc.resolve(load(), { build: id }).config);
}

/* ---------------- what the launcher runs next ---------------- */

const SAFE = /^[A-Za-z0-9._:/-]*$/;
/** Writes append.md / prompt.md into dir and returns one flat object of plain values for the shell. */
export function plan({ build = '', brief = '', dir, prev = '', model = '', name = '', agent = '' }) {
  const doc = load();
  const task = (() => { try { return readFileSync(brief, 'utf8'); } catch { return ''; } })();
  const b = build ? buildOf(build) : null;
  const progress = b ? progressOf(build) : null;
  const first = cc.resolve(doc, { build }).config;
  const open = b ? cc.openSteps(b, progress) : [];
  const stepped = !!b && first.session.mode !== 'per-build' && (open.length > 0 || !!prev);
  const out = { cc_mode: stepped ? 'step' : 'single', cc_step: '', cc_steps: '', cc_native: 0, cc_model: '', cc_stop: 0, cc_bash: 0, cc_mcp: 0, cc_read: 0, cc_warn: 0, cc_halt: 0, cc_tokens: 0 };
  const stop = (why) => { writeFileSync(join(dir, 'stop.txt'), why); return { ...out, cc_stop: 1 }; };
  if (stepped) {
    if (prev && open.some((s) => s.id === prev.split(',')[0])) return stop(`step ${prev.split(',')[0]} did not finish: the session ended with it open`);
    if (!open.length) return { ...out, cc_stop: 2 };
  }
  const batch = stepped ? cc.nextBatch(open, first.session.mode) : [];
  const { config } = cc.resolve(doc, { build, step: batch[0]?.id ?? '' });
  if (batch.length) {
    const want = coerceModel(batch[0].model);
    if (model && modelRank(want) > modelRank(model)) return stop(`step ${batch[0].id} is pinned to ${want}, above this run's model: start it on ${want}`);
    if (model && modelRank(want) < modelRank(model)) out.cc_model = modelId(want);
    const note = cc.handoff(b, progress, config.session.handoffChars);
    writeFileSync(join(dir, 'prompt.md'), cc.stepPrompt({ build: b, batch, brief: task, note, config, total: b.steps.length }));
    out.cc_step = batch[0].id; out.cc_steps = batch.map((s) => s.id).join(',');
  }
  const composed = briefFor(batch.length ? batch.map((s) => s.text).join('\n') + task.slice(0, 2000) : task, { build, model, agent, surface: process.env.AXF_SURFACE || 'headless', job: process.env.AXF_AGENT_JOB || '', profile: process.env.AXF_BUILD_PROFILE || '' });
  const rows = rowsFor(config);
  const load_ = cc.loadPlan(rows, config, composed.text, readFile);
  // no rules at all would reach the run: Claude Code loads its own chain, as before. Never rules-free.
  const empty = !load_.native && !load_.sent.length && !(config.chain.brief && composed.text);
  if (load_.native || empty) out.cc_native = 1;
  else writeFileSync(join(dir, 'append.md'), load_.append);
  const env = cc.outputEnv(config);
  out.cc_bash = env.BASH_MAX_OUTPUT_LENGTH ?? 0; out.cc_mcp = env.MAX_MCP_OUTPUT_TOKENS ?? 0; out.cc_read = env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS ?? 0;
  out.cc_warn = config.budget.warnTokens; out.cc_halt = config.budget.stopTokens; out.cc_tokens = load_.tokens.total;
  return out;
}

/* ---------------- savings ---------------- */

const filterOf = (s) => Object.fromEntries(String(s ?? '').split(',').filter(Boolean).map((kv) => kv.split('=')));
function totals(filter) {
  const rec = readRecords({ from: '2020-01-01' }).filter((r) => Object.entries(filter).every(([k, v]) => String(r[k] ?? '') === v));
  const t = { turns: rec.length, sessions: new Set(rec.map((r) => r.session)).size, steps: new Set(rec.map((r) => `${r.build}/${r.step}`)).size, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, rulesReads: 0 };
  for (const r of rec) { for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) t[k] += r[k] || 0; t.costUsd += r.costUsd || 0; if (r.rulesRead || r.rules?.length) t.rulesReads += 1; }
  t.costUsd = Math.round(t.costUsd * 10000) / 10000;
  t.startPerSession = t.sessions ? Math.round(t.cacheWrite / t.sessions) : 0;
  t.costPerTurn = t.turns ? Math.round((t.costUsd / t.turns) * 10000) / 10000 : 0;
  return t;
}
export function compare(before, after) {
  const a = totals(filterOf(before)); const b = totals(filterOf(after));
  const pct = (x, y) => (x ? Math.round(((x - y) / x) * 100) : null);
  return { before: a, after: b, saved: { costPerTurnPct: pct(a.costPerTurn, b.costPerTurn), startPerSessionPct: pct(a.startPerSession, b.startPerSession) } };
}

/* ---------------- CLI ---------------- */

const parseValue = (v) => { try { return JSON.parse(v); } catch { return v; } };
const patchOf = (pairs) => {
  const patch = {};
  for (const kv of pairs) {
    const i = kv.indexOf('='); if (i < 1) throw new Fail('usage', `not key=value: ${kv}`, 2);
    const keys = kv.slice(0, i).split('.'); let o = patch;
    keys.slice(0, -1).forEach((k) => { o = (o[k] ??= {}); });
    o[keys[keys.length - 1]] = parseValue(kv.slice(i + 1));
  }
  return patch;
};
const dig = (o, key) => key.split('.').reduce((a, k) => a?.[k], o);

function run(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const say = (o, text) => process.stdout.write(json ? `${JSON.stringify({ ok: true, ...o })}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
  const stdin = () => { try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; } };
  const by = flag('--by'); const build = flag('--build') ?? ''; const step = flag('--step') ?? ''; const model = flag('--model') ?? 'opus';
  const scope = { build, step };
  const cmd = args.shift() ?? 'state';
  const line = (d, what) => `${what} (rev ${d.rev})`;
  if (step && !build) throw new Fail('usage', '--step needs --build', 2);
  if (cmd === 'state') say(state({ build, step, model }));
  else if (cmd === 'get') { const { config, sources } = cc.resolve(load(), scope); const v = args[0] ? dig(config, args[0]) : config; if (v === undefined) throw new Fail('not_found', `no setting ${args[0]}`); say({ value: v, sources }, typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)); }
  else if (cmd === 'set') {
    const patch = args.length ? patchOf(args) : stdin().patch;
    if (!patch || !Object.keys(patch).length) throw new Fail('usage', 'set k=v… or {patch} on stdin', 2);
    const d = write(`set ${cc.leaves(patch).join(', ')}${build ? ` on ${step ? `${build}/${step}` : build}` : ''}`, by, (c) => cc.applyPatch(c, patch, scope));
    say({ rev: d.rev, value: cc.resolve(d, scope).config }, line(d, 'saved'));
  } else if (cmd === 'clear') {
    if (!build) throw new Fail('usage', 'clear --build b [--step s]', 2);
    const d = write(`cleared the override on ${step ? `${build}/${step}` : build}`, by, (c) => cc.clearOverride(c, scope));
    say({ rev: d.rev }, line(d, 'cleared'));
  } else if (cmd === 'file') {
    const [path, mode] = args;
    if (!cc.validPath(path) || !cc.FILE_MODES.includes(mode)) throw new Fail('usage', 'file <path> always|demand|never', 2);
    const d = write(`${path} → ${mode}`, by, (c) => cc.applyPatch(c, { chain: { files: [{ path, mode }] } }, scope));
    say({ rev: d.rev }, line(d, `${path} → ${mode}`));
  } else if (cmd === 'order') {
    const order = (args[0] ?? '').split(',').filter(cc.validPath);
    if (!order.length) throw new Fail('usage', 'order <path,path,…>', 2);
    const d = write('reordered the chain', by, (c) => cc.applyPatch(c, { chain: { order } }, scope));
    say({ rev: d.rev }, line(d, 'reordered'));
  } else if (cmd === 'preset') {
    const sub = args.shift() ?? 'list';
    if (sub === 'list') say({ presets: Object.values(load().presets).map(({ config, ...p }) => p), current: load().preset }, Object.values(load().presets).map((p) => `${p.id === load().preset ? '●' : '○'} ${p.id}${p.builtin ? '' : ' (saved)'}: ${p.description || p.name}`).join('\n'));
    else if (sub === 'apply') { const d = write(`preset ${args[0]}`, by, (c) => { const n = cc.applyPreset(c, args[0]); if (!n) throw new Fail('not_found', `no preset ${args[0]}`); return n; }); say({ rev: d.rev }, line(d, `preset ${args[0]}`)); }
    else if (sub === 'save') {
      const name = args.join(' ').trim(); const id = cc.slug(name);
      if (!id) throw new Fail('usage', 'preset save "<name>"', 2);
      const d = write(`saved preset ${name}`, by, (c) => { if (c.presets[id]?.builtin) throw new Fail('invalid', `${name} is a built-in preset`); return { ...c, preset: id, presets: { ...c.presets, [id]: { id, name, description: '', builtin: false, config: c.config } } }; });
      say({ rev: d.rev, id }, line(d, `saved ${id}`));
    } else if (sub === 'delete') {
      const d = write(`deleted preset ${args[0]}`, by, (c) => { const p = c.presets[args[0]]; if (!p) throw new Fail('not_found', `no preset ${args[0]}`); if (p.builtin) throw new Fail('invalid', 'built-in presets stay'); const { [args[0]]: _, ...rest } = c.presets; return { ...c, presets: rest, preset: c.preset === args[0] ? '' : c.preset }; });
      say({ rev: d.rev }, line(d, `deleted ${args[0]}`));
    } else throw new Fail('usage', 'preset list|apply|save|delete', 2);
  } else if (cmd === 'reset') {
    const d = write('reset to defaults', by, (c) => ({ ...cc.applyPreset(c, 'lean'), overrides: { builds: {}, steps: {} } }));
    say({ rev: d.rev }, line(d, 'reset to the Lean preset'));
  } else if (cmd === 'history') say({ history: history(Number(flag('--limit')) || 50) }, history(Number(flag('--limit')) || 50).map((e) => `${e.rev} ${e.at} ${e.by}: ${e.what}`).join('\n'));
  else if (cmd === 'events') { const since = Number(flag('--since')) || 0; const d = load(); say({ rev: d.rev, events: history(HISTORY_MAX).filter((e) => e.rev > since).reverse() }); }
  else if (cmd === 'restore') {
    const rev = Number(args[0]); const e = readHistory().find((x) => x.rev === rev);
    if (!e) throw new Fail('not_found', `no history entry ${args[0]}`);
    if (e.kind === 'file') {
      const blob = join(blobDir(), `${e.version}.md`);
      if (!existsSync(blob)) throw new Fail('not_found', 'that version is gone');
      writeChainFile(e.path, readFileSync(blob, 'utf8'), undefined, by, `restored ${e.path}`);
      say({ rev: load().rev }, `restored ${e.path}`);
    } else {
      const d = write(`restored rev ${rev}`, by, (c) => cc.normDoc({ $axf: cc.FRAME, rev: c.rev, ...e.doc }, readJson(SEED)));
      say({ rev: d.rev }, line(d, `restored rev ${rev}`));
    }
  } else if (cmd === 'chain') { const rows = rowsFor(cc.resolve(load(), scope).config); say({ rows }, rows.map((r) => `${String(r.i + 1).padStart(2)} ${r.mode.padEnd(6)} ${String(r.tokens).padStart(6)} tok  ${r.path}`).join('\n')); }
  else if (cmd === 'read') { const p = args[0]; chainOnly(p); const text = readFile(p); if (text == null) throw new Fail('not_found', `can't read ${p}`); say({ path: p, content: text, version: versionOf(text), tokens: cc.tokensOf(text) }, text); }
  else if (cmd === 'write') { const p = args[0]; chainOnly(p); const b = stdin(); if (typeof b.content !== 'string') throw new Fail('invalid', 'send {content, if_version}'); const r = writeChainFile(p, b.content, b.if_version, by, `edited ${p}`); say(r, `saved ${p}`); }
  else if (cmd === 'preview') { const p = preview({ build, step, model }); say(p, `${p.plan.native ? 'native chain' : 'composed'}: ~${p.plan.tokens.total} tokens (full chain ~${p.plan.tokens.full}), ${p.session.sessions} session(s)${p.cost.priced ? `, ~$${p.cost.perStep} per step, saves ~$${p.cost.saved} on the build` : ''}`); }
  else if (cmd === 'suggest') { const list = suggestFor(args[0]); say({ suggestions: list }, list.map((s) => `${s.step} ${s.differs ? '≠' : '='} ${s.pinned} → ${s.model} (${s.why}) ${s.text.slice(0, 70)}`).join('\n')); }
  else if (cmd === 'compare') { const r = compare(flag('--before'), flag('--after')); say(r); }
  else if (cmd === 'plan') {
    const dir = flag('--dir'); if (!dir) throw new Fail('usage', 'plan --dir d --brief f', 2);
    const o = plan({ build, brief: flag('--brief') ?? '', dir, prev: flag('--prev') ?? '', model: flag('--model') ?? model, name: flag('--name') ?? '', agent: flag('--agent') ?? '' });
    for (const v of Object.values(o)) if (!SAFE.test(String(v))) throw new Fail('invalid', 'unsafe value in the plan');
    process.stdout.write(`${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
  } else throw new Fail('usage', `unknown command ${cmd}`, 2);
}

function chainOnly(p) {
  if (!cc.validPath(p ?? '')) throw new Fail('invalid', 'a chain file path');
  const rows = rowsFor(load().config);
  if (!rows.some((r) => r.path === p)) throw new Fail('denied', `${p} is not in the chain`);
}
function writeChainFile(p, content, ifVersion, by, what) {
  return locked(() => {
    const cur = readFile(p) ?? '';
    const was = versionOf(cur);
    if (typeof ifVersion === 'string' && ifVersion !== was) throw new Fail('conflict', `${p} changed since you opened it`);
    mkdirSync(blobDir(), { recursive: true });
    writeFileSync(join(blobDir(), `${was}.md`), cur);
    const file = abs(p); const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, content); renameSync(tmp, file);
    const doc = load(); const rev = doc.rev + 1; const at = new Date().toISOString(); const who = String(by || process.env.AXF_SESSION || 'cli').slice(0, 80);
    writeFileSync(storeFile(), `${JSON.stringify({ ...doc, rev, updatedAt: at, updatedBy: who, presets: snapshot(doc).presets }, null, 1)}\n`);
    record({ rev, at, by: who, kind: 'file', what, path: p, version: was });
    return { rev, version: versionOf(content), tokens: cc.tokensOf(content) };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json');
  try { run(process.argv.slice(2)); } catch (e) {
    const code = e.code && typeof e.code === 'string' ? e.code : 'failed';
    process.stdout.write(json ? `${JSON.stringify({ ok: false, code, message: e.message })}\n` : '');
    process.stderr.write(`chain-control: ${e.message}\n`);
    process.exit(e.exit ?? 1);
  }
}
