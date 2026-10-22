/**
 * App tabs console plugin (ai.amberx.axf.console.app-tabs).
 *
 * A tab group across the whole page (framework slot `app.frame.head`, above the application menu): one tab per AmberX app picked
 * in Settings → Plugins → App tabs, Console, Pilot and axHub by default. The console's own tab shows the console; any other
 * tab covers the page below the tab bar (slot `app.frame.cover`) with that app in a frame. A frame stays loaded once
 * opened, so switching back and forth keeps its state. Apps: built-in list + project manifests with a deploy.url +
 * ones added in settings (https only). Choices are settings (`app-tabs.tabs`, `app-tabs.custom`, `app-tabs.active`),
 * so they follow the UI-editor rule (fresh on focus, last save wins). No server part.
 *
 * Inside a host app (embed@1, e.g. Patches) the tab group is gone: the host runs the tabs (Brett, Oct 21 2026: "keep
 * console the way it was unless running inside Patches, then remove tab group and let Patches control tabs"). No bar,
 * no cover, no Apps-menu tab entries there; settings and the saved choices stay for when the console runs on its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, useEditorSync, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { loadProjects } from '@console/api';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { BUILT_IN, DEFAULT_TABS, LATER_DEFAULTS, encodeCustom, fromManifests, isHome, mergeApps, parseCustom, safeUrl, slug, tabsFor, type AppDef } from './apps';
import './app-tabs.css';
import { appMenu, TABS } from './menu';

const ID = 'ai.amberx.axf.console.app-tabs';
const FOLDER = 'app-tabs';
const KEYS = { tabs: 'app-tabs.tabs', custom: 'app-tabs.custom', active: 'app-tabs.active' } as const;
const SEEN_KEY = 'app-tabs.seenDefaults';
const here = () => globalThis.location?.origin ?? '';
/** Running inside a host app (embed@1): the host controls the tabs. Fixed for the page's life, like `rt.embedded`. */

/* ---------------- shared state: the app list and the saved choices ---------------- */

let runtime: AxfRuntime | null = null;
const savedTabs = (rt: AxfRuntime): string[] | null => { const t = rt.settings.get(KEYS.tabs); return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : null; };
const knownApps = (rt: AxfRuntime): AppDef[] => mergeApps(BUILT_IN, manifestApps, parseCustom(rt.settings.get(KEYS.custom)));

let manifestApps: AppDef[] = [];
let manifestsLoaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
function loadManifestApps(): Promise<void> {
  manifestsLoaded ??= loadProjects()
    .then((r) => { manifestApps = fromManifests(r.items ?? []); listeners.forEach((f) => f()); })
    .catch(() => { /* offline: built-in + custom apps only */ });
  return manifestsLoaded;
}

function useAppTabs() {
  const rt = useRuntime();
  const read = useCallback(() => {
    const t = rt.settings.get(KEYS.tabs);
    return {
      chosen: Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : null,
      custom: parseCustom(rt.settings.get(KEYS.custom)),
      active: String(rt.settings.get(KEYS.active) ?? ''),
    };
  }, [rt]);
  const [s, setS] = useState(read);
  const [, bump] = useState(0);
  // Defaults added after a choice was saved (axHub): put each on a saved list once; removing it later sticks.
  useEffect(() => {
    const seen = rt.settings.get(SEEN_KEY);
    const seenList = Array.isArray(seen) ? seen.filter((x): x is string => typeof x === 'string') : [];
    const fresh = LATER_DEFAULTS.filter((id) => !seenList.includes(id));
    if (!fresh.length) return;
    const saved = read().chosen;
    if (saved) rt.settings.set(KEYS.tabs, [...saved, ...fresh.filter((id) => !saved.includes(id))]);
    rt.settings.set(SEEN_KEY, [...seenList, ...fresh]);
  }, [rt, read]);
  useEditorSync({ onRefresh: () => setS(read()) });
  useEffect(() => {
    void loadManifestApps();
    const on = () => bump((n) => n + 1);
    listeners.add(on);
    const offs = Object.values(KEYS).map((k) => rt.settings.onChange(k, () => setS(read())));
    return () => { listeners.delete(on); offs.forEach((o) => o()); };
  }, [rt, read]);
  const apps = useMemo(() => mergeApps(BUILT_IN, manifestApps, s.custom), [s.custom, manifestApps]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabs = useMemo(() => tabsFor(apps, s.chosen, here()), [apps, s.chosen]);
  const home = tabs.find((a) => isHome(a, here()));
  const active = tabs.find((a) => a.id === s.active) ?? home ?? tabs[0];
  return {
    apps, tabs, active, home, chosen: s.chosen ?? DEFAULT_TABS, custom: s.custom,
    setActive: (id: string) => rt.settings.set(KEYS.active, id),
    setChosen: (ids: string[]) => rt.settings.set(KEYS.tabs, ids),
    setCustom: (list: AppDef[]) => rt.settings.set(KEYS.custom, list.map(encodeCustom)),
  };
}

/* ---------------- the tab bar (app.frame.head, above the application menu) ---------------- */

/**
 * The tab bar sits above the application menu (Brett, Oct 22 2026); the menu bar and the live banners (which come and go)
 * sit between it and the page, and stay visible over another app. So the cover starts where the page (`.fx-shell`)
 * starts: publish that as `--axp-app-tabs-bottom` on the page frame (the cover is inside it), following everything above.
 */
function useBarBottom(shown: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const bar = ref.current;
    const frame = bar?.parentElement;
    if (!bar || !frame) return;
    const shell = () => Array.from(frame.children).find((el) => el.classList.contains('fx-shell')) ?? null;
    const set = () => {
      const below = shell();
      const y = below ? below.getBoundingClientRect().top : bar.getBoundingClientRect().bottom;
      frame.style.setProperty('--axp-app-tabs-bottom', `${Math.max(0, Math.round(y))}px`);
    };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    const watchAbove = () => {
      ro?.disconnect();
      const below = shell();
      for (let el: Element | null = below?.previousElementSibling ?? bar; el; el = el.previousElementSibling) ro?.observe(el);
      set();
    };
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(watchAbove) : null;
    mo?.observe(frame, { childList: true });
    watchAbove();
    globalThis.addEventListener?.('resize', set);
    return () => { ro?.disconnect(); mo?.disconnect(); globalThis.removeEventListener?.('resize', set); frame.style.removeProperty('--axp-app-tabs-bottom'); };
  }, [shown]);
  return ref;
}

function TabBar() {
  const t = useAppTabs();
  const ref = useBarBottom(t.tabs.length > 0);
  if (t.tabs.length < 1) return null;
  return (
    <nav ref={ref} className="axp-app-tabs" aria-label="Apps" data-fx-ctx-ignore="">
      <div className="axp-app-tabs__list" role="tablist">
        {t.tabs.map((a) => {
          const on = a === t.active;
          return (
            <button key={a.id} type="button" role="tab" aria-selected={on} title={a.note ?? a.url}
              className={`axp-app-tabs__tab ${on ? 'is-active' : ''}`} onClick={() => t.setActive(a.id)}>
              <Icon name={a.icon} size={14} /><span>{a.name}</span>
            </button>
          );
        })}
      </div>
      {t.active && !isHome(t.active, here()) && (
        <a className="axp-app-tabs__open" href={t.active.url} target="_blank" rel="noreferrer" title={`Open ${t.active.name} in a new browser tab`}>
          <Icon name="external" size={14} />
        </a>
      )}
    </nav>
  );
}

/* ---------------- the cover (app.frame.cover): other apps in frames ---------------- */

function Cover() {
  const t = useAppTabs();
  const [opened, setOpened] = useState<string[]>([]);
  const showing = t.active && !isHome(t.active, here()) ? t.active : null;
  useEffect(() => { if (showing && !opened.includes(showing.id)) setOpened((o) => [...o, showing.id]); }, [showing, opened]);
  const frames = t.tabs.filter((a) => opened.includes(a.id) && !isHome(a, here()));
  if (!frames.length) return null;
  return (
    <div className={`axp-app-tabs-cover ${showing ? 'is-showing' : ''}`} aria-hidden={!showing}>
      {showing && (
        <p className="axp-app-tabs-cover__hint">
          Loading {showing.name}… If it stays blank, it doesn't allow being shown inside another page or isn't reachable: use the arrow at the top right, or{' '}
          <a href={showing.url} target="_blank" rel="noreferrer">open {showing.name} in a new tab</a>.
        </p>
      )}
      {frames.map((a) => (
        <iframe key={a.id} title={a.name} src={a.url} hidden={a !== showing} className="axp-app-tabs-cover__frame"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals"
          allow="clipboard-read; clipboard-write; fullscreen" />
      ))}
    </div>
  );
}

/* ---------------- settings: which apps, in which order, and your own ---------------- */

function TabsPanel() {
  const t = useAppTabs();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const order = [...t.chosen.filter((id) => t.apps.some((a) => a.id === id)), ...t.apps.map((a) => a.id).filter((id) => !t.chosen.includes(id))];
  const toggle = (id: string, on: boolean) => t.setChosen(on ? [...t.chosen.filter((x) => x !== id), id] : t.chosen.filter((x) => x !== id));
  const move = (id: string, by: number) => {
    const list = t.chosen.filter((x) => t.apps.some((a) => a.id === x));
    const i = list.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j] as string, list[i] as string];
    t.setChosen(list);
  };
  const add = () => {
    const u = safeUrl(url);
    if (!name.trim()) return setErr('Give it a name.');
    if (!u) return setErr('Use an https:// address.');
    let id = slug(name);
    while (t.apps.some((a) => a.id === id)) id = `${id}-2`.slice(0, 47);
    if (t.apps.some((a) => new URL(a.url).origin === new URL(u).origin)) return setErr('That app is already in the list.');
    t.setCustom([...t.custom, { id, name: name.trim(), url: u, icon: 'external', from: 'custom' }]);
    t.setChosen([...t.chosen, id]);
    setName(''); setUrl(''); setErr('');
  };
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Pick the apps shown as tabs across the top of the page. The console's own tab is always there.</p>
      <ul className="axp-app-tabs-set">
        {order.map((id) => {
          const a = t.apps.find((x) => x.id === id);
          if (!a) return null;
          const home = isHome(a, here());
          const on = home || t.chosen.includes(id);
          const pos = t.chosen.indexOf(id);
          return (
            <li key={id} className="axp-app-tabs-set__row">
              <label className="axp-app-tabs-set__pick">
                <input type="checkbox" checked={on} disabled={home} onChange={(e) => toggle(id, e.target.checked)} aria-label={`Show ${a.name} as a tab`} />
                <Icon name={a.icon} size={14} />
                <span className="axp-app-tabs-set__text"><strong>{a.name}</strong><span className="fx-muted fx-small">{home ? 'this console' : a.url} · {a.from}</span></span>
              </label>
              {on && pos >= 0 && (
                <span className="fx-row">
                  <Button tone="ghost" icon="arrow-left" disabled={pos === 0} onClick={() => move(id, -1)} aria-label={`Move ${a.name} left`} />
                  <Button tone="ghost" icon="arrow-right" disabled={pos === t.chosen.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${a.name} right`} />
                </span>
              )}
              {a.from === 'custom' && <Button tone="ghost" icon="x" onClick={() => { t.setCustom(t.custom.filter((c) => c.id !== id)); t.setChosen(t.chosen.filter((x) => x !== id)); }} aria-label={`Remove ${a.name}`} />}
            </li>
          );
        })}
      </ul>
      <div className="fx-stack">
        <strong className="fx-small">Add an app</strong>
        <div className="fx-row fx-row--wrap">
          <input className="fx-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="App name" />
          <input className="fx-input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="App address" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <Button tone="primary" icon="plus" onClick={add}>Add</Button>
        </div>
        {err && <span className="fx-small axp-app-tabs-set__err">{err}</span>}
        <span className="fx-muted fx-small">An app that refuses to be shown in a frame stays blank: open it with the arrow at the end of the tab bar instead. Apps behind axHub's sign-in use the hub session you already have.</span>
      </div>
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="undo" onClick={() => { t.setChosen(DEFAULT_TABS); t.setActive(''); }}>Back to Console + Pilot + axHub</Button>
      </div>
    </div>
  );
}

const standalone: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'App tabs',
  version: '0.1.0',
  appMenu,
  appMenuProviders: {
    [TABS]: {
      items: async () => {
        if (runtime) await loadManifestApps();
        const rt = runtime;
        if (!rt) return [];
        return tabsFor(knownApps(rt), savedTabs(rt), here()).map((a) => ({ id: `tab:${a.id}`, label: a.name, icon: a.icon, action: `app-tabs.show:${a.id}` }));
      },
    },
  },
  register(rt) {
    runtime = rt;
    // app-tabs.show:<id> — a known app not yet on the tab bar is added to it first (the app menu's "Show … in a tab").
    rt.actions.register('app-tabs.show', (args) => {
      const id = args?.[0];
      if (!id) return;
      const chosen = savedTabs(rt) ?? [...DEFAULT_TABS];
      if (!chosen.includes(id) && knownApps(rt).some((a) => a.id === id && !isHome(a, here()))) rt.settings.set(KEYS.tabs, [...chosen, id]);
      rt.settings.set(KEYS.active, id);
    }, { label: 'Switch app tab', searchable: false });
    rt.actions.register('app-tabs.settings', () => rt.dispatch('settings.open:app-tabs'), { label: 'App tabs settings' });
  },
  slots: {
    'app.frame.head': [{ id: 'app-tabs.bar', render: () => <TabBar /> }],
    'app.frame.cover': [{ id: 'app-tabs.cover', render: () => <Cover /> }],
  },
  settingsTabs: [{ id: 'app-tabs', label: 'App tabs', icon: 'layout', order: 7, parent: 'plugins' }],
  settingsPanels: [
    { id: 'app-tabs.tabs', tab: 'app-tabs', title: 'Tabs', icon: 'layout', order: 5, render: () => <TabsPanel /> },
    { id: 'app-tabs.lifecycle', tab: 'app-tabs', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

/** Inside a host app (Patches) the host runs the tabs, so the plugin isn't loaded there at all (embed@1 skipWhen). */
export const plugin: AxfWebLibrary = { ...standalone, embed: { skipWhen: ['embedded'] } };
