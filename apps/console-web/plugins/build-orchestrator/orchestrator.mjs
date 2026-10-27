#!/usr/bin/env node
/**
 * Build orchestrator CLI. The tracker is a repo file, `_claude/builds/orchestrator.json` (orchestrator@1), so any
 * session on any machine or account reads it and carries the build on (it syncs with the hub through claude-sync).
 * Each build profile (build-profiles@1, framework/cli/profiles.mjs) has its own tracker; AXF_ORCH_FILE overrides the path.
 *
 *   node apps/console-web/plugins/build-orchestrator/orchestrator.mjs            list (one line per build)
 *   … next [id]                       what to do next (default: the first build with work left)
 *   … brief <id>                      the current phase's brief, ready to paste as a first message
 *   … act <action> <id> [args…]       step <id> <stepId> [done|undo] · approve <id> <phase> · status <id> <status>
 *                                     note <id> <text> · archive|hide|unhide|remove <id>
 *   … act --json '{"action":…}'       any change from orchestrator-core.mjs apply()
 *   … where                           the tracker file in use
 *   --json on any command prints JSON (the console server uses this).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/orchestrator-core.mjs';
import { isMigrated, readOrchestratorState, writeOrchestratorState } from '../../../../framework/cli/builds.mjs';
import { orchestratorPath } from '../../../../framework/cli/persist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
/** The active build profile's tracker (main framework = _claude/builds/orchestrator.json; others under _claude/builds/profiles/<id>/). */
export const trackerFile = () => process.env.AXF_ORCH_FILE || orchestratorPath();

/** builds@1 (Oct 27 2026): once plan.json carries the dataset the tracker is a view of it (orchestrator.json is then a generated export); before that, the tracker file as before. */
export function load() {
  if (isMigrated()) return core.normalizeState(readOrchestratorState());
  const f = trackerFile();
  return core.normalizeState(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : core.emptyState());
}
export function save(state) {
  if (isMigrated()) { writeOrchestratorState(state); return; }
  const f = trackerFile(); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`); renameSync(tmp, f);
}
export function act(change) { const r = core.apply(load(), change); save(r.state); return r; }

function line(b, rules) {
  const p = core.progress(b); const n = core.nextUp(b, rules);
  const next = n.done ? 'done' : n.needsApproval ? `approve ${n.phase.from}→${n.phase.model}` : `${n.step?.model} ${n.step?.id}`;
  return `${b.id.padEnd(34)} ${core.STATUS_LABEL[b.status].padEnd(15)} ${String(p.done).padStart(2)}/${p.total} steps · ${core.formatMinutes(p.minutesLeft) || '0 min'} left · next: ${next}`;
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'list', ...rest] = args;
  const s = load();
  if (cmd === 'where') return out({ ok: true, file: trackerFile() }, trackerFile());
  if (cmd === 'list' || cmd === 'state') return out({ ok: true, state: s }, s.builds.filter((b) => !b.hidden && b.status !== 'archived').map((b) => line(b, s.rules)).join('\n') || 'No builds.');
  if (cmd === 'next') {
    const b = rest[0] ? s.builds.find((x) => x.id === rest[0]) : s.builds.find((x) => !x.hidden && !['complete', 'archived'].includes(x.status));
    if (!b) return out({ ok: true, next: null }, 'Nothing left to build.');
    const n = core.nextUp(b, s.rules);
    return out({ ok: true, id: b.id, ...n }, `${b.title} (${b.id})\n${n.done ? 'complete' : n.needsApproval ? `Needs Brett's approval: switch ${n.phase.from} → ${n.phase.model} (phase ${n.phase.index + 1})` : `Next: ${n.step.id} on ${n.step.model} — ${n.step.text}`}`);
  }
  if (cmd === 'brief') { const b = s.builds.find((x) => x.id === rest[0]); if (!b) throw new Error(`no build "${rest[0]}"`); const t = core.brief(b, s.rules); return out({ ok: true, brief: t }, t); }
  if (cmd === 'act') {
    let change;
    if (rest[0]?.startsWith('{')) change = JSON.parse(rest[0]);
    else {
      const [action, id, a, b] = rest;
      change = action === 'step' ? { action, id, step: a, done: b !== 'undo' } : action === 'approve' ? { action, id, phase: Number(a) }
        : action === 'status' ? { action, id, status: a } : action === 'note' ? { action, id, text: rest.slice(2).join(' ') } : { action, id };
    }
    const r = act(change);
    return out({ ok: true, state: r.state, build: r.build, log: r.log }, r.log.join('\n'));
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
