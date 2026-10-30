#!/usr/bin/env node
/**
 * Build Breaker asks CLI (build-asks@1): keeps the list of everything Brett asked for current, from any session.
 *
 *   node apps/console-web/plugins/build-breaker/asks.mjs list [--app A] [--plugin P] [--status S] [--q text] [--json]
 *   node apps/console-web/plugins/build-breaker/asks.mjs add --title "…" --app <app> [--plugin P] [--plain "…"] [--quote "…"]
 *        [--status pending] [--model Opus|Fable] [--minutes N] [--cost USD] [--branch B] [--pr N] [--profile P]
 *        [--sources "a,b"] [--asked-at ISO] [--approx] [--id ID]
 *   node apps/console-web/plugins/build-breaker/asks.mjs set-status <id> <status> [--branch B] [--pr N] [--minutes N] [--cost USD] [--note "…"]
 *   node apps/console-web/plugins/build-breaker/asks.mjs check | export --json | paths
 *
 * Statuses: built, in-progress, pending, planned, held, removed, waiting-push, waiting-pull, waiting-deploy,
 * waiting-approve. Reads the seed in the repo (data/asks.jsonl) merged with the live copy in the plugin's data folder
 * (newest `updatedAt` wins). Writes go to both, so the change is live in the console and ready to commit
 * (--no-seed: data folder only). Unknown fields are always kept.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bb from './web/bb-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
export const SEED = process.env.AXF_BUILD_BREAKER_SEED || join(HERE, 'data/asks.jsonl');
export const MIRROR = process.env.AXF_BUILD_BREAKER_MIRROR || join(resolve(ROOT, manifest.lifecycle.dataDir), 'asks.jsonl');

const readDoc = (f) => (existsSync(f) ? bb.parseAny(readFileSync(f, 'utf8')) : null);
const writeDoc = (f, doc) => { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp`; writeFileSync(tmp, bb.toJsonl(doc)); renameSync(tmp, f); };

/** Seed + mirror, merged. */
export function load() {
  const seed = readDoc(SEED), mirror = readDoc(MIRROR);
  const doc = bb.mergeDocs(seed, mirror) ?? { $axf: bb.SCHEMA, apps: [], plugins: [], asks: [] };
  return { doc, files: { seed: relative(ROOT, SEED), mirror: relative(ROOT, MIRROR), seedFound: !!seed, mirrorFound: !!mirror } };
}
/** Copy the seed into the data folder when it has no copy yet (install). */
export function mirrorSeed() {
  if (existsSync(MIRROR) || !existsSync(SEED)) return false;
  writeDoc(MIRROR, readDoc(SEED));
  return true;
}
function save(doc, { seed = true } = {}) {
  writeDoc(MIRROR, doc);
  if (seed) writeDoc(SEED, doc);
}

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[k] = true; else { flags[k] = next; i++; }
  }
  return { pos, flags };
}
const out = (json, v, text) => { if (json) console.log(JSON.stringify(v)); else console.log(text); };

async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0] ?? 'list';
  const json = !!flags.json;
  const { doc, files } = load();
  if (cmd === 'export') return out(true, { ok: true, doc, files, problems: bb.checkDoc(doc).slice(0, 50) });
  if (cmd === 'paths') return out(json, { ok: true, ...files }, `seed   ${files.seed}${files.seedFound ? '' : ' (missing)'}\nmirror ${files.mirror}${files.mirrorFound ? '' : ' (not made yet)'}`);
  if (cmd === 'check') {
    const problems = bb.checkDoc(doc);
    out(json, { ok: !problems.length, asks: doc.asks.length, problems }, problems.length ? problems.join('\n') : `${doc.asks.length} asks, all fine`);
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (cmd === 'list') {
    let asks = doc.asks.filter((a) => (!flags.app || a.app === flags.app) && (!flags.plugin || a.plugin === flags.plugin));
    asks = bb.sortAsks(bb.filterAsks(asks, { q: typeof flags.q === 'string' ? flags.q : '', statuses: typeof flags.status === 'string' ? flags.status.split(',') : [] }), 'newest');
    return out(json, { ok: true, count: asks.length, asks }, asks.map((a) => `${a.askedAt.slice(0, 16).replace('T', ' ')}  ${bb.statusInfo(a.status).label.padEnd(20)} ${a.id}  ${a.title}`).join('\n') || 'no asks');
  }
  if (cmd === 'add') {
    if (!flags.title || !flags.app) throw new Error('add needs --title and --app');
    const input = {
      title: flags.title, app: flags.app, plugin: flags.plugin || null, plain: flags.plain || '', quote: flags.quote || '', status: flags.status || 'pending',
      model: flags.model || 'Opus', minutes: flags.minutes ?? null, costUsd: flags.cost ?? null, branch: flags.branch || '', pr: flags.pr || null,
      profile: flags.profile || 'main-framework', sources: flags.sources || [], askedAt: flags['asked-at'] || undefined, timeApprox: !!flags.approx, id: flags.id || undefined,
    };
    const ask = bb.makeAsk(input, doc);
    const problems = bb.checkAsk(ask, doc);
    if (problems.length) throw new Error(problems.join('; '));
    save({ ...doc, asks: [...doc.asks, ask] }, { seed: !flags['no-seed'] });
    return out(json, { ok: true, ask }, `added ${ask.id}`);
  }
  if (cmd === 'set-status' || cmd === 'set') {
    const [, id, status] = pos;
    if (!id) throw new Error(`${cmd} needs an ask id`);
    const patch = {};
    if (status) patch.status = status;
    for (const k of ['branch', 'pr', 'minutes', 'note', 'model', 'title', 'plain', 'quote', 'profile']) if (typeof flags[k] === 'string') patch[k] = flags[k];
    if (typeof flags.cost === 'string') patch.costUsd = flags.cost;
    if (!Object.keys(patch).length) throw new Error('nothing to change');
    const next = bb.patchAsk(doc, id, patch);
    save(next, { seed: !flags['no-seed'] });
    const a = next.asks.find((x) => x.id === id);
    return out(json, { ok: true, ask: a }, `${id}: ${bb.statusInfo(a.status).label}`);
  }
  throw new Error(`unknown command ${cmd} (list | add | set-status | check | export | paths)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message }));
    else console.error(`asks: ${e.message}`);
    process.exitCode = 1;
  });
}
