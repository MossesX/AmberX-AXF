/*
 * Console search providers: the search bar (framework widget `search-bar`, in the banner) already finds pages,
 * settings, actions, assets, windows, dialogs and words on the page; these add the console's own records:
 *   - plan features (Plan view, framework/plan/plan.json)      → opens the feature in a window
 *   - framework features in the tracker (catalog status)      → opens the Tracker
 *   - pending builds (framework/plan/pending.json)            → opens Pending builds
 *   - plugins (every bundled plugin, enabled or not)          → opens it in the Plugin Manager (or Settings → Plugins)
 * Data is fetched once and refreshed when it changes (plan/plugin events) or every few minutes; providers return
 * cached lists, so typing stays instant.
 */
import { SEARCH_KIND_LABELS, type AxfRuntime, type SearchEntry } from './axf/core';
import * as api from './api';
import { bundledPlugins, fetchPluginStatus, PLUGINS_CHANGED, type PluginStatus } from './plugins';

const REFRESH_MS = 3 * 60_000;

Object.assign(SEARCH_KIND_LABELS, { feature: 'Feature', 'framework-feature': 'Framework', pending: 'Pending build', plugin: 'Plugin' });

export function installConsoleSearch(rt: AxfRuntime): () => void {
  let plan: SearchEntry[] = [];
  let tracker: SearchEntry[] = [];
  let pending: SearchEntry[] = [];
  let pluginStatus: PluginStatus[] | null = null;

  const loadPlanEntries = async () => {
    try {
      const p = await api.loadPlan();
      plan = (p?.features ?? []).map((f) => ({
        id: `feature:${f.id}`, kind: 'feature', label: f.title, icon: 'layers',
        detail: `Plan › ${f.area}${f.group ? ` › ${f.group}` : ''} · ${f.status}`,
        keywords: [f.id, f.area, f.kind, f.status, ...(f.summary ? f.summary.split(/\s+/).slice(0, 24) : []), ...(f.modules ?? [])],
        focus: { kind: 'action', spec: `console.plan.open:${f.id}` },
      }));
    } catch { /* backend down: keep the last list */ }
  };
  const loadTrackerEntries = async () => {
    try {
      const t = await api.loadTracker();
      tracker = (t?.items ?? []).map((i) => ({
        id: `framework-feature:${i.id}`, kind: 'framework-feature', label: i.title, icon: 'check',
        detail: `Tracker › ${i.tab} › ${i.group} · ${i.status}`, keywords: [i.id, i.tag, i.status, i.module ?? ''],
        focus: { kind: 'view', view: 'tracker' },
      }));
    } catch { /* keep */ }
  };
  const loadPendingEntries = async () => {
    try {
      const s = await api.loadPending();
      pending = (s?.items ?? []).map((i) => ({
        id: `pending:${i.id}`, kind: 'pending', label: i.title, icon: 'clock',
        detail: `Pending builds · ${i.model} · ${i.status}`, keywords: [i.id, i.model, i.status, ...String(i.detail ?? '').split(/\s+/).slice(0, 24)],
        focus: { kind: 'view', view: 'pending' },
      }));
    } catch { /* keep */ }
  };
  const loadPlugins = async () => { pluginStatus = await fetchPluginStatus().catch(() => null) ?? pluginStatus; };
  const refresh = () => { void loadPlanEntries(); void loadTrackerEntries(); void loadPendingEntries(); void loadPlugins(); };

  const plugins = (): SearchEntry[] => bundledPlugins.map((p) => {
    const st = pluginStatus?.find((s) => s.folder === p.folder);
    const on = st ? st.enabled : p.manifest.enabledByDefault !== false;
    return {
      id: `plugin:${p.folder}`, kind: 'plugin', label: p.manifest.name ?? p.folder, icon: 'package',
      detail: `Plugin · ${on ? 'on' : 'off'}`, keywords: [p.folder, p.manifest.id, ...String(p.manifest.description ?? '').split(/\s+/).slice(0, 30)],
      focus: { kind: 'action', spec: rt.actions.get('plugin-manager.open') ? `plugin-manager.open:${p.folder}` : 'settings.open:plugins' },
    };
  });

  const removers = [
    rt.search.add('console.plan', () => plan),
    rt.search.add('console.tracker', () => tracker),
    rt.search.add('console.pending', () => pending),
    rt.search.add('console.plugins', plugins),
  ];
  // console.plan.open:<feature id> → the feature in its own window (same as the Plan view's "Open in window")
  rt.actions.register('console.plan.open', ([id]) => {
    if (!id) return rt.navigate('plan');
    const f = plan.find((e) => e.id === `feature:${id}`);
    rt.windows.openFloating([{ id: `plan-${id}-${Date.now().toString(36)}`, title: f?.label ?? id, kind: 'plan-feature', payload: id, icon: 'layers' }], f?.label ?? id, 'floating', 460, 620);
  }, { label: 'Open a plan feature', params: true });

  refresh();
  const onPlan = () => void loadPlanEntries();
  const onPlugins = () => void loadPlugins();
  globalThis.addEventListener('axf:plan-changed', onPlan);
  globalThis.addEventListener(PLUGINS_CHANGED, onPlugins);
  const timer = setInterval(refresh, REFRESH_MS);
  return () => {
    removers.forEach((r) => r());
    globalThis.removeEventListener('axf:plan-changed', onPlan);
    globalThis.removeEventListener(PLUGINS_CHANGED, onPlugins);
    clearInterval(timer);
  };
}
