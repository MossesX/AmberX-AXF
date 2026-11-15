#!/usr/bin/env node
/**
 * build-priority — the priority tag on every build (framework/core/build-priority.mjs; a build's `priority` in the store,
 * unset = worked out on read). A change is one store write across all profiles, and the build's waiting agent-slots
 * entries follow at once; the merge queue reads it from main at its next round.
 *
 *   node framework/cli/build-priority.mjs list [--open] [--json]           every build with its tag and waiting count
 *   … get <build> [--json]                                                 one build: priority + what is waiting on it
 *   … waiting <build> [--json]                                             what is waiting on it
 *   … set <build>… <urgent|high|normal|low|P0-P3> [--by who] [--json]      <build> = id or (spoken) name
 *   … slot --name n [--brief file]                                         prints "<slot level> <build id>" (launcher)
 *
 * --sources reads extra sources as JSON on stdin (slots, mergeQueue, pulls, ui, plans): the console passes what its
 * plugins know. Without it the CLI has only the store, agent-slots and the plan's dependencies; the whole list comes from
 * the console's orchestrator plugin (its priority routes, the MCP and voice commands).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIORITIES, effectivePriority, normPriority, priorityLabel, priorityMap, resolveBuild, slotLevel, waitingOn } from '../core/build-priority.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { findBuild } from './model-gate.mjs';
import { LEVELS, reprioritise, loadState } from './agent-slots.mjs';
import { REPO_ROOT } from './persist.mjs';

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const liveBuilds = () => loadStore().builds.filter((b) => !b.deleted);

function localSources() {
  const out = {};
  try { const s = loadState(); out.slots = { running: s.running, queue: [...s.queue].filter((q) => q.state === 'waiting').sort((a, b) => LEVELS.indexOf(a.priority) - LEVELS.indexOf(b.priority) || a.seq - b.seq) }; } catch { /* no store here */ }
  out.epics = readJson(join(REPO_ROOT, 'framework/plan/plan.json'))?.features ?? [];
  return out;
}
const stdinJson = () => { try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; } };
export const gather = (extra = {}) => ({ ...localSources(), ...extra, builds: liveBuilds() });

/** Sets one priority on many builds: one store write (journalled, live on main), then the slots queue follows. */
export function setPriority(names, value, by = process.env.AXF_ACTOR || process.env.AXF_SURFACE || 'cli') {
  const p = normPriority(value);
  if (!p) throw new Error(`unknown priority "${value}" (urgent, high, normal, low or ${PRIORITIES.join(', ')})`);
  const builds = liveBuilds();
  const ids = names.map((n) => { const b = resolveBuild(builds, n); if (!b) throw new Error(`no build "${n}"`); return b.id; });
  const at = new Date().toISOString();
  withStore((s) => {
    for (const b of s.builds) if (ids.includes(b.id) && b.priority !== p) { b.priority = p; b.updatedAt = at; b.rev = (b.rev || 1) + 1; }
    return s;
  }, { by, action: 'priority', note: `${ids.join(', ')} → ${priorityLabel(p)}` });
  let moved = 0;
  for (const id of ids) { try { moved += reprioritise(id, slotLevel(p)); } catch { /* no slots store on this machine */ } }
  return { ok: true, ids, priority: p, label: priorityLabel(p), slotsMoved: moved };
}

async function main(argv) {
  const json = argv.includes('--json');
  const fromStdin = argv.includes('--sources');
  const args = argv.filter((a, i) => a !== '--json' && a !== '--open' && a !== '--sources' && argv[i - 1] !== '--sources');
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const [cmd = 'list', ...rest] = args;
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const sources = () => gather(fromStdin ? stdinJson() : {});
  if (cmd === 'slot') {
    let brief = ''; try { brief = readFileSync(opt('brief'), 'utf8'); } catch { /* no brief */ }
    const b = findBuild(loadStore(), { name: opt('name'), brief });
    return void (b && console.log(`${slotLevel(effectivePriority(b))} ${b.id}`));
  }
  if (cmd === 'list') {
    const s = sources(); const map = priorityMap(s);
    const open = argv.includes('--open');
    const rows = s.builds.filter((b) => !open || !['complete', 'archived'].includes(b.status));
    return print({ ok: true, map }, rows.map((b) => `${priorityLabel(map[b.id].priority).padEnd(7)} ${String(map[b.id].waiting || '').padStart(2)} ${b.id}`).join('\n'));
  }
  if (cmd === 'get' || cmd === 'waiting') {
    const s = sources(); const b = resolveBuild(s.builds, rest.join(' '));
    if (!b) throw new Error(`no build "${rest.join(' ')}"`);
    const rows = waitingOn(b.id, s); const p = effectivePriority(b);
    return print({ ok: true, id: b.id, title: b.title, priority: p, label: priorityLabel(p), waiting: rows },
      [`${b.title} (${b.id}): ${priorityLabel(p)}, ${rows.length} waiting`, ...rows.map((r) => `  ${r.kind.padEnd(5)} ${r.id} ${r.title} · ${r.why}`)].join('\n'));
  }
  if (cmd === 'set') {
    const names = rest.filter((a, i) => a !== '--by' && rest[i - 1] !== '--by');
    const value = names.pop();
    if (!names.length) throw new Error('set <build>… <priority>');
    const r = setPriority(names, value, opt('by') || undefined);
    return print(r, `${r.ids.join(', ')} → ${r.label}${r.slotsMoved ? ` (${r.slotsMoved} moved in the agent queue)` : ''}`);
  }
  throw new Error('usage: build-priority.mjs list [--open] | get <build> | waiting <build> | set <build>… <priority> | slot --name n [--brief f]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
