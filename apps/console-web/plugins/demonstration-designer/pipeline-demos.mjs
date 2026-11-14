#!/usr/bin/env node
/**
 * Pipeline demos: the store, the live runner and the CLI of the Demonstration Designer's Pipelines mode. The library
 * (pipeline-library.mjs) ships one demo per pipeline type; demos made or changed in the designer are pipeline-demo@1
 * files in <dataDir>/pipeline/<id>.json (a saved copy of a built-in shadows it); recordings of live runs are
 * pipeline-recording@1 files in <dataDir>/pipeline-recording/<id>.json and are what an offline replay plays.
 *
 * A live run executes each chapter's probes (pipelines.mjs PROBES) for real, on the test-sandbox project's data and
 * this checkout: git log and status, the sandbox builds, the model policy and the rules splitter on the chapter's own
 * words, this plugin's self-test, the theme check, the agent slots, and the axHub payload a chapter's call would carry
 * (printed, never sent). Every probe is read-only: a demo never writes a build, a commit or a hub record.
 *
 *   node apps/console-web/plugins/demonstration-designer/pipeline-demos.mjs list [--json]
 *   node …/pipeline-demos.mjs get <id> · timeline <id> [--speed 2] · lines <id> [--kind git,test] [--q words]
 *   node …/pipeline-demos.mjs save <file.json> · copy <id> [--as new-id] · delete <id>
 *   node …/pipeline-demos.mjs live <id> [--chapter c]     run the probes for real and keep the recording
 *   node …/pipeline-demos.mjs recording <id> · match "run the voice-to-app demo" · link <id> [--play] [--live]
 *   node …/pipeline-demos.mjs types · screens · probes
 *
 * Env: AXF_DEMO_DESIGNER_DIR (data folder), AXF_REPO_ROOT. No model, no network.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './pipelines.mjs';
import { LIBRARY, libraryDemo } from './pipeline-library.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.AXF_REPO_ROOT || join(HERE, '../../../..');
const dataDir = () => process.env.AXF_DEMO_DESIGNER_DIR || join(ROOT, '.axf-console/plugins/demonstration-designer');
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(v, null, 1)}\n`); };
const demoFile = (id) => join(dataDir(), 'pipeline', `${id}.json`);
const recFile = (id) => join(dataDir(), 'pipeline-recording', `${id}.json`);
const assertId = (id) => { if (!ID.test(id ?? '')) throw new Error(`"${id}" is not a pipeline demo id (lowercase letters, digits and dashes, 2 to 48)`); };

/* ---------------- store ---------------- */

function saved() {
  const d = join(dataDir(), 'pipeline');
  if (!existsSync(d)) return [];
  const out = [];
  for (const f of readdirSync(d).filter((n) => n.endsWith('.json')).sort()) { try { out.push(P.normalizeDemo({ ...readJson(join(d, f)), builtIn: false })); } catch { /* a broken file is skipped */ } }
  return out;
}

/** Every demo: the saved ones first (a saved copy of a built-in replaces it), then the rest of the library. */
export function all() {
  const mine = saved();
  return [...mine, ...LIBRARY.filter((l) => !mine.some((m) => m.id === l.id))];
}
export const list = () => all().map((d) => ({ ...P.summarize(d), recorded: existsSync(recFile(d.id)) }));
export function get(id) { assertId(id); return all().find((d) => d.id === id) ?? null; }
const need = (id) => { const d = get(id); if (!d) throw Object.assign(new Error(`no pipeline demo ${id}`), { code: 2 }); return d; };

export function save(raw) {
  const errs = P.validateDemo(raw);
  if (errs.length) throw new Error(errs.join('; '));
  const d = P.normalizeDemo({ ...raw, builtIn: false, updatedAt: new Date().toISOString() });
  writeJson(demoFile(d.id), d);
  return d;
}
export function copy(id, as = '') {
  const d = need(id);
  let nid = as || `${d.id}-copy`;
  assertId(nid);
  if (!as) for (let i = 2; existsSync(demoFile(nid)); i++) nid = `${d.id}-copy-${i}`.slice(0, 48);
  return save({ ...d, id: nid, name: as ? d.name : `${d.name} (copy)` });
}
/** Remove a saved demo (a built-in can't go; removing a saved copy of one brings the built-in back). */
export function remove(id) {
  assertId(id);
  if (!existsSync(demoFile(id))) { if (libraryDemo(id)) throw new Error(`${id} is a built-in demo; save a copy to change it`); return false; }
  rmSync(demoFile(id));
  rmSync(recFile(id), { force: true });
  return true;
}

/** What a replay plays: the recording of the last live run when there is one (recorded: true), else the script. */
export function playable(id, { recorded = true } = {}) {
  const d = need(id);
  const rec = recorded && existsSync(recFile(id)) ? readJson(recFile(id)) : null;
  const demo = rec?.demoData ? P.normalizeDemo(rec.demoData) : d;
  return { demo, timeline: P.timeline(demo), recordedAt: rec?.recordedAt ?? '' };
}
export function recording(id) { assertId(id); return existsSync(recFile(id)) ? readJson(recFile(id)) : null; }

/* ---------------- live: the probes, for real and read-only ---------------- */

const run = (cmd, args, { env = {}, timeout = 60000 } = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout, env: { ...process.env, ...env } });
  const out = `${r.stdout ?? ''}${r.stderr ? `\n${r.stderr}` : ''}`.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return r.error ? [`${cmd}: ${r.error.code ?? r.error.message}`] : r.status ? [...out.slice(-12), `exit ${r.status}`] : out;
};

/** The words a chapter would be built from, split the way the rules splitter splits a request (sentences, then "and"). */
export function splitWords(text) {
  return String(text ?? '').split(/(?<=[.!?;])\s+|,\s+(?:and|then)\s+/).map((s) => s.trim().replace(/[.;]$/, '')).filter((s) => s.split(' ').length > 2);
}

/** One probe's output lines. */
export async function probe(name, chapter) {
  switch (name) {
    case 'git-log': return run('git', ['log', '--oneline', '-6', '--no-decorate']).map((l) => `git log · ${l}`);
    case 'git-status': { const l = run('git', ['status', '--short', '--branch']); return l.slice(0, 10).map((x) => `git status · ${x}`).concat(l.length > 10 ? [`git status · … ${l.length - 10} more`] : []); }
    case 'sandbox-builds': return run('node', ['apps/console-web/plugins/build-orchestrator/orchestrator.mjs', 'list'], { env: { AXF_BUILD_PROFILE: 'test-sandbox' } }).slice(0, 12).map((l) => `test-sandbox · ${l.replace(/\s{2,}/g, ' · ')}`);
    case 'model-pick': {
      const { modelForWork } = await import('../../../../framework/core/model-policy.mjs');
      return splitWords(chapter?.say).map((s, i) => `model-policy: step ${i + 1} "${s.slice(0, 60)}" → ${modelForWork(s)}`);
    }
    case 'step-split': return splitWords(chapter?.say).map((s, i) => `rules split: s${i + 1} ${s.slice(0, 90)}`);
    case 'plugin-test': return run('node', [join(HERE, 'test.mjs')], { env: { AXF_DEMO_DESIGNER_PROBE: '1' }, timeout: 90000 }).slice(-8);
    case 'theme-check': return run('node', ['framework/cli/check-theme.mjs']).slice(-4);
    case 'agent-slots': return run('node', ['framework/cli/agent-slots.mjs', 'status']).slice(0, 8);
    case 'axhub-ping': return [`axHub (dry run, not sent): POST /api/notes ${JSON.stringify({ kind: 'demo', chapter: chapter?.id ?? '', reason: { title: `Pipeline demo: ${chapter?.title ?? ''}`, description: 'shown in a demo; a live run never sends it' } })}`];
    default: return [`no probe ${name}`];
  }
}

/**
 * Run a demo live: every chapter's probes (or one chapter's), their output as events of that chapter, kept as the
 * demo's recording so the next replay plays what really ran. Answers the recording plus the timeline.
 */
export async function live(id, { chapter = '' } = {}) {
  const d = need(id);
  if (process.env.AXF_DEMO_DESIGNER_PROBE) throw new Error('a live run never runs inside its own self-test probe');
  const byChapter = {};
  for (const c of d.chapters) {
    if (chapter && c.id !== chapter) continue;
    const lines = [];
    for (const p of c.live) lines.push(...P.probeEvents(p, await probe(p, c), { from: 0.4 + lines.length * 0.3, span: Math.max(2, c.seconds - 2) }));
    if (lines.length) byChapter[c.id] = lines.map((e) => ({ ...e, at: Math.min(e.at, c.seconds - 0.2) }));
  }
  const rec = P.recordingOf(d, byChapter, new Date().toISOString());
  writeJson(recFile(id), rec);
  return { ...rec, live: Object.values(byChapter).reduce((s, l) => s + l.length, 0), timeline: P.timeline(rec.demoData) };
}

/* ---------------- CLI ---------------- */

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name, d = '') => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? d : d; };
  const has = (name) => rest.includes(name);
  const BOOL = ['--json', '--play', '--live', '--script'];
  const pos = rest.filter((x, i) => !x.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !BOOL.includes(rest[i - 1])));
  const json = (v) => process.stdout.write(`${JSON.stringify(v, null, has('--json') ? 0 : 2)}\n`);
  if (!cmd || cmd === 'list') { const items = list(); if (has('--json')) json(items); else for (const s of items) console.log(`${s.id.padEnd(28)} ${s.typeLabel.padEnd(28)} ${String(s.chapters).padStart(2)} ch  ${P.clock(s.seconds)}${s.builtIn ? '  built-in' : ''}${s.recorded ? '  recorded' : ''}`); return 0; }
  if (cmd === 'get') { json(need(pos[0])); return 0; }
  if (cmd === 'timeline') { const p = playable(pos[0], { recorded: !has('--script') }); const speed = Number(flag('--speed', 1)) || 1; json({ demo: p.demo, timeline: p.timeline, recordedAt: p.recordedAt, speed, wallSeconds: Math.round((p.timeline.total / speed) * 10) / 10 }); return 0; }
  if (cmd === 'lines') {
    const p = playable(pos[0], { recorded: !has('--script') });
    const lines = P.filterEvents(p.timeline.events, { kinds: flag('--kind') ? flag('--kind').split(',') : [], q: flag('--q') });
    if (has('--json')) json(lines); else for (const e of lines) console.log(P.lineText(e));
    return 0;
  }
  if (cmd === 'save') { json(save(readJson(pos[0]))); return 0; }
  if (cmd === 'copy') { json(copy(pos[0], flag('--as'))); return 0; }
  if (cmd === 'delete') { console.log(remove(pos[0]) ? `pipeline-demos: removed ${pos[0]}` : 'pipeline-demos: nothing to remove'); return 0; }
  if (cmd === 'live') { const r = await live(pos[0], { chapter: flag('--chapter') }); if (has('--json')) json(r); else { for (const e of r.timeline.events.filter((x) => x.source)) console.log(P.lineText(e)); console.log(`pipeline-demos: ${r.live} live line(s) recorded for ${pos[0]}`); } return 0; }
  if (cmd === 'recording') { const r = recording(pos[0]); if (!r) { console.error(`pipeline-demos: no recording of ${pos[0]} yet (run it live first)`); return 2; } json(r); return 0; }
  if (cmd === 'match') { const id = P.matchDemo(pos.join(' '), all()); if (!id) { console.error('pipeline-demos: no demo matches'); return 2; } json({ id, name: get(id).name }); return 0; }
  if (cmd === 'link') { need(pos[0]); json({ id: pos[0], path: P.pipelineLink('', pos[0], { play: has('--play'), mode: has('--live') ? 'live' : '' }), view: 'demonstration-designer' }); return 0; }
  if (cmd === 'types') { json(P.PIPELINE_TYPES); return 0; }
  if (cmd === 'screens') { json(P.SCREENS); return 0; }
  if (cmd === 'probes') { json(P.PROBES); return 0; }
  console.error('usage: pipeline-demos.mjs list | get <id> | timeline <id> [--speed n] | lines <id> [--kind k,k] [--q w] | save <file> | copy <id> [--as id] | delete <id> | live <id> [--chapter c] | recording <id> | match <words> | link <id> [--play] [--live] | types | screens | probes');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exit(await main(process.argv.slice(2))); } catch (e) { console.error(`pipeline-demos: ${e.message}`); process.exit(e.code === 2 ? 2 : 1); }
}
