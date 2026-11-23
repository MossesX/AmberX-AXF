#!/usr/bin/env node
/**
 * model-triage — the VPS side of the model triage gate (model-triage@1, framework/core/model-triage.mjs): the rule
 * store, the measured facts and the decision log. Every lane asks here for its model; the console only shows what this
 * file answers and sends edits to it.
 *
 *   node framework/cli/model-triage.mjs status [--json]                the rules, the defaults and where they are stored
 *   … rule <id> on|off | model <opus|fable> | set <key> <value> | lanes <a,b> | move <place>   edit one rule
 *   … defaults [model <m>] [handRequest floor|pin|ignore] [briefWords on|off]                  the gate's own settings
 *   … gate on|off                                                      the whole gate (off = the default model; overrides still win)
 *   … reset                                                            back to the starting rules
 *   … decide --text "…" [--title t] [--files a,b] [--minutes n] [--lines n] [--lane l] [--kind k] [--requested m] [--json]
 *                                                                      what the gate would answer (nothing is logged)
 *   … launch --name <session> --brief <file> [--model <requested>] [--lane hand] [--kind k]
 *                                                                      a launch outside the orchestrator asks for its
 *                                                                      model: prints the Claude Code id, logs the decision
 *   … pin <build> <step|all> <opus|fable|none>                         an explicit override on a build's steps
 *   … decisions [--build id] [--lane l] [--limit n] [--json]           the decision log, newest first
 *   … history [--limit n] [--json]                                     every rule change
 *   --by <who> and --reason "<why>" go on the history line.
 *
 * Store: AXF_MODEL_TRIAGE_DIR, else beside a scratch builds store (AXF_BUILDS_STORE), else the hub mount (/projects/amberx-axf/_data/model-triage, shared by the host
 * dispatcher and the console), else ~/.axf/model-triage. config.json (the rules; absent = the starting rules),
 * history.jsonl (rule changes), decisions.jsonl (one line per decision). Writes go through data-files (data-store@1).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../core/model-triage.mjs';
import { MODEL_IDS, MODEL_LABELS, modelKey } from '../core/model-policy.mjs';
import { appendJsonlSync, readJsonSync, readTextSync, writeJsonSync } from '../core/data-files.mjs';
import { readUpgradePolicy, settingsFile } from './upgrade-policy.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const STORE_DIR = Object.freeze({ env: 'AXF_MODEL_TRIAGE_DIR', now: '/projects/amberx-axf/_data/model-triage', fallback: '~/.axf/model-triage' });
/** The owner-only Claude setting a build-wide model comes from (claude-settings registry). */
export const BUILD_MODEL_SETTING = 'builds.defaultModel';
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const nowIso = () => new Date().toISOString();

export function storeDir(env = process.env) {
  if (env[STORE_DIR.env]) return env[STORE_DIR.env];
  // a scratch builds store (a test, a dry run) keeps its rules and decisions beside it, never in the live store
  if (env.AXF_BUILDS_STORE) return join(dirname(env.AXF_BUILDS_STORE), 'model-triage');
  if (existsSync(dirname(STORE_DIR.now))) return STORE_DIR.now;
  return join(homedir(), '.axf', 'model-triage');
}
export const storeFiles = (dir = storeDir()) => ({ dir, config: join(dir, 'config.json'), history: join(dir, 'history.jsonl'), decisions: join(dir, 'decisions.jsonl'), lock: join(dir, 'config.lock') });

/** The rules in force (the starting rules until the first edit). Never throws: a broken store reads as the defaults. */
export function loadConfig({ dir = storeDir() } = {}) {
  let raw = null;
  try { raw = readJsonSync(storeFiles(dir).config, null); } catch { raw = null; }
  return T.normConfig(raw);
}

function lock(f, waitMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(dirname(f), { recursive: true }); closeSync(openSync(f, 'wx')); return () => rmSync(f, { force: true }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(f).mtimeMs > 30000) rmSync(f, { force: true }); } catch { /* gone */ }
      if (Date.now() - t0 > waitMs) throw Object.assign(new Error(`the model triage store is locked (${f})`), { code: 'failed' });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/** One edit, checked and written with its history line. Throws { code: 'invalid' } naming every error. */
export function commitEdit(edit, { dir = storeDir(), by = 'session', at = nowIso() } = {}) {
  const f = storeFiles(dir);
  const unlock = lock(f.lock);
  try {
    const r = T.applyEdit(loadConfig({ dir }), edit, { at, by });
    if (r.errors.length) throw Object.assign(new Error(r.errors.join('; ')), { code: 'invalid' });
    writeJsonSync(f.config, r.config);
    appendJsonlSync(f.history, r.entry);
    return { config: r.config, entry: r.entry };
  } finally { unlock(); }
}

const tail = (file, limit) => {
  const t = readTextSync(file, '') || '';
  const out = [];
  for (const l of t.split('\n').slice(-Math.max(1, limit) * 4 - 1)) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* a torn line */ } }
  return out;
};
/** Rule changes, newest first. */
export const history = ({ dir = storeDir(), limit = 100 } = {}) => tail(storeFiles(dir).history, limit).reverse().slice(0, Math.max(1, limit));
/** Decisions, newest first. Filters: build, lane. */
export function decisions({ dir = storeDir(), build = '', lane = '', limit = 100 } = {}) {
  const n = Math.max(1, Math.min(2000, Number(limit) || 100));
  return tail(storeFiles(dir).decisions, build || lane ? 2000 : n).filter((d) => (!build || d.build === build) && (!lane || d.lane === lane)).reverse().slice(0, n);
}

/** Write a decision to the log (never throws: the log is the record of the decision, not a condition for it). */
export function logDecision(d, { dir = storeDir(), build = '', step = '', name = '', title = '' } = {}) {
  const line = { ...T.normDecision(d), at: d.at || nowIso(), ...(build ? { build } : {}), ...(step ? { step } : {}), ...(name ? { name } : {}), ...(title ? { title: str(title, 200) } : {}) };
  try { appendJsonlSync(storeFiles(dir).decisions, line); } catch (e) { process.stderr.write(`model-triage: decision not logged: ${str(e.message, 200)}\n`); }
  return line;
}

// ---------------------------------------------------------------- measured facts

const CODE = new Set(['.mjs', '.js', '.ts', '.tsx', '.mts', '.py', '.json', '.kt', '.sh', '.css']);
const GENERIC = new Set(['index', 'api', 'test', 'types', 'utils', 'main', 'core', 'ui', 'routes', '__init__', 'plugin', 'settings', 'install', 'uninstall', 'hooks', 'help', 'readme']);

/**
 * How many other files depend on these files: for each one that is a code file, the tracked files that name it (its
 * file name, with its folder when the name alone is too common). One `git grep` per file, at most `max` files, a few
 * seconds each. null when nothing could be measured (no files, no git): the blast radius rule then does not fire.
 */
export function dependents(files, { root = REPO_ROOT, max = 12, timeout = 6000 } = {}) {
  const list = (Array.isArray(files) ? files : []).map((f) => str(f, 300).replace(/^\.\//, '')).filter((f) => CODE.has(extname(f))).slice(0, max);
  if (!list.length || !existsSync(join(root, '.git'))) return null;
  const seen = new Set(); let measured = 0;
  for (const f of list) {
    const stem = basename(f, extname(f));
    const needle = GENERIC.has(stem.toLowerCase()) ? `${basename(dirname(f))}/${basename(f)}` : basename(f).replace(/\.(d\.)?m?tsx?$/, '');
    if (needle.length < 4) continue;
    const r = spawnSync('git', ['grep', '-l', '-I', '-F', '--', needle, '--', '*.mjs', '*.js', '*.ts', '*.tsx', '*.mts', '*.py', '*.sh', '*.kt'], { cwd: root, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0 && r.status !== 1) continue;
    measured += 1;
    for (const l of (r.stdout || '').split('\n')) if (l && l !== f && !/(^|\/)src\/axf\//.test(l)) seen.add(l);
  }
  return measured ? seen.size : null;
}

/** The build-wide model Brett set (Claude settings → Builds → Default model): { model, by } or null when it is "per step". */
export function buildPin(env = process.env) {
  let v;
  try { const f = settingsFile(env); if (existsSync(f)) v = JSON.parse(readFileSync(f, 'utf8'))?.values?.[BUILD_MODEL_SETTING]; } catch { v = undefined; }
  const k = modelKey(v);
  return k && T.REGISTRY.models.some((m) => m.value === k) ? { model: k, by: `Claude settings: ${BUILD_MODEL_SETTING}` } : null;
}

/** What the gate needs beside the work itself: the rules, Brett's approval setting and his build-wide model. */
export function context(env = process.env, { dir = storeDir(env) } = {}) {
  return { config: loadConfig({ dir }), approvalRequired: readUpgradePolicy(env).approvalRequired, buildPin: buildPin(env), dir };
}

// ---------------------------------------------------------------- the lanes

/** Sessions of this step that ran on the model and ended in an error (not a launch that never started, not a usage limit). */
export const sessionFailures = (step) => (step?.statusLog ?? []).filter((l) => l.status === 'failed' && /^session exit/.test(l.why || '')).length;

/** A builds-store step as the gate reads it. `suggested` = the model it came with (the splitter's, or an older record's). */
export function stepWork(build, step, { lane = '', suggested, measure = false, root = REPO_ROOT } = {}) {
  const s = step ?? {};
  return {
    lane: lane || (build?.emergency ? 'emergency' : 'orchestrator'), kind: 'step',
    title: str(s.title, 200), text: str(s.text, 4000), files: s.files ?? [], minutes: parseInt(str(s.estimate), 10) || null,
    dependents: measure ? dependents(s.files, { root }) : s.triage?.facts?.dependents ?? null, priorFailures: sessionFailures(s),
    current: s.triage ? s.model : '', suggested: suggested !== undefined ? suggested : s.triage ? s.triage.suggested ?? '' : s.model,
    suggestedBy: s.suggestedBy ?? s.triage?.suggestedBy ?? '',
    pin: s.pin ? { model: s.pin, by: s.pinBy || 'Brett' } : null,
  };
}

/**
 * The gate's decision for one step of a build → the decision, with `suggested` kept on it so a later pass (the
 * assigning-models status, a retry) reads the same suggestion. Nothing is written here: the caller puts it on the step
 * (`step.model`, `step.triage`) and logs it (logDecision).
 */
export function triageStep(build, step, { lane = '', suggested, measure = false, ctx = null, env = process.env, at = nowIso(), root = REPO_ROOT } = {}) {
  const c = ctx ?? context(env);
  const work = { ...stepWork(build, step, { lane, suggested, measure, root }), buildPin: c.buildPin };
  const d = T.decide(work, c.config, { approvalRequired: c.approvalRequired, at });
  const sug = modelKey(work.suggested);
  return { ...d, ...(sug ? { suggested: T.storeName(sug), ...(work.suggestedBy === 'splitter' ? { suggestedBy: 'splitter' } : {}) } : {}) };
}

/**
 * The gate over a list of steps (a split, the assigning-models status): each step gets its model and its decision.
 * → { steps, decisions: [{ step, ...decision }], changed: ['s2 Opus → Fable (why)'] }. Nothing is written or logged here.
 */
export function triageSteps(build, steps, { lane = '', measure = false, ctx = null, env = process.env, at = nowIso(), root = REPO_ROOT, suggest = null } = {}) {
  const c = ctx ?? context(env);
  const out = { steps: [], decisions: [], changed: [] };
  for (const s of steps ?? []) {
    if (s.skip || s.done) { out.steps.push(s); continue; }
    const d = triageStep(build, s, { lane, measure, ctx: c, at, root, ...(suggest ? { suggested: suggest(s) } : {}) });
    if (d.model !== s.model) out.changed.push(`${s.id} ${s.model || 'no model'} → ${d.model} (${d.why})`);
    out.decisions.push({ step: s.id, ...d });
    out.steps.push({ ...s, model: d.model, triage: T.normDecision(d) });
  }
  return out;
}
/** Log the decisions of one triageSteps pass. */
export function logSteps(build, decisions, { dir = storeDir() } = {}) { for (const d of decisions ?? []) logDecision(d, { dir, build: build?.id ?? '', step: d.step, title: build?.title ?? '' }); }

/**
 * A launch outside the orchestrator (a hand build, a lander fix session) asks for its model. → { decision, key, id }.
 * Logged. `requested` = the model the launch itself named.
 */
export function triageLaunch({ name = '', text = '', title = '', requested = '', lane = 'hand', kind = '', files = [], lines = null, build = '' } = {}, { ctx = null, env = process.env, at = nowIso() } = {}) {
  const c = ctx ?? context(env);
  const first = str(text, 400).split('\n').find((l) => l.trim()) ?? '';
  const work = { lane, kind, title: title || first.replace(/^#+\s*/, ''), text: str(text, 20000), files, lines, requested, current: '', buildPin: lane === 'hand' ? null : c.buildPin };
  const d = T.decide(work, c.config, { approvalRequired: c.approvalRequired, at });
  logDecision(d, { dir: c.dir, name, build, title: work.title });
  const key = modelKey(d.model);
  return { decision: d, key, id: MODEL_IDS[key] };
}

// ---------------------------------------------------------------- CLI

const line = (d, name = '') => T.decisionLine(d, name);
function statusText(cfg, dir) {
  return [
    `Model triage gate: ${cfg.enabled ? 'on' : 'OFF'} · default ${MODEL_LABELS[cfg.defaults.model]} · a hand launch's model is ${cfg.defaults.handRequest === 'floor' ? 'a floor' : cfg.defaults.handRequest === 'pin' ? 'a pin' : 'ignored'} · rev ${cfg.rev} (${dir})`,
    ...cfg.rules.map((r, i) => `  ${i + 1}. ${r.enabled ? 'on ' : 'off'} ${r.id.padEnd(14)} → ${MODEL_LABELS[r.model].padEnd(10)} ${Object.entries(r.settings).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : v}`).join(' ')}${r.lanes.length < T.LANES.length ? `  (${r.lanes.join(', ')})` : ''}`),
  ].join('\n');
}

export async function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const opt = (k, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  const [cmd = 'status', a1 = '', a2 = '', a3 = ''] = pos;
  const by = opt('by', process.env.AXF_ACTOR || 'cli');
  const reason = opt('reason');
  const dir = storeDir();
  const out = (o, text) => { console.log(json ? JSON.stringify(o) : text); return 0; };
  const edit = (e) => { const r = commitEdit({ ...e, ...(reason ? { reason } : {}) }, { dir, by }); return out({ ok: true, config: r.config, entry: r.entry }, statusText(r.config, dir)); };
  const onOff = (v) => (['on', 'true', '1'].includes(v) ? true : ['off', 'false', '0'].includes(v) ? false : undefined);
  try {
    if (cmd === 'status' || cmd === 'rules') {
      const cfg = loadConfig({ dir }); const policy = readUpgradePolicy();
      return out({ ok: true, $axf: T.SCHEMA, config: cfg, registry: T.REGISTRY, path: storeFiles(dir).config, stored: existsSync(storeFiles(dir).config), approvalRequired: policy.approvalRequired, approvalSource: policy.source, buildPin: buildPin(), decisions: decisions({ dir, limit: Number(opt('decisions', '30')) || 30 }) }, statusText(cfg, dir));
    }
    if (cmd === 'rule') {
      const verb = a2;
      if (verb === 'on' || verb === 'off') return edit({ op: 'rule', id: a1, enabled: verb === 'on' });
      if (verb === 'model') return edit({ op: 'rule', id: a1, model: a3 });
      if (verb === 'lanes') return edit({ op: 'rule', id: a1, lanes: a3.split(',').map((x) => x.trim()).filter(Boolean) });
      if (verb === 'move') return edit({ op: 'move', id: a1, to: Number(a3) });
      if (verb === 'set') {
        const key = a3; const value = pos[4] ?? '';
        const f = (T.RULE_FIELDS[a1] ?? []).find((x) => x.key === key);
        return edit({ op: 'rule', id: a1, settings: { [key]: f?.kind === 'number' ? Number(value) : f?.kind === 'toggle' ? onOff(value) ?? value : value } });
      }
      throw Object.assign(new Error('rule <id> on|off | model <m> | set <key> <value> | lanes <a,b> | move <place>'), { code: 'invalid' });
    }
    if (cmd === 'defaults') {
      const e = { op: 'defaults' };
      for (let i = 1; i + 1 < pos.length; i += 2) e[pos[i]] = pos[i] === 'briefWords' ? onOff(pos[i + 1]) : pos[i + 1];
      return edit(e);
    }
    if (cmd === 'gate') return edit({ op: 'enabled', enabled: onOff(a1) });
    if (cmd === 'reset') return edit({ op: 'reset' });
    if (cmd === 'edit') return edit(JSON.parse(a1 || opt('edit', '{}')));
    if (cmd === 'decide') {
      const c = context();
      const files = opt('files').split(',').map((x) => x.trim()).filter(Boolean);
      const work = { lane: opt('lane', 'orchestrator'), kind: opt('kind'), title: opt('title'), text: opt('text'), files, minutes: opt('minutes') || null, lines: opt('lines') || null,
        dependents: opt('dependents') ? Number(opt('dependents')) : dependents(files), priorFailures: Number(opt('failures', '0')) || 0, current: opt('current'), suggested: opt('suggested'), requested: opt('requested'),
        pin: opt('pin') ? { model: opt('pin'), by } : null, buildPin: c.buildPin };
      const d = T.decide(work, c.config, { approvalRequired: c.approvalRequired, at: nowIso() });
      return out({ ok: true, decision: d, id: MODEL_IDS[modelKey(d.model)] }, line(d));
    }
    if (cmd === 'launch') {
      const briefFile = opt('brief');
      const text = briefFile && existsSync(briefFile) ? readFileSync(briefFile, 'utf8').slice(0, 64 * 1024) : opt('text');
      const r = triageLaunch({ name: opt('name'), text, requested: opt('model') || process.env.AXF_MODEL || '', lane: opt('lane', 'hand'), kind: opt('kind'), build: opt('build') });
      return out({ ok: true, ...r }, `${r.id}\t${line(r.decision)}`);
    }
    if (cmd === 'pin') {
      const { withStore } = await import('./builds-store.mjs');
      const k = a3 === 'none' ? '' : modelKey(a3);
      if (!a1 || !a2 || (a3 !== 'none' && !T.REGISTRY.models.some((m) => m.value === k))) throw Object.assign(new Error('pin <build> <step|all> <opus|fable|none>'), { code: 'invalid' });
      const changed = [];
      withStore((st) => {
        const b = st.builds.find((x) => x.id === a1 && !x.deleted); if (!b) throw Object.assign(new Error(`no build "${a1}"`), { code: 'not_found' });
        for (const s of b.steps) {
          if (a2 !== 'all' && s.id !== a2) continue;
          if (k) { s.pin = T.storeName(k); s.pinBy = by; } else { delete s.pin; delete s.pinBy; }
          changed.push(s.id);
        }
        if (!changed.length) throw Object.assign(new Error(`no step "${a2}" in ${a1}`), { code: 'not_found' });
        b.notes.push({ text: k ? `Model pinned to ${T.storeName(k)} on ${changed.join(', ')} by ${by}: the triage gate keeps it.` : `Model pin removed from ${changed.join(', ')} by ${by}: the triage gate decides again.`, at: nowIso(), by });
        return st;
      }, { by, action: 'model-triage:pin', note: `${a1} ${a2} ${a3}` });
      return out({ ok: true, build: a1, steps: changed, pin: k ? T.storeName(k) : '' }, `${a1}: ${changed.join(', ')} ${k ? `pinned to ${T.storeName(k)}` : 'unpinned'}`);
    }
    if (cmd === 'decisions') {
      const rows = decisions({ dir, build: opt('build'), lane: opt('lane'), limit: Number(opt('limit', '50')) || 50 });
      return out({ ok: true, decisions: rows }, rows.map((d) => `${d.at}  ${(d.build ? `${d.build}${d.step ? `/${d.step}` : ''}` : d.name || '-').padEnd(40)} ${line(d)}`).join('\n') || 'No decisions yet.');
    }
    if (cmd === 'history') {
      const rows = history({ dir, limit: Number(opt('limit', '50')) || 50 });
      return out({ ok: true, entries: rows }, rows.map((h) => `${h.at}  rev ${h.rev}  ${h.by}: ${h.what}${h.reason?.title && h.reason.title !== h.what ? ` (${h.reason.title})` : ''}`).join('\n') || 'No rule changes yet.');
    }
    throw Object.assign(new Error('usage: model-triage.mjs status | rule <id> … | defaults … | gate on|off | reset | decide … | launch … | pin … | decisions | history (see the header)'), { code: 'invalid' });
  } catch (e) {
    const code = e.code === 'invalid' || e.code === 'not_found' || e.code === 'failed' ? e.code : e instanceof SyntaxError ? 'invalid' : 'failed';
    if (json) console.log(JSON.stringify({ ok: false, code, message: str(e.message, 600) })); else console.error(`model-triage: ${e.message}`);
    return code === 'invalid' ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
