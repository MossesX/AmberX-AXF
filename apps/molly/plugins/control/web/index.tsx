import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { EMBED_MESSAGE, parseEmbedMessage, type EmbedMessage } from '../../../src/axf/core/engines/embed';
import { hostCatalog, hostRunSpec, instanceTitle, parseInstance, type HostCatalogItem, type HostCatalogSource, type HostRun } from '../../../src/axf/core/engines/molly-shell';
import { consoleCatalogFrom } from '../../../src/axf/core/engines/console-commands.mjs';
import { Container, Note, Switch, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyState } from '../../../src/actions';
import { MOLLY_APPS, mollyApp } from '../../../src/molly/apps';
import { mollyService, onMollyHooks, openInstances } from '../../../src/molly/host';
import helpPack from '../help.json';
import './control.css';

/**
 * Molly control (Molly plugin, its own folder): every Molly screen, tab, setting and action reachable without the UI
 * (molly-shell@1). Molly hands each console frame inside it its catalog (embed@1 `host-catalog`); the console announces
 * it with its own, so REST / MCP / CLI / voice commands that name a Molly item resolve on the console server and come
 * back as `host-run`, which this plugin carries out. Removed, Molly's own items are no longer reachable remotely; the
 * console inside Molly still is.
 */

export const PLUGIN_ID = 'ai.amberx.axf.molly.control';
const FOLDER = 'control';
const TAB = 'molly-control';
const HOST = 'molly';
const K = { on: 'molly-control.on', toast: 'molly-control.toast' } as const;
/** The app whose frames carry commands (an app id from molly/apps.ts: the one with console-commands). */
const CARRIER = 'console';
/** xLayout's capability, when it is installed: which apps joined and the page each copy is on (for the state). */
const XLAYOUT = 'axf.xlayout@1';
interface XLayoutLike { connected(): string[]; pages(): Record<string, string> }

interface LastRun { at: number; by: string; what: string; ok: boolean }

class ControlHost {
  private off: (() => void)[] = [];
  private frames = new Set<HTMLIFrameElement>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastKey = '';
  items: HostCatalogItem[] = [];
  last: LastRun | null = null;
  rev = 0;
  private subs = new Set<() => void>();

  constructor(private rt: AxfRuntime) {}

  subscribe(f: () => void): () => void { this.subs.add(f); return () => { this.subs.delete(f); }; }
  private changed() { this.rev++; this.subs.forEach((f) => f()); }

  start(): void {
    const onMessage = (e: MessageEvent) => this.receive(e);
    window.addEventListener('message', onMessage);
    this.off.push(() => window.removeEventListener('message', onMessage));
    // every carrier frame, now and as FrameDeck adds them (a load = the console is up: hand it the catalog)
    const watch = () => { for (const f of document.querySelectorAll<HTMLIFrameElement>(`iframe.molly-frame[data-app="${CARRIER}"]`)) this.attach(f); };
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    this.off.push(() => mo.disconnect());
    watch();
    // the catalog or where Molly is changed: send again (debounced; only when something is different)
    this.off.push(this.rt.subscribe(() => this.later()));
    this.off.push(this.rt.settings.subscribe(() => this.later()));
    this.off.push(onMollyHooks(() => this.later()));
    this.later();
  }

  stop(): void { this.off.splice(0).forEach((f) => f()); if (this.timer) clearTimeout(this.timer); this.frames.clear(); }

  private attach(f: HTMLIFrameElement): void {
    if (this.frames.has(f)) return;
    this.frames.add(f);
    f.addEventListener('load', () => { this.lastKey = ''; this.send(f); });
  }

  private later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.sendAll(); }, 150);
  }

  /** Molly's own items: its screens (apps, open copies, the apps' pages), settings tabs, dialogs and actions. */
  catalog(): HostCatalogItem[] {
    const rt = this.rt;
    const tabs = rt.settings.listTabs().map((t) => ({ kind: 'settings-tab', label: t.label, icon: t.icon, keywords: [t.description ?? '', t.parent ? `${t.parent} sub-tab` : ''], parent: t.parent, focus: { kind: 'setting', tab: t.id } }));
    const entries = [...rt.search.entries().filter((e) => e.kind === 'view' || e.kind === 'dialog'), ...tabs];
    const base = consoleCatalogFrom(entries, rt.actions.list(), { app: HOST }).items as HostCatalogSource[];
    // open copies that the search index doesn't list (a view made on the fly)
    const copies: HostCatalogSource[] = [];
    for (const id of openInstances()) { const i = parseInstance(id); const a = mollyApp(i?.app); if (a && i && i.n > 1) copies.push({ kind: 'screen', id, label: instanceTitle(a.label, i.n), icon: a.icon, keywords: [a.label, 'tab', 'copy'] }); }
    // every app, even before it is in the index, so "open amberx in molly" always resolves
    const apps: HostCatalogSource[] = MOLLY_APPS.map((a) => ({ kind: 'screen' as const, id: a.id, label: a.label, icon: a.icon, keywords: [a.description] }));
    return hostCatalog(HOST, [...apps, ...copies, ...base]);
  }

  private here(): { screen: string; screenLabel?: string } {
    const view = this.rt.getState().view;
    const i = parseInstance(view.split('/')[0] ?? ''); const a = mollyApp(i?.app);
    const label = this.rt.search.entries().find((e) => e.kind === 'view' && (e.focus as { view?: string }).view === view)?.label ?? (a && i ? instanceTitle(a.label, i.n) : undefined);
    return label ? { screen: view, screenLabel: label } : { screen: view };
  }

  private message(): EmbedMessage {
    this.items = this.catalog();
    return { $axf: EMBED_MESSAGE, type: 'host-catalog', host: HOST, items: this.items, here: this.here() };
  }

  private send(f: HTMLIFrameElement, m = this.message()): void {
    const a = mollyApp(f.dataset.app);
    if (!a || !f.contentWindow || !f.isConnected) { if (!f.isConnected) this.frames.delete(f); return; }
    f.contentWindow.postMessage(m, new URL(a.url).origin);
  }

  private sendAll(): void {
    if (this.rt.settings.get(K.on) === false) return;
    const m = this.message();
    const key = JSON.stringify(m);
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const f of [...this.frames]) this.send(f, m);
    this.changed();
  }

  /** A console frame carried a command up: only a carrier frame's own window and origin may. */
  private receive(e: MessageEvent): void {
    if (this.rt.settings.get(K.on) === false) return;
    const f = [...this.frames].find((x) => x.contentWindow && x.contentWindow === e.source);
    const a = mollyApp(f?.dataset.app);
    if (!f || !a || new URL(a.url).origin !== e.origin) return;
    const m = parseEmbedMessage(e.data);
    if (m?.type !== 'host-run') return;
    const [ok, what] = this.run(m.run);
    this.last = { at: Date.now(), by: m.run.by ?? 'Amber', what, ok };
    if (this.rt.settings.get(K.toast) !== false) this.rt.toast(`${m.run.by ?? 'Amber'}: ${what}`, ok ? 'info' : 'warning', 'Molly command');
    this.changed();
  }

  /** Carry a run out → [ok, what happened]. */
  run(r: HostRun): [boolean, string] {
    const rt = this.rt;
    const label = r.label ?? r.target;
    switch (r.kind) {
      case 'screen': {
        const known = rt.search.entries().some((e) => e.kind === 'view' && (e.focus as { view?: string }).view === r.target) || this.items.some((i) => i.kind === 'screen' && i.id === `host:${r.target}`);
        if (!known) return [false, `${label} isn't a Molly screen`];
        rt.navigate(r.target);
        return [rt.getState().view === r.target, `opened ${label} in Molly`];
      }
      case 'settings': rt.dispatch(`settings.open:${r.target}`); return [true, `opened ${label} settings in Molly`];
      case 'dialog': rt.openDialog(r.target, r.args?.[0] ? { arg: r.args[0] } : undefined); return [true, `opened ${label} in Molly`];
      case 'action': {
        const spec = hostRunSpec(r);
        if (rt.actions.list().some((x) => (x.meta as { personOnly?: boolean }).personOnly === true && x.id === r.target)) return [false, `${label} needs Brett's own tap`];
        return rt.dispatch(spec) ? [true, `ran ${label} in Molly`] : [false, `${label} didn't run in Molly (no handler, or this role can't)`];
      }
      default: return [false, 'unknown kind'];
    }
  }

  /** The readable state (molly-shell@1), with what xLayout knows when it is installed. */
  state() {
    const x = mollyService<XLayoutLike>(XLAYOUT);
    return mollyState(this.rt, { connected: x?.connected(), pages: x?.pages() });
  }

  carriers(): number { return [...this.frames].filter((f) => f.isConnected).length; }
}

let host: ControlHost | null = null;
const useHost = () => { const h = host!; useSyncExternalStore((f) => h.subscribe(f), () => h.rev, () => h.rev); return h; };

function useSetting<T>(key: string, fallback: T): T {
  const rt = useRuntime();
  const v = useSyncExternalStore((f) => rt.settings.onChange(key, f), () => rt.settings.get(key), () => rt.settings.get(key));
  return (v ?? fallback) as T;
}

/* ---------- Settings → Plugins → Molly control ---------- */

function ControlPanel() {
  const rt = useRuntime();
  const h = useHost();
  const on = useSetting<boolean>(K.on, true);
  const toast = useSetting<boolean>(K.toast, true);
  const s = h.state();
  return (
    <div className="fx-stack">
      <Switch label="Let remote callers move Molly" hint="Off: the console inside Molly stops announcing Molly's screens and actions; commands still reach the console itself." checked={on} onChange={(v) => rt.settings.set(K.on, v)} />
      <Switch label="Show a note for each command" hint="A short toast saying who opened what in Molly." checked={toast} onChange={(v) => rt.settings.set(K.toast, v)} />
      <Container title="What is reachable" icon="radio">
        <ul className="axp-control-list">
          <li><strong>{h.items.filter((i) => i.kind === 'screen').length}</strong> screens · <strong>{h.items.filter((i) => i.kind === 'settings').length}</strong> settings tabs · <strong>{h.items.filter((i) => i.kind === 'dialog').length}</strong> dialogs · <strong>{h.items.filter((i) => i.kind === 'action').length}</strong> actions</li>
          <li>{h.carriers() ? `${h.carriers()} console${h.carriers() === 1 ? '' : 's'} inside Molly carry commands.` : 'No console is open inside Molly yet: open the Console once and commands can reach Molly.'}</li>
          <li>Open now: {s.instances.map((i) => `${instanceTitle(mollyApp(i.app)?.label ?? i.app, i.n)}${i.on ? ' (on screen)' : ''}`).join(', ') || 'nothing'} · IDE mode {s.ide.on ? 'on' : 'off'}</li>
          <li>Last command: {h.last ? `${h.last.ok ? '✓' : '✗'} ${h.last.by}: ${h.last.what} · ${new Date(h.last.at).toLocaleTimeString()}` : 'none yet'}</li>
        </ul>
      </Container>
      <Note tone="info">
        CLI <code>axf console open "console 2"</code>, <code>axf console action molly.new-tab console</code>, <code>axf console list screens molly</code>, <code>axf console where</code>. MCP <code>console_open</code>, <code>console_action</code>, <code>console_list</code>, <code>console_where</code>. REST <code>POST /api/console/open</code> with <code>{'{"screen": "console 2"}'}</code>. Voice: "Amber, open Console 2 in Molly".
      </Note>
    </div>
  );
}

function LifecyclePanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">Molly control's code is all in apps/molly/plugins/{FOLDER}. Install or remove it (Molly's own items then stop being reachable remotely; the console inside Molly still is):</p>
      <pre className="axp-control-code">{`node apps/molly/plugins/${FOLDER}/install.mjs\nnode apps/molly/plugins/${FOLDER}/uninstall.mjs --all`}</pre>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Molly control',
  version: '0.1.0',
  provides: ['settings-tab:molly-control'],
  builtWith: { model: 'fable', builtAt: '2026-11-10' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    if (host) return; // one host per page (StrictMode runs this twice in development)
    host = new ControlHost(rt);
    host.start();
  },
  settingsTabs: [{ id: TAB, label: 'Molly control', icon: 'radio', order: 45, parent: 'plugins', description: 'Every Molly screen, tab and action reachable from the console API, MCP, the CLI and voice.' }],
  settingsPanels: [
    { id: 'molly-control.main', tab: TAB, title: 'Remote control', icon: 'radio', order: 10, render: () => <ControlPanel /> },
    { id: 'molly-control.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
};
