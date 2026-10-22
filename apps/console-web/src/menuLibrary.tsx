/**
 * Console application menu (library `ai.amberx.axf.console.menu`, installed with the console's built-ins).
 *
 * The static menus are the app-menu asset `console` (src/assets/app-menu/console.json); this library adds what needs
 * code: the View menu's chrome toggles (src/menu.ts), the live lists (pending builds, queue steps left, unbuilt
 * features, libraries, modules, boilerplates, plugins), the "Pending builds" badge, and the actions the asset names:
 *   console.search                  focus the search bar, or open the search dialog when no search bar is shown
 *   console.open:<app or page>      open Pilot, axHub pages, the demo or a guide in a new browser tab (fixed list)
 *   console.reveal:<view>:<text>    go to a view and flash the row showing that text
 *   console.pending.open:<id>       Pending builds with that item flashed
 *   console.queue.open:<id>         Build queue with that step flashed
 *   help.docs                       the framework's specs on GitHub
 *
 * Safety nets so hiding chrome can't lock anyone out: Ctrl/Cmd+K always searches (the search dialog stands in when
 * neither the banner nor the toolbar shows a search bar), and a note at the top of every view offers to bring the menu
 * bar back while the menu bar and the side navigation are both hidden.
 *
 * Once per browser the console moves to the `console` menu when an older saved look (the hub's appearance document)
 * still picks another app menu; picking another one afterwards sticks.
 */
import { useEffect, useRef } from 'react';
import type { AxfRuntime, MenuItem } from './axf/core';
import { Button, LiveSearch, Note, flashWhenReady, useAxfState, useRuntime } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import { HUB_DEFAULT, accountUrl, approvalsUrl, appsUrl, normalizeHub } from './axf/libs/hub/hub';
import * as api from './api';
import { computeQueue } from './axf/plan/build-queue-core.mjs';
import type { ConsoleStore } from './store';
import { bundledPlugins, fetchPluginStatus } from './plugins';
import { CONSOLE_MENU_ID, CONSOLE_PROVIDERS as P, PENDING_BADGE, consoleMenuContributions } from './menu';

const REFRESH_MS = 3 * 60_000;
const SEARCH_DIALOG = 'console-search';
const MIGRATED_KEY = 'axf-console:menu-console-v1';
const store = () => (globalThis as unknown as { __axfConsole?: ConsoleStore }).__axfConsole;

/* ---------------- where console.open goes (a fixed list: nothing else can be opened through it) ---------------- */

let hubBase = HUB_DEFAULT;
async function loadHub(): Promise<void> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
    const hub = normalizeHub(((await r.json()) as { hub?: string }).hub);
    if (hub) hubBase = hub;
  } catch { /* keep the default hub */ }
}
const REPO = 'https://github.com/MossesX/AmberX-AXF';
const OPEN: Record<string, () => string> = {
  pilot: () => 'https://pilot.amberxai.com',
  demo: () => 'https://axf.amberxai.com',
  axhub: () => hubBase,
  'axhub-approvals': () => approvalsUrl(hubBase),
  'axhub-apps': () => appsUrl(hubBase),
  'axhub-users': () => `${hubBase}/auth/admin/users`,
  'axhub-account': () => accountUrl(hubBase),
  'plugin-guide': () => `${REPO}/blob/main/apps/console-web/plugins/README.md`,
  docs: () => `${REPO}/tree/main/framework/spec`,
};
const openTab = (url: string) => { globalThis.open?.(url, '_blank', 'noopener,noreferrer'); };

/* ---------------- revealing a row in a view ---------------- */

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
/** The smallest row-like element in the page whose own text is exactly `text`. */
function findRow(text: string): HTMLElement | null {
  const root = document.querySelector('.fx-main');
  if (!root || !text) return null;
  const want = clean(text).toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (clean(n.textContent).toLowerCase() !== want) continue;
    const el = n.parentElement;
    if (!el || el.closest('[data-axf-search="off"]')) continue;
    return el.closest<HTMLElement>('li, tr, article, .cx-item, .fx-card, button') ?? el;
  }
  return null;
}
function reveal(rt: AxfRuntime, view: string, text: string, click = false) {
  rt.navigate(view);
  let clicked = false;
  flashWhenReady(() => {
    const el = findRow(text);
    if (el && click && !clicked) { clicked = true; el.click(); }
    return el;
  }, 4000);
}

/* ---------------- search: the bar when it's on screen, else the dialog ---------------- */

const visibleSearch = () => [...document.querySelectorAll<HTMLInputElement>('.fx-search--live input')].find((i) => !i.closest('.fx-dialog, [role="dialog"]') && i.offsetParent !== null) ?? null;
function search(rt: AxfRuntime) {
  const input = visibleSearch();
  if (input) { input.focus(); input.select(); return; }
  rt.openDialog(SEARCH_DIALOG);
}

function SearchDialog({ close }: { close: () => void }) {
  const state = useAxfState();
  const box = useRef<HTMLDivElement>(null);
  const view = useRef(state.view);
  useEffect(() => { box.current?.querySelector('input')?.focus(); }, []);
  // A pick that goes to another page closes the dialog (picks that open a dialog replace it anyway).
  useEffect(() => { if (state.view !== view.current) close(); }, [state.view, close]);
  return (
    <div className="fx-stack" ref={box}>
      <div className="fx-row"><LiveSearch config={{ live: true, placeholder: 'Search pages, builds, plugins, settings…', maxResults: 14 }} /></div>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Everything the console can open: pages, actions, settings, builds, features, plugins and menu items.</p>
    </div>
  );
}

/* ---------------- the "you hid the way back" note ---------------- */

function ChromeRescue() {
  const rt = useRuntime();
  useAxfState();
  if (!rt.slotHidden('app-menu') || !rt.slotHidden('nav-menu')) return null;
  // Inside a host that carries this menu in its own (embed@1 take `app-menu`, e.g. Patches) nothing is lost.
  if (rt.hostTakes('app-menu')) return null;
  return (
    <Note tone="info" icon="menu">
      <span>The menu bar and the side navigation are both hidden. Press <strong>Ctrl K</strong> (⌘K) to search everything, or </span>
      <Button icon="menu" onClick={() => rt.dispatch('slot.hide:app-menu:off')}>Show the menu bar</Button>
    </Note>
  );
}

/* ---------------- live lists ---------------- */

const PENDING_ICON: Record<string, string> = { pending: 'clock', unsafe: 'alert', broken: 'x-circle', failed: 'x-circle' };

async function pendingOpen() {
  const s = await api.loadPending();
  return (s?.items ?? []).filter((i) => i.status !== 'complete');
}

/** Live lists; `rt` is the runtime the library was registered with (register runs before providers are added). */
let runtime: AxfRuntime | null = null;
const providers: AxfWebLibrary['appMenuProviders'] = (() => {
  const rt = { setBadge: (n: string, c: number) => runtime?.setBadge(n, c), actions: { get: (id: string) => runtime?.actions.get(id) } };
  return {
    [P.pending.id]: {
      ...P.pending,
      items: async (): Promise<MenuItem[]> => {
        const open = await pendingOpen();
        rt.setBadge(PENDING_BADGE, open.length);
        return open.map((i) => ({ id: `pending:${i.id}`, label: `${i.title} · ${i.model}${i.status !== 'pending' ? ` · ${i.status}` : ''}`, icon: PENDING_ICON[i.status] ?? 'clock', action: `console.pending.open:${encodeURIComponent(i.id)}` }));
      },
    },
    [P.queue.id]: {
      ...P.queue,
      items: async (): Promise<MenuItem[]> => {
        const [state, plan] = await Promise.all([api.loadBuildQueueState(), api.loadPlan()]);
        const view = computeQueue(plan?.features ?? [], state);
        return view.steps.filter((s) => s.state !== 'done' && s.state !== 'dropped')
          .map((s) => ({ id: `step:${s.id}`, label: `${s.position}. ${s.title}${s.minutesLeft ? ` · ${api.modelLabel(s.model).split(' ')[0]}` : ''}`, icon: s.state === 'rework' ? 'refresh' : s.ready ? 'play' : 'clock', action: `console.queue.open:${encodeURIComponent(s.id)}` }));
      },
    },
    [P.features.id]: {
      ...P.features,
      items: async (): Promise<MenuItem[]> => {
        const plan = await api.loadPlan();
        return (plan?.features ?? []).filter((f) => f.kind !== 'task' && f.status !== 'built' && f.status !== 'dropped')
          .map((f) => ({ id: `feature:${f.id}`, label: `${f.title} · ${f.status}`, icon: f.kind === 'epic' ? 'layers' : 'check-circle', action: `console.plan.open:${encodeURIComponent(f.id)}` }));
      },
    },
    [P.libraries.id]: {
      ...P.libraries,
      items: async (): Promise<MenuItem[]> => {
        const libs = store()?.libraries.length ? store()!.libraries : await api.loadLibraries();
        return libs.map((l) => ({ id: `library:${l.id}`, label: l.name, icon: 'box', action: `console.reveal:libraries:${encodeURIComponent(l.name)}` }));
      },
    },
    [P.modules.id]: {
      ...P.modules,
      items: async (): Promise<MenuItem[]> => {
        const mods = store()?.modules.length ? store()!.modules : await api.loadModules();
        return mods.map((m) => ({ id: `module:${m.name}`, label: m.name, icon: 'package', action: `console.reveal:modules:${encodeURIComponent(m.name)}` }));
      },
    },
    [P.boilerplates.id]: {
      ...P.boilerplates,
      items: async (): Promise<MenuItem[]> => {
        const list = store()?.boilerplates.length ? store()!.boilerplates : await api.loadBoilerplates();
        return list.map((b) => ({ id: `boilerplate:${b.id}`, label: b.name, icon: 'layout', action: `console.reveal:boilerplates:${encodeURIComponent(b.name)}:pick` }));
      },
    },
    [P.plugins.id]: {
      ...P.plugins,
      items: async (): Promise<MenuItem[]> => {
        const status = await fetchPluginStatus();
        const manager = !!rt.actions.get('plugin-manager.open');
        return bundledPlugins.map((p) => {
          const st = status?.find((s) => s.folder === p.folder);
          const on = st ? st.enabled : p.manifest.enabledByDefault !== false;
          return { id: `plugin:${p.folder}`, label: `${p.manifest.name ?? p.folder}${on ? '' : ' · off'}`, icon: on ? 'package' : 'minus', action: manager ? `plugin-manager.open:${p.folder}` : 'settings.open:plugins' };
        });
      },
    },
  };
})();

/* ---------------- start-up (once per page, whatever re-installs the library) ---------------- */

let started = false;
function start(rt: AxfRuntime) {
  if (started) return;
  started = true;
  void loadHub();
  const badge = () => void pendingOpen().then((l) => rt.setBadge(PENDING_BADGE, l.length), () => { /* offline: keep */ });
  badge();
  globalThis.addEventListener('axf:pending-changed', badge);
  setInterval(badge, REFRESH_MS);
  // Ctrl/Cmd+K must always search, even with every search bar hidden.
  globalThis.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return;
    if (visibleSearch() || rt.getState().dialog) return; // the bar's own handler takes it
    e.preventDefault();
    rt.openDialog(SEARCH_DIALOG);
  });
  // One-time move to the console menu when a saved look still names another app menu.
  let done = (() => { try { return globalThis.localStorage?.getItem(MIGRATED_KEY) === '1'; } catch { return true; } })();
  const migrate = () => {
    if (done || !rt.appearanceReady()) return;
    done = true;
    try { globalThis.localStorage?.setItem(MIGRATED_KEY, '1'); } catch { /* fine */ }
    if (rt.getState().active['app-menu'] !== 'console' && rt.gate('assets.swap') === 'allow') rt.swap('app-menu', 'console');
    off();
  };
  const off = rt.subscribe(migrate);
  migrate();
}

export const menuLibrary: AxfWebLibrary = {
  id: CONSOLE_MENU_ID,
  label: 'Console menu',
  version: '1.0.0',
  register(rt) {
    runtime = rt;
    start(rt);
    rt.actions.register('console.search', () => search(rt), { label: 'Search everything' });
    rt.actions.register('console.open', ([key]) => { const to = key ? OPEN[key] : undefined; if (to) openTab(to()); else rt.toast(`Nothing to open for "${key ?? ''}".`, 'warning'); }, { label: 'Open an app or page in a new tab', params: true, searchable: false });
    rt.actions.register('console.reveal', ([view, text, how]) => { if (view) reveal(rt, view, decodeURIComponent(text ?? ''), how === 'pick'); }, { label: 'Show a row in a view', params: true, searchable: false });
    rt.actions.register('console.pending.open', ([id]) => {
      rt.navigate('pending');
      const want = decodeURIComponent(id ?? '');
      if (want) flashWhenReady(() => [...document.querySelectorAll('[data-fx-ctx-target="axf-pending-item"]')].find((el) => el.getAttribute('data-fx-ctx-payload') === want) ?? null, 4000);
    }, { label: 'Open a pending build', params: true, searchable: false });
    rt.actions.register('console.queue.open', ([id]) => {
      const want = decodeURIComponent(id ?? '');
      void Promise.all([api.loadBuildQueueState(), api.loadPlan()]).then(([state, plan]) => {
        const step = computeQueue(plan?.features ?? [], state).steps.find((s) => s.id === want);
        if (step) reveal(rt, 'build', step.title); else rt.navigate('build');
      }, () => rt.navigate('build'));
    }, { label: 'Open a build-queue step', params: true, searchable: false });
    rt.actions.register('help.docs', () => openTab(OPEN.docs!()), { label: 'Documentation' });
  },
  appMenu: consoleMenuContributions,
  appMenuProviders: providers,
  dialogs: {
    [SEARCH_DIALOG]: { title: 'Search everything', icon: 'search', searchable: false, render: (_p, close) => <SearchDialog close={close} /> },
  },
  banners: [{ id: 'console-menu.rescue', order: 1, render: () => <ChromeRescue /> }],
};
