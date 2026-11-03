#!/usr/bin/env node
/**
 * ui-predict — predicted looks in UI Review before a build runs (Brett, Nov 3 2026: "approve the look before an agent
 * spends money"; build ui-review-predicted). Core: framework/core/ui-predict.mjs (ui-mockup@1, ui-prediction@1).
 *
 *   node framework/cli/ui-predict.mjs predict <build> [--worktree <dir>] [--files a,b] [--force] [--dry-run] [--json]
 *        mockup spec from the build's brief + steps (+ the files its worktree / branch touched so far), rendered by the
 *        UI Review mockup page with the framework's controls and the current theme, captured phone + desktop with
 *        rebuild-shots.mjs together with the screen as it is now (main), and sent to UI Review as one item
 *        "Predicted - approve the look" (badge Predicted). Same spec as last time = nothing to do (cached); --force.
 *   … real <build> [--worktree <dir>] [--pr N]   the build finished: its real screens replace the mockup (badge Real)
 *   … list [--build <id>] [--json]                predicted items and their look gate verdicts
 *   … approve <build> [--changes|--reject|--reopen] [--comment "…"]   Brett's decision on a look (the console's buttons)
 *   … settings [on|off]                           "Wait for my look approval before UI builds start" (default off)
 *   … gate [--build <id>] [--name <session>] [--brief <file>]   the launcher's check: exit 0 go, 4 wait, 5 held
 *        (no prediction yet for a UI build = one is started in the background)
 *   … wait [--build|--name|--brief] [--every 60] [--max-hours 24]   until the look is approved (0) or rejected (5)
 *   … follow <build> --worktree <dir> [--parent <pid>] [--every 300]   refresh while the build runs; real shots at the end
 *   … addendum <build> --text "…"                 an Ask changes comment → a note on the build (orchestrator)
 *   … addenda <build>                             the brief lines for a build's asked look changes
 *   … which [--name <session>] [--brief <file>]   the orchestrator build a launch belongs to (its id)
 *   … backfill [<build>…]                         predicted items for queued / running UI builds that have none
 *   … spec <build> [--files …] [--json]           the mockup spec and capture plan only (no browser, no console)
 *
 * The spec is made by rules (no model, $0, recorded on the item as cost {usd: 0, model: "rules"}). The console is
 * reached through AXF_CONSOLE_URL + AXF_TOKEN, else `docker exec axf-console` (the VPS); AXF_UI_PREDICT_CONSOLE=off
 * never calls it. Captures run under the agent cap (agent-slots.mjs heavy). AXF_UI_PREDICT_CAPTURE_REPO = the
 * checkout whose console draws the pictures (default: this one).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/ui-predict.mjs';
import { loadStore } from './builds-store.mjs';
import { findBuild } from './model-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SELF = fileURLToPath(import.meta.url);
const OPEN = ['pending', 'queued', 'running', 'ready', 'paused', 'built'];

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; if (n !== undefined && !n.startsWith('--')) { flags[k] = n; i++; } else flags[k] = true; } else pos.push(a);
}
const val = (v) => (typeof v === 'string' ? v : '');
const say = (v, text) => console.log(flags.json ? JSON.stringify(v, null, 1) : text);

/* ------------------------------------------------------------------ builds, files, plugins */

function buildOf(id) {
  const store = loadStore();
  const brief = val(flags.brief) && existsSync(flags.brief) ? readFileSync(flags.brief, 'utf8') : '';
  return findBuild(store, { build: id || val(flags.build) || process.env.AXF_BUILD_ID || '', name: val(flags.name), brief });
}

const git = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
/** Files the build touched so far: its worktree (committed since main + uncommitted), else its branch vs main. */
function touched(build, worktree) {
  if (val(flags.files)) return flags.files.split(',').map((x) => x.trim()).filter(Boolean);
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  if (worktree && existsSync(worktree)) {
    const base = git(worktree, 'merge-base', 'HEAD', 'origin/main');
    return [...new Set([...lines(base ? git(worktree, 'diff', '--name-only', base) : ''), ...lines(git(worktree, 'ls-files', '--others', '--exclude-standard'))])];
  }
  if (build?.branch && git(REPO, 'rev-parse', '--verify', '-q', `origin/${build.branch}`)) return lines(git(REPO, 'diff', '--name-only', `origin/main...origin/${build.branch}`));
  return [];
}

/** Console plugin folder → the title its page shows (search finds it by that). */
function pluginTitles(repo = REPO) {
  const dir = join(repo, 'apps/console-web/plugins'); const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) { try { const j = JSON.parse(readFileSync(join(dir, f, 'plugin.json'), 'utf8')); out[f] = j.tabable?.label || j.name || f; } catch { /* not a plugin */ } }
  return out;
}

function specFor(build, files) {
  const store = loadStore();
  const rows = (store.builds ?? []).filter((b) => OPEN.includes(b.status) && !b.deleted).slice(-4).map((b) => ({ name: b.title.slice(0, 48), status: b.status, updated: (b.updatedAt || '').slice(0, 10) }));
  return P.mockupSpec(build, { files, plugins: pluginTitles(), demo: { rows } });
}

/* ------------------------------------------------------------------ console (UI Review routes) */

/** The plugin providing ui-review@1 (found by capability, never by folder name): its folder names its routes and data. */
function reviewFolder() {
  const dir = join(REPO, 'apps/console-web/plugins');
  for (const f of existsSync(dir) ? readdirSync(dir) : []) { try { if (JSON.parse(readFileSync(join(dir, f, 'plugin.json'), 'utf8')).provides?.includes('service:ui-review@1')) return f; } catch { /* not a plugin */ } }
  throw new Error('no console plugin provides ui-review@1 here');
}

async function api(path, body, method) {
  if (process.env.AXF_UI_PREDICT_CONSOLE === 'off') throw new Error('console calls are off (AXF_UI_PREDICT_CONSOLE=off)');
  const m = method || (body ? 'POST' : 'GET');
  const url = process.env.AXF_CONSOLE_URL, tok = process.env.AXF_TOKEN;
  if (url && tok) {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/plugins/${reviewFolder()}/${path}`, { method: m, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`console ${r.status}: ${typeof j.detail === 'string' ? j.detail : r.statusText}`); e.status = r.status; throw e; }
    return j;
  }
  // the VPS: the console token lives inside its container
  const sh = `curl -s -o /dev/stdout -w '\\n%{http_code}' -X ${m} -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" ${body ? '--data-binary @-' : ''} http://127.0.0.1:7090/api/plugins/${reviewFolder()}/${path}`;
  const r = spawnSync('docker', ['exec', '-i', process.env.AXF_CONSOLE_CONTAINER || 'axf-console', 'sh', '-c', sh], { input: body ? JSON.stringify(body) : '', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`console unreachable: set AXF_CONSOLE_URL + AXF_TOKEN (docker exec: ${(r.stderr || r.error?.message || '').trim().slice(0, 200)})`);
  const out = r.stdout.replace(/\n$/, ''); const i = out.lastIndexOf('\n'); const code = Number(out.slice(i + 1)); const text = out.slice(0, i);
  const j = (() => { try { return JSON.parse(text); } catch { return {}; } })();
  if (!(code >= 200 && code < 300)) { const e = new Error(`console ${code}: ${typeof j.detail === 'string' ? j.detail : text.slice(0, 200)}`); e.status = code; throw e; }
  return j;
}

/* ------------------------------------------------------------------ capture */

/** rebuild-shots with the plan; returns the picture files. Under the agent cap's heavy lock. */
function capture(plan, repo) {
  const tmp = mkdtempSync(join(tmpdir(), 'axf-predict-'));
  const shotsFile = join(tmp, 'shots.json'); writeFileSync(shotsFile, JSON.stringify(plan));
  const cmd = [join(REPO, 'framework/cli/rebuild-shots.mjs'), '--repo', repo, '--out', join(tmp, 'out'), '--shots', shotsFile, '--label', 'shots', '--env', 'AXF_APPEARANCE_HUB=off', '--nav-timeout', '180000'];
  const slots = join(REPO, 'framework/cli/agent-slots.mjs');
  const full = existsSync(slots) && process.env.AXF_SLOTS !== 'off' ? [slots, 'heavy', '--', process.execPath, ...cmd] : cmd;
  const r = spawnSync(process.execPath, full, { cwd: existsSync(join(repo, 'apps/console-web/node_modules')) ? join(repo, 'apps/console-web') : REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20 * 60_000 });
  const dir = join(tmp, 'out', 'shots');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.png$/.test(f)).map((f) => join(dir, f)) : [];
  if (!files.length) throw new Error(`capture made no pictures (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().split('\n').slice(-6).join(' | ')}`);
  return { files, tmp };
}

const filesBody = (files) => files.map((f) => ({ name: basename(f), data: readFileSync(f).toString('base64') }));
const cacheDir = () => process.env.AXF_UI_PREDICT_CACHE || join(process.env.AXF_UI_REVIEW_DIR || join(existsSync('/opt/axf/.axf-console') ? '/opt/axf' : REPO, '.axf-console/plugins', reviewFolder()), 'predictions');
const day = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const appName = (a) => ({ 'console-web': 'Console', 'axhub-web': 'axHub', 'amberx-droid': 'AmberX' }[a] ?? a);

/* ------------------------------------------------------------------ commands */

async function predict(id, { worktree = val(flags.worktree), force = !!flags.force, quiet = false } = {}) {
  const b = buildOf(id);
  if (!b) throw new Error(`no orchestrator build "${id}"`);
  const files = touched(b, worktree);
  if (!P.touchesUi(b, files)) return { build: b.id, skipped: 'changes nothing visible' };
  const spec = specFor(b, files);
  const hash = P.specHash(spec);
  const cacheFile = join(cacheDir(), `${b.id}.json`);
  const cached = (() => { try { return JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { return null; } })();
  const plan = P.capturePlan(spec, { before: !cached || force }); // the screen as it is now: once, when the item is made
  if (flags['dry-run']) return { build: b.id, hash, spec, plan, cached: cached?.hash === hash };
  if (cached?.hash === hash && !force) return { build: b.id, hash, unchanged: true };
  const repo = process.env.AXF_UI_PREDICT_CAPTURE_REPO || REPO;
  const { files: pics, tmp } = capture(plan, repo);
  const pred = { ...P.newPrediction(spec), diffFiles: files.length };
  const primary = spec.screens[0];
  const body = {
    build: b.id, name: `Predicted look: ${b.title}`.slice(0, 200), app: appName(primary.app), screen: spec.screens.map((s) => s.title).join(', '),
    kind: primary.blocks.some((x) => x.type === 'settings') && primary.id === 'settings' ? 'settings' : 'screen',
    group: `Predicted looks - ${day()}`, source: process.env.AXF_SURFACE === 'headless' ? 'headless' : 'claude-code', submittedBy: `build:${b.id}`,
    branch: b.branch || undefined, pr: b.pr || undefined, notes: `Predicted from the brief and ${b.steps.length} steps${files.length ? ` + ${files.length} files touched so far` : ''}. Mockup made by rules ($0, no model). Approve the look before the build spends money; Ask changes sends your comment to the build.`,
    prediction: pred, files: filesBody(pics),
  };
  let res;
  try { res = await api('predict', body); }
  catch (e) { if (![404, 405].includes(e.status)) throw e; }
  if (!res?.item) { res = await api('submit', body); res.legacy = true; } // a console without the predict route yet: a plain item carrying the prediction
  mkdirSync(cacheDir(), { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ hash, at: new Date().toISOString(), item: res.item?.id, spec }, null, 1));
  rmSync(tmp, { recursive: true, force: true });
  if (!quiet) console.error(`ui-predict: ${b.id} → ${res.item?.id} (${pics.length} pictures${res.refreshed ? ', refreshed' : ''})`);
  return { build: b.id, hash, item: res.item?.id, refreshed: !!res.refreshed, pictures: pics.length, cost: pred.cost };
}

async function real(id, { worktree = val(flags.worktree) } = {}) {
  const b = buildOf(id);
  if (!b) throw new Error(`no orchestrator build "${id}"`);
  const repo = worktree && existsSync(join(worktree, 'apps/console-web/node_modules')) ? worktree : '';
  if (!repo) return { build: b.id, skipped: `no checkout with node_modules to capture the real screens (${worktree || 'no --worktree'})` };
  const spec = specFor(b, touched(b, worktree));
  const plan = P.capturePlan(spec, { role: 'real' });
  if (!plan.length) return { build: b.id, skipped: 'no screen with a live capture route' };
  const { files: pics, tmp } = capture(plan, repo);
  const res = await api('predict/real', { build: b.id, pr: val(flags.pr) || b.pr || undefined, branch: b.branch || undefined, files: filesBody(pics) });
  rmSync(tmp, { recursive: true, force: true });
  return { build: b.id, item: res.item?.id, pictures: pics.length };
}

async function gate() {
  const b = buildOf(pos[1]);
  if (!b) return { code: 0, line: 'look gate: not an orchestrator build, nothing to check' };
  const touches = P.touchesUi(b, touched(b, val(flags.worktree)));
  let v;
  try { v = (await api(`predicted?build=${encodeURIComponent(b.id)}&touches=${touches}`)).verdict; }
  catch (e) { return { code: 0, line: `look gate: ${b.id} starts (UI Review unreachable: ${e.message})` }; }
  if (!v || typeof v.go !== 'boolean') return { code: 0, line: `look gate: ${b.id} starts (this console's UI Review has no look gate yet)` }; // never block a launch on an older console
  if (touches && v.look === 'none' && !flags['no-predict']) {
    // the predicted look is made now, in the background: Brett sees it in UI Review while the build waits or runs
    spawn(process.execPath, [SELF, 'predict', b.id, ...(val(flags.worktree) ? ['--worktree', flags.worktree] : [])], { detached: true, stdio: 'ignore' }).unref();
  }
  return { code: v.go ? 0 : v.wait ? 4 : 5, line: `look gate: ${b.id} ${v.go ? 'starts' : v.wait ? 'waits' : 'is held'}: ${v.reason}`, verdict: v };
}

async function addendum(id, text) {
  const b = buildOf(id);
  if (!b) throw new Error(`no orchestrator build "${id}"`);
  const profile = (b.profiles ?? [])[0] || '';
  const r = spawnSync(process.execPath, [join(REPO, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs'), 'act', 'note', b.id, `Look change asked in UI Review (apply before or at the next step): ${text}`],
    { encoding: 'utf8', env: { ...process.env, ...(profile ? { AXF_BUILD_PROFILE: profile } : {}) } });
  if (r.status !== 0) throw new Error(`orchestrator note failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return { build: b.id, noted: true };
}

async function main() {
  const cmd = pos[0];
  switch (cmd) {
    case 'spec': { const b = buildOf(pos[1]); if (!b) throw new Error(`no orchestrator build "${pos[1]}"`); const files = touched(b, val(flags.worktree)); const spec = specFor(b, files); const out = { build: b.id, touchesUi: P.touchesUi(b, files), hash: P.specHash(spec), spec, plan: P.capturePlan(spec) };
      return say(out, `${b.id}: ${out.touchesUi ? 'changes UI' : 'changes nothing visible'} · ${spec.screens.length} screen(s)\n${spec.screens.map((s) => `  ${s.title} (${s.app}): ${s.blocks.map((x) => x.type).join(', ')}`).join('\n')}`); }
    case 'predict': { const r = await predict(pos[1]); return say(r, r.skipped ? `${r.build}: skipped (${r.skipped})` : r.unchanged ? `${r.build}: unchanged, nothing to capture` : r.plan ? `${r.build}: would capture ${r.plan.map((p) => p.name).join(', ')}` : `${r.build}: ${r.refreshed ? 'refreshed' : 'predicted'} → UI Review item ${r.item} (${r.pictures} pictures, $${r.cost.usd.toFixed(2)})`); }
    case 'real': { const r = await real(pos[1]); return say(r, r.skipped ? `${r.build}: real shots skipped (${r.skipped})` : `${r.build}: real shots → ${r.item} (${r.pictures} pictures)`); }
    case 'list': { const r = await api(`predicted${val(flags.build) ? `?build=${encodeURIComponent(flags.build)}` : ''}`);
      return say(r, [`wait for look approval: ${r.settings.waitForLook ? 'on' : 'off'}`, ...r.items.map((it) => `${it.id}  ${it.prediction.build}  ${it.prediction.state}  look ${it.prediction.look?.status ?? 'waiting'}  ${it.verdict.go ? 'go' : it.verdict.wait ? 'waits' : 'held'}  ${it.name}`)].join('\n')); }
    case 'approve': { const decision = flags.changes ? 'changes' : flags.reject ? 'reject' : flags.reopen ? 'reopen' : 'approve';
      const r = await api('approve-look', { build: pos[1], decision, comment: val(flags.comment), by: val(flags.by) || 'brett' }); return say(r, `${pos[1]}: look ${decision} (${r.changed.length} item(s))`); }
    case 'settings': { const r = pos[1] === 'on' || pos[1] === 'off' ? await api('settings', { waitForLook: pos[1] === 'on' }, 'PUT') : await api('settings'); return say(r, `wait for look approval before UI builds start: ${r.waitForLook ? 'on' : 'off'}`); }
    case 'gate': { const r = await gate(); say(r, r.line); process.exitCode = r.code; return; }
    case 'wait': {
      const every = Math.max(10, Number(flags.every) || 60) * 1000; const end = Date.now() + (Number(flags['max-hours']) || 24) * 3600_000;
      for (;;) { const r = await gate(); if (r.code !== 4) { say(r, r.line); process.exitCode = r.code; return; } if (Date.now() > end) { console.log(`${r.line} (gave up after ${flags['max-hours'] || 24} h)`); process.exitCode = 4; return; } await new Promise((ok) => setTimeout(ok, every)); flags['no-predict'] = true; }
    }
    case 'follow': {
      const id = pos[1]; const parent = Number(flags.parent) || 0; const every = Math.max(30, Number(flags.every) || 300) * 1000;
      const alive = () => { if (!parent) return true; try { process.kill(parent, 0); return true; } catch { return false; } };
      let last = 0;
      while (alive()) { if (Date.now() - last >= every) { last = Date.now(); try { const r = await predict(id, { quiet: true }); if (r.refreshed) console.log(`${new Date().toISOString()} ${id}: predicted look refreshed`); } catch (e) { console.log(`${new Date().toISOString()} ${id}: ${e.message}`); } } await new Promise((ok) => setTimeout(ok, 5000)); }
      try { const r = await real(id); console.log(`${new Date().toISOString()} ${id}: ${r.skipped ? `real shots skipped (${r.skipped})` : `real shots → ${r.item}`}`); } catch (e) { console.log(`${id}: real shots failed: ${e.message}`); }
      return;
    }
    case 'which': { const b = buildOf(pos[1]); if (b) console.log(b.id); return; }
    case 'addendum': { if (!val(flags.text)) throw new Error('--text "<the comment>" is needed'); const r = await addendum(pos[1], flags.text); return say(r, `${r.build}: look change noted on the build`); }
    case 'addenda': { const b = buildOf(pos[1]); if (!b) return; let it = null; try { it = (await api(`predicted?build=${encodeURIComponent(b.id)}`)).items.at(-1) ?? null; } catch { /* unreachable: nothing to add */ }
      const t = P.addendumText(it); if (t) console.log(t); return; }
    case 'backfill': {
      const store = loadStore(); const ids = pos.slice(1).length ? pos.slice(1) : (store.builds ?? []).filter((b) => ['queued', 'running', 'pending'].includes(b.status) && !b.deleted && P.touchesUi(b)).map((b) => b.id);
      let have = new Set(); try { have = new Set((await api('predicted')).items.map((x) => x.prediction.build)); } catch { /* old console: no list */ }
      const out = [];
      for (const id of ids) { if (have.has(id) && !flags.force) { out.push({ build: id, skipped: 'already predicted' }); continue; } try { out.push(await predict(id, { force: true })); } catch (e) { out.push({ build: id, error: e.message }); } }
      return say(out, out.map((r) => `${r.build}: ${r.error ? `failed: ${r.error}` : r.skipped ? `skipped (${r.skipped})` : `→ ${r.item} (${r.pictures} pictures)`}`).join('\n'));
    }
    default:
      console.log(readFileSync(SELF, 'utf8').split('\n').slice(2, 28).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
      if (cmd && cmd !== 'help') process.exitCode = 2;
  }
}

main().catch((e) => { console.error(`ui-predict: ${e.message}`); process.exit(2); });
