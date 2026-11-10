/**
 * Activity Monitor — the web side's one store: the server client, the page's view state (tab, search, filters, follow,
 * pause, selection), the live stats the widget shows, and the console capture (taps, console actions, page errors) that
 * writes into the log. Everything here is reachable without the UI through the registered actions and the server routes.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core/runtime';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'activity-monitor';
export const VIEW = 'activity-monitor';
export const api = pluginApi(FOLDER, 'The Activity Monitor');

export type Severity = 'debug' | 'info' | 'success' | 'warning' | 'error';
export interface Ref { type?: string; id?: string; label?: string; action?: string; url?: string; retry?: string }
export interface Ev {
  id: string; at: number; app: string; source: string; kind: string; severity: Severity; sentence: string;
  actor?: string; verb?: string; object?: string; target?: string; via?: string; result?: string; reason?: string;
  chain?: string; parent?: string; ref?: Ref; fixNote?: Ref; raw?: unknown; depth?: number;
}
export interface Chain { chain: string; root: Ev; events: Ev[]; at: number; last: number; severity: Severity; count: number }
export interface Tab { id: string; label: string; count: number }
export interface Stats { total: number; today: number; errors: number; apps: string[]; lastError: Pick<Ev, 'id' | 'at' | 'sentence' | 'app' | 'chain'> | null; last: Pick<Ev, 'id' | 'at' | 'sentence' | 'kind' | 'severity'> | null; rev?: number; rules?: number }
export interface Rule { id: string; name: string; on: Record<string, string>; do: Record<string, string>; enabled: boolean; cooldownS: number; hits: number; lastHit: number; from?: string }
export interface Settings {
  colors: Record<string, string>; density: 'compact' | 'comfortable' | 'roomy'; hide: string[]; captureClicks: boolean; captureActions: boolean;
  captureErrors: boolean; collect: boolean; appTabs: boolean; follow: boolean; pollMs: number; keep: number; view: 'tree' | 'flat';
}

export interface ViewState {
  tab: string; q: string; range: string; kind: string; minSeverity: string; app: string;
  follow: boolean; paused: boolean; view: 'tree' | 'flat'; selected: string; open: Record<string, boolean>; ruleFor: string;
}

const st = {
  view: { tab: 'all', q: '', range: '', kind: '', minSeverity: '', app: '', follow: true, paused: false, view: 'tree', selected: '', open: {}, ruleFor: '' } as ViewState,
  stats: null as Stats | null,
  settings: null as Settings | null,
  rev: 0,
};
const subs = new Set<() => void>();
const emit = () => { st.rev++; subs.forEach((f) => f()); };
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useStore = () => { useSyncExternalStore(subscribe, () => st.rev); return st; };
export const viewState = () => st.view;
export function setView(patch: Partial<ViewState>) { st.view = { ...st.view, ...patch }; emit(); }

export function query(v: ViewState, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const k of ['tab', 'q', 'range', 'kind', 'minSeverity', 'app'] as const) if (v[k]) p.set(k, v[k]);
  for (const [k, val] of Object.entries(extra)) p.set(k, val);
  return p.toString();
}

export async function loadSettings(): Promise<Settings | null> {
  try { st.settings = (await api.call<{ settings: Settings }>('settings')).settings; if (st.settings) st.view = { ...st.view, view: st.settings.view, follow: st.settings.follow }; emit(); } catch { /* the page says so */ }
  return st.settings;
}
export async function saveSettings(patch: Partial<Settings>) { st.settings = (await api.put<{ settings: Settings }>('settings', patch)).settings; emit(); }

/* ------------------------------------------------------------------ capture: what the console page itself does */

const queue: Record<string, unknown>[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
export function emitEvent(e: Record<string, unknown>) {
  queue.push({ app: 'console', source: 'console-ui', at: Date.now(), ...e });
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 1200);
}
async function flush() {
  if (!queue.length) return;
  const events = queue.splice(0, queue.length);
  try { await api.post('emit', { events, source: 'console-ui' }); } catch { /* the log is down: drop rather than loop */ }
}

const TAPPABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [data-fx-row], input[type="checkbox"], summary';
function labelOf(el: Element): string {
  const t = el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || el.getAttribute('data-fx-help') || '';
  return t.replace(/\s+/g, ' ').trim().slice(0, 60);
}
function viewTitle(rt: AxfRuntime): string {
  const v = String((rt.getState() as { view?: string }).view ?? '');
  return v ? v.replace(/[-_.]/g, ' ') : 'the console';
}

/** Hooks the console page: every tap, every console action, every uncaught error. Returns the undo. */
export function installCapture(rt: AxfRuntime): () => void {
  const offs: (() => void)[] = [];
  const on = (k: 'captureClicks' | 'captureActions' | 'captureErrors') => st.settings?.[k] !== false;
  const onClick = (ev: MouseEvent) => {
    if (!on('captureClicks')) return;
    const t = ev.target instanceof Element ? ev.target.closest(TAPPABLE) : null;
    if (!t || t.closest('[data-axp-am-skip]')) return; // taps inside the log itself would only echo
    const label = labelOf(t);
    if (!label) return;
    emitEvent({ kind: 'click', severity: 'info', actor: 'You', verb: 'tapped', object: `“${label}”`, reason: '', sentence: `You tapped “${label}” on ${viewTitle(rt)}`, raw: { tag: t.tagName.toLowerCase(), id: t.id || undefined, view: viewTitle(rt) } });
  };
  document.addEventListener('click', onClick, true);
  offs.push(() => document.removeEventListener('click', onClick, true));

  // console actions (menus, shortcuts, toolbars, remote callers): wrap this runtime's bus, restored on uninstall
  const bus = rt.actions as unknown as { dispatch: (spec: string, ctx: unknown) => boolean; get: (id: string) => { meta: { label: string; module?: string } } | undefined };
  const orig = bus.dispatch;
  bus.dispatch = function dispatch(spec: string, ctx: unknown) {
    let ok = false; let err: unknown = null;
    try { ok = orig.call(this, spec, ctx); } catch (e) { err = e; }
    if (on('captureActions') && !spec.startsWith('activity-monitor.')) {
      const id = spec.split(':')[0] ?? spec; const meta = bus.get(id)?.meta;
      const label = meta?.label || spec;
      emitEvent({ kind: 'action', actor: 'You', verb: 'ran', object: `“${label}”${spec.includes(':') ? ` (${spec.split(':').slice(1).join(':')})` : ''}`,
        result: err ? 'failed' : ok ? 'done' : 'refused', reason: err ? String((err as Error)?.message ?? err) : '', ref: { type: 'action', id: spec, action: spec, retry: spec, label }, raw: { spec, module: meta?.module } });
    }
    if (err) throw err;
    return ok;
  };
  offs.push(() => { bus.dispatch = orig; });

  const onError = (e: ErrorEvent) => { if (on('captureErrors')) emitEvent({ kind: 'error', severity: 'error', sentence: `The console page hit an error on ${viewTitle(rt)}`, reason: e.message, raw: { file: e.filename, line: e.lineno, col: e.colno } }); };
  const onReject = (e: PromiseRejectionEvent) => { if (on('captureErrors')) emitEvent({ kind: 'error', severity: 'error', sentence: `A request in the console failed on ${viewTitle(rt)}`, reason: String((e.reason as Error)?.message ?? e.reason).slice(0, 300) }); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onReject);
  offs.push(() => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onReject); });
  return () => offs.forEach((f) => f());
}

/* ------------------------------------------------------------------ live stats + rule actions (one poller for the app) */

const ranRuleActions = new Set<string>();
let ruleSince = Date.now();
export function startPolling(rt: AxfRuntime): () => void {
  let stop = false; let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stop) return;
    try {
      const s = await api.call<Stats>('stats');
      st.stats = s; rt.setBadge('activity-monitor.errors', s.errors); emit();
      // rules whose answer is a console action: run each once, in this console
      const r = await api.call<{ events: Ev[] }>(`events?kind=rule&since=${ruleSince}&hide=&limit=50`);
      for (const e of r.events ?? []) {
        ruleSince = Math.max(ruleSince, e.at);
        const act = e.ref?.action;
        if (act && e.result === 'waiting' && !ranRuleActions.has(e.id)) { ranRuleActions.add(e.id); rt.dispatch(act); }
      }
    } catch { /* plugin off or server down: the widget shows nothing */ }
    timer = setTimeout(() => void tick(), Math.max(1500, st.settings?.pollMs ?? 4000) * 2);
  };
  void loadSettings().then(() => tick());
  return () => { stop = true; if (timer) clearTimeout(timer); };
}
export const stats = () => st.stats;

export function exportLog(fmt: string) {
  return api.download(`export?${query(st.view, { format: fmt })}`, `activity-log.${fmt}`);
}

export const when = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const whenFull = (at: number) => new Date(at).toLocaleString();
export const ago = (at: number) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
