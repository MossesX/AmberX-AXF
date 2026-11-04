import { useSyncExternalStore } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import type { Candidate } from './packager-core.mjs';

/*
 * Drag steps between builds anywhere (build-optimize@1 `move`, Brett Nov 4 2026, addendum 1). A step row anywhere (the
 * orchestrator page, a tab, a pane, a floating window, another console or Molly window) is dragged with one shared
 * payload: MIME STEP_MIME = { $axf: 'build-steps@1', keys: ['<build>/<uid>'…] } (plus a text/plain copy), so any steps
 * list that accepts it can take the drop. Several ticked steps drag together (shift/ctrl-click a step's grip to pick
 * it). Drop position = order in the target build. The server refuses running steps; a missing prerequisite asks
 * "move prerequisites too?". Every move is one store write with one undo, and every open window reloads (a
 * BroadcastChannel), so the orchestrator re-plans from the new store.
 */

export const STEP_MIME = 'application/x-axf-build-steps';
export const BUILDS_CHANNEL = 'axf-builds';
const RELOAD_EVENT = 'axf-orchestrator-reload'; // ui.tsx RELOAD_EVENT
const api = pluginApi('build-orchestrator', 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

// ---------------------------------------------------------------- multi-select (shared by every steps list in this window)

let picked = new Set<string>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function togglePick(key: string) { picked = new Set(picked); if (picked.has(key)) picked.delete(key); else picked.add(key); emit(); }
export function clearPicks() { if (picked.size) { picked = new Set(); emit(); } }
export function usePicked(): Set<string> { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => picked); }

// ---------------------------------------------------------------- the payload

export function dragStart(e: React.DragEvent, key: string) {
  const keys = picked.has(key) ? [...picked] : [key];
  const body = JSON.stringify({ $axf: 'build-steps@1', keys });
  e.dataTransfer.setData(STEP_MIME, body);
  e.dataTransfer.setData('text/plain', `axf-steps:${body}`);
  e.dataTransfer.effectAllowed = 'move';
}
export const accepts = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(STEP_MIME) || Array.from(e.dataTransfer.types).includes('text/plain');
export function readDrop(e: React.DragEvent): string[] {
  const raw = e.dataTransfer.getData(STEP_MIME) || e.dataTransfer.getData('text/plain').replace(/^axf-steps:/, '');
  try { const j = JSON.parse(raw); return j?.$axf === 'build-steps@1' && Array.isArray(j.keys) ? j.keys.filter((k: unknown) => typeof k === 'string').slice(0, 100) : []; } catch { return []; }
}

/** Every window reloads its builds after a move (this one by event, the others by channel). */
export function reloadEverywhere() {
  window.dispatchEvent(new Event(RELOAD_EVENT));
  try { const ch = new BroadcastChannel(BUILDS_CHANNEL); ch.postMessage({ $axf: 'build-steps@1', reload: true }); ch.close(); } catch { /* old browser */ }
}
/** Installed once per window (index.tsx register): another window's move reloads this one. */
export function listenEverywhere() {
  try { const ch = new BroadcastChannel(BUILDS_CHANNEL); ch.onmessage = (m) => { if (m.data?.reload) window.dispatchEvent(new Event(RELOAD_EVENT)); }; } catch { /* old browser */ }
}

/** Waiting steps the moved ones need that stay behind (steps of one build run in order). */
export async function prerequisites(keys: string[], to: string): Promise<string[]> {
  try {
    const r = await api.call<{ candidates: Candidate[] }>('package/candidates');
    const byKey = new Map((r.candidates ?? []).map((c) => [c.key, c]));
    const need: string[] = [];
    for (const k of keys) {
      const c = byKey.get(k); if (!c || c.build === to) continue;
      for (const n of [...c.before.map((x) => (typeof x === 'string' ? x : x.key)), ...c.after]) if (byKey.has(n) && !keys.includes(n) && !need.includes(n) && byKey.get(n)!.build !== to) need.push(n);
    }
    return need;
  } catch { return []; }
}

export async function moveNow(rt: AxfRuntime, keys: string[], to: string, index: number | null) {
  try {
    const r = await api.post<{ log: string[]; run: { id: string }; archived: string[] }>('optimize/move', { keys, to, index });
    rt.toast(`${(r.log ?? []).join('; ')}. Undo: Optimize builds → Undo.`, 'success');
    rt.terminal.log('orchestrator', `move ${keys.join(', ')} → ${to}: ${(r.log ?? []).join('; ')} (run ${r.run?.id})`, 'ok');
    clearPicks(); reloadEverywhere();
    return true;
  } catch (e) { rt.toast((e as Error).message, 'danger'); return false; }
}

/** A drop: ask about missing prerequisites first, then move. */
export async function dropSteps(rt: AxfRuntime, keys: string[], to: string, index: number | null) {
  if (!keys.length) return;
  const need = await prerequisites(keys, to);
  if (need.length) { rt.openDialog('build-orchestrator.move-steps', { keys, to, index: index ?? -1, need }); return; }
  await moveNow(rt, keys, to, index);
}

/** The "move prerequisites too?" question. */
export function MoveStepsDialog({ keys, to, index, need, close }: { keys: string[]; to: string; index: number; need: string[]; close: () => void }) {
  const rt = useRuntime();
  const at = index >= 0 ? index : null;
  const go = async (ks: string[]) => { if (await moveNow(rt, ks, to, at)) close(); };
  return (
    <div className="fx-stack oc-opt">
      <p className="pl-note is-warn"><Icon name="alert" size={14} />{keys.length === 1 ? 'This step needs' : 'These steps need'} {need.length} step{need.length === 1 ? '' : 's'} that would stay behind in {[...new Set(need.map((k) => k.slice(0, k.lastIndexOf('/'))))].join(', ')}:</p>
      <ul className="fx-small fx-mono">{need.map((k) => <li key={k}>{k}</li>)}</ul>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="layers" onClick={() => void go([...need, ...keys])}>Move prerequisites too</Button>
        <Button icon="arrow-right" onClick={() => void go(keys)}>Move only {keys.length === 1 ? 'this step' : 'these'}</Button>
        <Button onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}
