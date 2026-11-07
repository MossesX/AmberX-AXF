#!/usr/bin/env node
/**
 * Every build has a Plan Studio plan (build-plan@1, Brett, Nov 7 2026). Plain code, no model.
 *
 *   node framework/cli/build-plan.mjs ensure --name <n> --brief <file> [--build id] [--by who]
 *       the launcher's hook: the brief's build gets its record in the builds store (when it has none and the brief says
 *       `# Build: <id>`), its words and addenda, and its plan
 *   node framework/cli/build-plan.mjs refresh <build>    bring an existing plan up to date (never makes one)
 *   node framework/cli/build-plan.mjs tick <build> <stepId> [undo]   tick a step through the orchestrator
 *
 * The plan is a view of the store, so everything here writes the store first. The plan side is reached through whichever
 * plugin provides plans@1 and the orchestrator through orchestrator@1: with neither installed these do nothing.
 * AXF_BUILD_PLANS=off turns the hook off.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadStore, withStore } from './builds-store.mjs';
import { activeProfile } from './persist.mjs';
import { buildForBrief, capture } from './build-origin.mjs';
import { findBuild, nextOrder, normBuild, normStep } from '../plan/builds-store-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(HERE, '..', '..', 'apps', 'console-web', 'plugins');
const MODULES = { 'plans@1': 'plans.mjs', 'orchestrator@1': 'orchestrator.mjs' };

/** The Node module of the plugin that provides a capability (never a folder name), or null. */
export async function provider(capability) {
  for (const d of existsSync(PLUGINS) ? readdirSync(PLUGINS) : []) {
    try {
      const p = JSON.parse(readFileSync(join(PLUGINS, d, 'plugin.json'), 'utf8'));
      const f = join(PLUGINS, d, MODULES[capability]);
      if ((p.provides ?? []).includes(`service:${capability}`) && existsSync(f)) return await import(pathToFileURL(f).href);
    } catch { /* not a plugin */ }
  }
  return null;
}

/** The steps a brief lists (`1. …`), for a build launched with no record. */
export function stepsOfBrief(text) {
  const out = [];
  for (const l of String(text).split('\n')) { const m = /^\s*\d+[.)]\s+(.{3,})$/.exec(l); if (m) out.push(m[1].trim()); }
  return out;
}

/** Make the record of a build launched without one. Only a real build: its brief starts `# Build: <id>`. */
export function recordFromBrief(briefText, { name = '', by = 'launcher', now = new Date().toISOString() } = {}) {
  const id = /^#\s*Build\s*:\s*([a-z0-9][a-z0-9._-]*)/im.exec(briefText)?.[1] ?? '';
  if (!id) return null;
  const profile = activeProfile().id;
  const said = /^##\s*Brett said[^\n]*\n+([^\n]+)/im.exec(briefText)?.[1]?.replace(/^[>"“\s]+|["”\s]+$/g, '') ?? '';
  const texts = stepsOfBrief(briefText);
  let made = null;
  withStore((s) => {
    if (findBuild(s, id)) return s;
    made = normBuild({
      id, title: (said || id).slice(0, 120), detail: `Launched without an orchestrator entry; record made from its brief (${name || id}).`, status: 'running', source: 'headless',
      profiles: [profile], order: { [profile]: nextOrder(s, profile) }, createdAt: now, updatedAt: now,
      steps: (texts.length ? texts : [said || id]).map((text, i) => normStep({ id: `s${i + 1}`, text }, i, { now })),
    }, { now });
    s.builds.push(made);
    return s;
  }, { by, action: 'orchestrator:add', note: id });
  return made?.id ?? id;
}

export async function ensure({ name = '', briefText = '', build = '', by = 'launcher' }) {
  const plans = await provider('plans@1');
  if (!plans) return { ok: true, skipped: 'no plans@1 provider' };
  let b = buildForBrief(loadStore(), { build, name, brief: briefText });
  if (!b) { const id = recordFromBrief(briefText, { name, by }); if (id) b = findBuild(loadStore(), id); }
  if (!b) return { ok: true, skipped: 'not a build' };
  capture({ briefText, build: b.id, name, by });
  return plans.planForBuild(b.id, { by });
}

/** Bring a build's plan up to date. Never makes one. */
export async function refresh(id, { by = 'orchestrator' } = {}) {
  const plans = await provider('plans@1');
  return plans ? plans.planForBuild(id, { by, create: false }) : { ok: true, skipped: 'no plans@1 provider' };
}

/** A tick from Plan Studio: it goes to the orchestrator, and the plan follows. */
export async function tick(id, step, done = true, { by = 'plan-studio' } = {}) {
  const orch = await provider('orchestrator@1');
  if (!orch) throw new Error('no plugin provides orchestrator@1');
  const r = orch.act({ action: 'step', id, step, done }, by);
  await refresh(id, { by });
  return { ok: true, log: r.log };
}

/** Fire and forget from a store writer: a child process, so a tick never waits on Plan Studio. */
export function pushPlan(id) {
  if (!id || process.env.AXF_BUILD_PLANS === 'off') return;
  try { spawn(process.execPath, [fileURLToPath(import.meta.url), 'refresh', id], { detached: true, stdio: 'ignore', cwd: resolve(HERE, '..', '..') }).unref(); } catch { /* the plan catches up on its next read */ }
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] ?? '' : ''; };
  if (process.env.AXF_BUILD_PLANS === 'off') return;
  if (cmd === 'ensure') {
    const f = flag('brief');
    if (!f || !existsSync(f)) throw new Error('ensure --brief <file>');
    const r = await ensure({ name: flag('name'), briefText: readFileSync(f, 'utf8'), build: flag('build'), by: flag('by') || 'launcher' });
    console.log(r.plan ? `plan: ${r.plan.id} (${r.plan.steps.length} steps)` : `plan: none (${r.skipped ?? r.error ?? 'nothing to do'})`);
    return;
  }
  if (cmd === 'refresh') { const r = await refresh(rest[0]); if (r.error) console.error(r.error); return; }
  if (cmd === 'tick') { console.log((await tick(rest[0], rest[1], rest[2] !== 'undo')).log.join('\n')); return; }
  throw new Error('usage: build-plan.mjs ensure|refresh|tick');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
