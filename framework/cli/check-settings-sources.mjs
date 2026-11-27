#!/usr/bin/env node
/**
 * check-settings-sources.mjs — one true source (settings-sources@1, framework/schemas/settings-sources.json): a console
 * setting is stored under exactly one key and has one wording. CI fails when
 *   1. the registry contradicts itself (two sources with one label, a key that is both a source and an alias);
 *   2. two settings are registered for the same thing: a retired alias is a registered Claude / framework setting
 *      again, two registered settings share a wording, or a key name sits in more than one store without being listed
 *      as one store or as different settings (sameName);
 *   3. an alias is stored again: it is back in a server allow-list or defaults table outside the module that reads it,
 *      or the engines write it (probed for real in a scratch store);
 *   4. a screen keeps its own copy: a web file persists a merged key (localStorage, writeLocal, the settings
 *      registry) or shows a retired wording.
 *
 *   node framework/cli/check-settings-sources.mjs            check (exit 1 on a finding)
 *   node framework/cli/check-settings-sources.mjs --json     the findings as JSON
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, audit, loadSources, toPath, walk, wordKey } from './settings-audit.mjs';

const REGISTRY = 'framework/schemas/settings-sources.json';
const SCREEN_DIRS = [toPath('plugin:').replace(/\/$/, ''), 'apps/console-web/src', 'framework/libs', 'framework/react'];

/** The whole registry: the framework's file plus every plugin's own part. */
export function loadRegistry(root = ROOT) { return loadSources(root); }

/** Pure: findings for a registry against an audit and the screens' sources ({ file: text }). */
export function check(reg, a, screens = {}) {
  const out = [];
  const add = (rule, msg) => out.push({ rule, msg });
  const sources = reg.sources ?? [];
  // 1. the registry itself
  const labels = new Map();
  for (const s of [...sources, ...(reg.distinct ?? [])]) {
    const w = wordKey(s.label);
    if (labels.has(w)) add('registry', `"${s.label}" and "${labels.get(w)}" are the same wording: one setting, one label`); else labels.set(w, s.label);
  }
  const ids = new Set();
  for (const s of sources) {
    if (ids.has(s.id)) add('registry', `source id ${s.id} is listed twice`); ids.add(s.id);
    if (!s.store?.key || !s.store?.file || !s.label) add('registry', `source ${s.id} needs a label and a store { file, key }`);
    for (const al of s.aliases ?? []) {
      if (!al.key || !al.store || !al.module) add('registry', `an alias of ${s.id} needs key, store and module`);
      if (sources.some((o) => o.store?.key === al.key && toPath(o.store?.module) === toPath(al.module))) add('registry', `${al.key} is an alias of ${s.id} and a source of its own`);
    }
  }
  // 2. two settings registered for the same thing
  const registered = [...a.registry, ...a.framework];
  for (const s of sources) {
    for (const al of s.aliases ?? []) {
      const hit = registered.find((r) => r.key === al.key);
      if (hit) add('registered-twice', `${al.key} is a registered setting again (${hit.file}) but it is a retired alias of "${s.label}" (${s.store.key}): edit that one key instead`);
    }
    for (const r of registered) {
      if (wordKey(r.label) === wordKey(s.label) && r.key !== s.store.key) add('registered-twice', `"${r.label}" (${r.key}, ${r.file}) repeats "${s.label}", which is stored as ${s.store.key}: one setting, one key`);
      for (const w of s.retiredWording ?? []) if (wordKey(r.label) === wordKey(w)) add('registered-twice', `"${r.label}" (${r.key}, ${r.file}) brings back the retired wording of "${s.label}"`);
    }
  }
  for (const d of a.sameWords) add('registered-twice', `"${d.items[0].label}" is the label of ${d.items.map((i) => `${i.key} (${i.file})`).join(' and ')}: two keys for one thing, or reword one`);
  const oneStore = reg.sameName?.oneStore ?? []; const different = reg.sameName?.differentSettings ?? {};
  for (const d of a.sameName) {
    if (different[d.key]) continue;
    if (oneStore.some((g) => d.stores.every((s) => g.stores.includes(s)))) continue;
    add('same-name', `${d.key} is kept in ${d.stores.join(' and ')}: make one the source and list the other as its alias in ${REGISTRY}, or record there why they are one store / different settings`);
  }
  // 3. an alias stored again (static): only the module that reads it may still name it in a store table
  for (const s of sources) for (const al of s.aliases ?? []) {
    const home = toPath(al.module).split('/').slice(0, -1).join('/');
    for (const st of a.stores) if (st.keys.includes(al.key) && !st.file.startsWith(home) && (al.readers ?? []).every((r) => r !== st.file) && nameClash(al, st)) add('alias-stored', `${st.file} ${st.decl} lists ${al.key}, a retired alias of "${s.label}": the one key is ${s.store.key} (${s.store.file})`);
  }
  // 4. a screen keeps its own copy
  const persist = /(localStorage\.setItem|writeLocal|settings\.set|sessionStorage\.setItem)\(\s*[`'"]([^`'"]+)[`'"]/g;
  for (const [file, src] of Object.entries(screens)) {
    const text = stripComments(src);
    for (const m of text.matchAll(persist)) for (const s of sources) {
      const keys = [s.store.key, s.id, ...(s.aliases ?? []).map((al) => al.key)];
      if (keys.some((k) => m[2] === k || m[2].endsWith(`.${k}`))) add('screen-copy', `${file} stores its own copy of "${s.label}" (${m[1]}('${m[2]}')): a screen reads and saves the one key (${s.store.key})`);
    }
    for (const s of sources) for (const w of s.retiredWording ?? []) {
      if (new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(text)) add('wording', `${file} says "${w}": the one wording is "${s.label}"`);
    }
  }
  return out;
}
/** A common name (`parallel`) in an unrelated store is not that alias: only the alias's own plugin / folder counts. */
function nameClash(al, st) { const plugin = /^apps\/console-web\/plugins\/[^/]+/.exec(toPath(al.module))?.[0]; return al.key.length >= 9 || (plugin ? st.file.startsWith(plugin) : false); }
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** The engines for real, in a scratch store: saving an alias stores nothing and the one key answers every read. */
export function probe() {
  const tmp = mkdtempSync(join(tmpdir(), 'axf-settings-sources-'));
  const code = `
    import { readFileSync, existsSync } from 'node:fs'; import { join } from 'node:path';
    const S = await import(${JSON.stringify(join(ROOT, 'framework/cli/agent-slots.mjs'))}); const L = await import(${JSON.stringify(join(ROOT, 'framework/cli/build-limit.mjs'))});
    const PL = await import(${JSON.stringify(join(ROOT, toPath('plugin:build-orchestrator/pipeline.mjs')))});
    const out = []; const file = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
    L.saveLimit({ maxBuilds: 3 }, { by: 'check', owner: true }); S.saveSettings({ maxAgents: 9, maxHeavy: 2 });
    if ('maxAgents' in file(join(process.env.AXF_SLOTS_DIR, 'settings.json'))) out.push('agent-slots saveSettings stored maxAgents');
    if (S.loadSettings().maxAgents !== 3 || S.status({ hard: false }).cap !== 3) out.push('agent-slots does not read Builds at once from build-limit.json maxBuilds');
    PL.saveSettings({ parallelPerAccount: 4, maxRuns: 3 });
    const pf = file(join(process.env.AXF_PIPELINE_DIR, 'settings.json'));
    for (const k of ['parallelPerAccount', 'autoQueue', 'briefMaxBytes']) if (k in pf) out.push('pipeline saveSettings stored ' + k);
    if (file(join(process.env.AXF_CLAUDE_WORKERS, 'workers.json')).limits?.building !== 4 || PL.loadSettings().parallelPerAccount !== 4) out.push('Sessions per account is not saved as claude-workers limits.building');
    for (const k of ['autoQueue', 'briefMaxBytes']) { try { PL.saveSettings({ [k]: 1 }); out.push('pipeline saveSettings accepted ' + k); } catch { /* refused: right */ } }
    console.log(JSON.stringify(out));`;
  const env = { ...process.env, AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LIMIT: 'off', AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_CLAUDE_WORKERS: join(tmp, 'workers'), AXF_CLAUDE_SEEN: join(tmp, 'workers', 'seen.json'), AXF_CLAUDE_ACCOUNTS: join(tmp, 'accounts'), AXF_CLAUDE_SETTINGS_FILE: join(tmp, 'claude.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off' };
  delete env.AXF_PIPELINE_SETTINGS;
  for (const d of ['slots', 'pipeline', 'workers']) mkdirSync(join(tmp, d), { recursive: true });
  writeFileSync(join(tmp, 'probe.mjs'), code);
  const r = spawnSync(process.execPath, [join(tmp, 'probe.mjs')], { env, encoding: 'utf8', timeout: 60_000 });
  rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) return [{ rule: 'alias-stored', msg: `the engine probe did not run: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}` }];
  return JSON.parse(r.stdout.trim().split('\n').pop()).map((msg) => ({ rule: 'alias-stored', msg }));
}

export function screenSources() {
  const out = {};
  for (const f of SCREEN_DIRS.flatMap((d) => walk(d)).filter((f) => /\.tsx?$/.test(f))) out[f] = readFileSync(join(ROOT, f), 'utf8');
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const reg = loadRegistry();
  const findings = [...check(reg, audit(), screenSources()), ...probe()];
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: !findings.length, findings }, null, 1));
  else if (findings.length) { for (const f of findings) console.error(`✗ [${f.rule}] ${f.msg}`); console.error(`settings-sources: ${findings.length} finding(s). One setting, one stored key, one wording (${REGISTRY}).`); }
  else console.log(`✓ settings-sources — ${reg.sources.length} merged settings, ${reg.sources.reduce((n, s) => n + (s.aliases ?? []).length, 0)} read aliases, none stored or registered twice, no screen keeps a copy`);
  if (findings.length) process.exitCode = 1;
}
