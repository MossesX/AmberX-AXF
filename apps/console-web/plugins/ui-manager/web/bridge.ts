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
 *   ui-manager.apply | ui-manager.discard               the window's pending changes: open the exit summary / drop them
 *   ui-manager.log                                      show the change log; ui-manager.undo:<change id> undoes one entry
 *   ui-manager.export[:<id or words>]                   export the element (default: everything changed) as an asset library:
 *                                                       published to the shared hub library, the package downloaded
 */
import type { AxfRuntime } from '@console/axf/core';
import { rankElements } from '../lib/say.mjs';
import { refreshLive } from './apply';
import { getUi, setUi, type ViewMode } from './state';
import { FOLDER, fetchJson, snapshotAll } from './useElements';
import { pluginFetch } from '@console/plugins';
import { openUiManager } from './window';
import { askApply, discardDraft, getDraft } from './draft';

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

interface ExportAnswer { library?: { id: string; name: string; assets: unknown[]; elements: unknown[] }; package?: string; published?: { hub: string }; error?: string }

/**
 * Export as an asset library (ui-library@1): the elements named (default: everything that carries an override) with
 * the assets they read, their token values and a manifest. Published to the shared hub library, then the package is
 * downloaded through the browser (the same file `GET library/<id>/download` serves).
 */
export async function exportLibrary(rt: AxfRuntime, elements: string[] = [], { name = '', download = true }: { name?: string; download?: boolean } = {}): Promise<ExportAnswer> {
  const r = await post<ExportAnswer>('library/export', { elements, name, publish: true, by: BY });
  if (r.error || !r.library) { rt.toast(r.error ?? 'Nothing to export: change something first.', 'warning', 'UI Manager'); return r; }
  rt.toast(`${r.library.name}: ${r.library.assets.length} asset(s) from ${r.library.elements.length} element(s), published to the hub library.`, 'success', 'UI Manager');
  if (download && typeof document !== 'undefined') {
    try {
      const res = await pluginFetch(FOLDER, `library/${encodeURIComponent(r.library.id)}/download`);
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement('a');
        link.href = url; link.download = r.package ?? `${r.library.id}.ui-library.json`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch { /* the package stays on the hub; the CLI and REST serve it too */ }
  }
  return r;
}

export function registerActions(rt: AxfRuntime): void {
  const a = rt.actions;
  a.register('ui-manager.export', (args) => { const w = args.join(':').trim(); void exportLibrary(rt, w ? [w] : []); }, { label: 'UI Manager: export as an asset library (element id or words; default: everything changed)', params: true, effect: 'write' });
  a.register('ui-manager.select', (args) => { const w = args.join(':').trim(); if (w) void selectWords(rt, w); else openUiManager(rt); }, { label: 'UI Manager: select an element (id or words)', params: true, effect: 'navigate' });
  a.register('ui-manager.say', (args) => { const t = args.join(':').trim(); if (t) void say(rt, t); }, { label: 'UI Manager: say it ("select the main toolbar, set its transparency to 80")', params: true, effect: 'write' });
  a.register('ui-manager.view', ([v]) => {
    if (!VIEWS.includes(v as ViewMode)) { rt.toast(`View ${v ?? ''}: use row, panel or grid.`, 'warning', 'UI Manager'); return; }
    setUi({ view: v as ViewMode }); openUiManager(rt); void post('view', { view: v, by: BY });
  }, { label: 'UI Manager: view (row, panel, grid)', params: true, effect: 'navigate' });
  a.register('ui-manager.pick', () => { openUiManager(rt); setUi({ picking: !getUi().picking }); }, { label: 'UI Manager: pick an element on screen', effect: 'navigate' });
  a.register('ui-manager.apply', () => { openUiManager(rt); if (getDraft().summary.length) askApply(); else rt.toast('Nothing pending.', 'info', 'UI Manager'); }, { label: 'UI Manager: apply the pending changes (shows the exit summary first)', effect: 'navigate' });
  a.register('ui-manager.discard', () => { void discardDraft(); setUi((s) => ({ rev: s.rev + 1 })); }, { label: 'UI Manager: discard the pending changes', effect: 'write' });
  a.register('ui-manager.log', () => { openUiManager(rt); setUi({ log: true }); }, { label: 'UI Manager: show the change log', effect: 'navigate' });
  a.register('ui-manager.undo', (args) => {
    const id = args.join(':').trim();
    if (!id) { openUiManager(rt); setUi({ log: true }); return; }
    void post<{ error?: string }>('undo', { id, by: 'console' }).then(async (r) => { if (r.error) { rt.toast(r.error, 'warning', 'UI Manager'); return; } await refreshLive(); setUi((s) => ({ rev: s.rev + 1 })); rt.toast(`Undid ${id}.`, 'success', 'UI Manager'); });
  }, { label: 'UI Manager: undo one change-log entry (change id)', params: true, effect: 'write' });
  a.register('ui-manager.search', (args) => { openUiManager(rt); setUi({ q: args.join(':') }); }, { label: 'UI Manager: search elements', params: true, effect: 'navigate' });
}
