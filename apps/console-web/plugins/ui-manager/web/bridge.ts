/*
 * The UI Manager without its window: console actions (control@1 console domain → console_action, voice, the command
 * palette, `axf console action …`) and the bridge that keeps the window and the server's selection in step, so
 * "select the main toolbar, set its transparency to 80" from REST / MCP / CLI / voice shows in the open window too.
 *
 *   ui-manager.open | ui-manager.close                  the floating window
 *   ui-manager.select:<id or words>                     open the window on that element (main toolbar, target:view:x/button:y)
 *   ui-manager.say:<words>                              what a person says, run by the server part (lib/say.mjs)
 *   ui-manager.view:<row|panel|grid>                    how a selected element opens
 *   ui-manager.pick                                     inspector: the next click on the console selects
 *   ui-manager.search:<words>                           search the element tree
 */
import type { AxfRuntime } from '@console/axf/core';
import { rankElements } from '../lib/say.mjs';
import { refreshLive } from './apply';
import { getUi, setUi, type ViewMode } from './state';
import { fetchJson, snapshotAll } from './useElements';
import { openUiManager } from './window';

interface SelectAnswer { selected?: string; label?: string; error?: string }
interface SayAnswer { steps?: { op: string; selected?: string; element?: string; label?: string; propLabel?: string; value?: unknown; view?: ViewMode }[]; selected?: string; error?: string }
interface StateAnswer { element?: string; view?: ViewMode; by?: string; at?: string; error?: string }

const post = <T>(path: string, body: unknown) => fetchJson<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const VIEWS: ViewMode[] = ['row', 'panel', 'grid'];
const BY = 'window';

/** The last server state the window has applied, so its own writes are not read back as news. */
let seenAt = '';

/** Tell the server what the window selected (readable through GET state / MCP ui-manager_state / the CLI). */
export function shareSelection(id: string): void {
  if (id) void post<StateAnswer>('select', { element: id, by: BY }).then((r) => { if (r.at) seenAt = r.at; }, () => {});
}

/** Pull the server's selection and view into the window when something outside changed them. */
export async function pullState(): Promise<void> {
  const s = await fetchJson<StateAnswer>('state').catch(() => ({ error: 'off' } as StateAnswer));
  if (s.error || !s.at || s.at === seenAt) return;
  seenAt = s.at;
  if (s.by === BY) return;
  setUi((u) => ({ ...(s.element && s.element !== u.selected ? { selected: s.element } : {}), ...(s.view && s.view !== u.view ? { view: s.view } : {}) }));
}

async function selectWords(rt: AxfRuntime, words: string): Promise<void> {
  openUiManager(rt);
  const { all } = await snapshotAll(rt);
  // the browser knows the live targets too: an exact id, then the best words match; the server resolves the rest
  const hit = all.find((e) => e.id === words) ?? rankElements(all, words)[0];
  if (hit) { setUi((s) => ({ selected: hit.id, collapsed: s.collapsed.filter((c) => c !== hit.category) })); shareSelection(hit.id); return; }
  const r = await post<SelectAnswer>('select', { element: words, by: 'console' });
  if (r.error || !r.selected) { rt.toast(r.error ?? `No element matches "${words}".`, 'warning', 'UI Manager'); return; }
  setUi({ selected: r.selected });
}

async function say(rt: AxfRuntime, text: string): Promise<void> {
  const r = await post<SayAnswer>('say', { text, by: 'console' });
  if (r.error) { rt.toast(r.error, 'warning', 'UI Manager'); return; }
  openUiManager(rt);
  const view = r.steps?.map((s) => s.view).filter(Boolean).pop();
  setUi((s) => ({ ...(r.selected ? { selected: r.selected } : {}), ...(view ? { view } : {}), rev: s.rev + 1 }));
  await refreshLive();
  const sets = (r.steps ?? []).filter((s) => s.op === 'set').map((s) => `${s.label} ${s.propLabel} → ${String(s.value)}`);
  rt.toast(sets.length ? sets.join(' · ') : 'Done.', 'success', 'UI Manager');
}

export function registerActions(rt: AxfRuntime): void {
  const a = rt.actions;
  a.register('ui-manager.select', (args) => { const w = args.join(':').trim(); if (w) void selectWords(rt, w); else openUiManager(rt); }, { label: 'UI Manager: select an element (id or words)', params: true, effect: 'navigate' });
  a.register('ui-manager.say', (args) => { const t = args.join(':').trim(); if (t) void say(rt, t); }, { label: 'UI Manager: say it ("select the main toolbar, set its transparency to 80")', params: true, effect: 'write' });
  a.register('ui-manager.view', ([v]) => {
    if (!VIEWS.includes(v as ViewMode)) { rt.toast(`View ${v ?? ''}: use row, panel or grid.`, 'warning', 'UI Manager'); return; }
    setUi({ view: v as ViewMode }); openUiManager(rt); void post('view', { view: v, by: BY });
  }, { label: 'UI Manager: view (row, panel, grid)', params: true, effect: 'navigate' });
  a.register('ui-manager.pick', () => { openUiManager(rt); setUi({ picking: !getUi().picking }); }, { label: 'UI Manager: pick an element on screen', effect: 'navigate' });
  a.register('ui-manager.search', (args) => { openUiManager(rt); setUi({ q: args.join(':') }); }, { label: 'UI Manager: search elements', params: true, effect: 'navigate' });
}
