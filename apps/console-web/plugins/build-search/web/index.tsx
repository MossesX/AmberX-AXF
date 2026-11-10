/**
 * Build search console plugin (ai.amberx.axf.console.build-search).
 *
 * Builds → Search builds, notes and session logs (also Plugins → Build search): one box over every build, build note,
 * build report, session log and session message, plus the user's own sources. Every hit is listed with an icon by type
 * and numbered per document (instance 1, 2, 3…); picking one opens the log viewer scrolled to that line, highlighted.
 *
 * Reached without the UI (the same everywhere: REST /api/plugins/build-search/…, MCP `build-search_*`, CLI
 * `axf build-search …` / `search.mjs`, console actions below for console_action and voice):
 *   build-search.open[:<query>]     the page (with a query: runs it)
 *   build-search.query:<query>      run a query and show the hits
 *   build-search.hit:<hit id>       open a log at a hit (`<doc id>#<line>`, e.g. `log:my-build#42`)
 *   build-search.command:<text>     a typed command (`add source …`, `add action …`, `ai off` …)
 *   build-search.ai.on / .ai.off    the AI switch (off by default; nothing turns it on by itself)
 *   build-search.close              close the log viewer
 * Deep link: `?axf-build-search=<hit id>` (Copy link) or `?axf-build-search=q:<query>`.
 * Capability `axf.build-search@1` (web): { search(q, opts), open(hitId), command(text), state() } for other plugins,
 * e.g. the Search bar plugin's Builds scope.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { CAPABILITY, ID, URL_PARAM, VERSION, VIEW, closeLog, getState, openHit, runCommand, runQuery, setAi } from './store';
import { BuildSearchView, LifecyclePanel, SettingsPanel } from './ui';
import { appMenu } from './menu';
import './build-search.css';

const services = () => ((globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices ??= {});
const arg = (a?: string) => { try { return decodeURIComponent(a ?? ''); } catch { return a ?? ''; } };

function show(rt: AxfRuntime, q = '') {
  rt.navigate(VIEW);
  if (q) void runQuery(q);
}
async function hit(rt: AxfRuntime, id: string) {
  rt.navigate(VIEW);
  return openHit(id);
}

/** A link opened with ?axf-build-search=… (Copy link), handled once the console is up. */
function followLink(rt: AxfRuntime) {
  let v = '';
  try { v = new URL(location.href).searchParams.get(URL_PARAM) ?? ''; } catch { return; }
  if (!v) return;
  setTimeout(() => {
    if (v.startsWith('q:')) show(rt, v.slice(2)); else void hit(rt, v);
    try { const u = new URL(location.href); u.searchParams.delete(URL_PARAM); history.replaceState(history.state, '', u.toString()); } catch { /* ignore */ }
  }, 300);
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Build search',
  version: VERSION,
  appMenu,
  provides: ['axf.build-search', CAPABILITY],
  register(rt) {
    rt.actions.register('build-search.open', ([a]) => show(rt, arg(a)), { label: 'Open Build search', effect: 'navigate' });
    rt.actions.register('build-search.query', ([a]) => show(rt, arg(a)), { label: 'Search builds, notes and session logs', params: true, effect: 'navigate' });
    rt.actions.register('build-search.hit', ([a]) => { void hit(rt, arg(a)); }, { label: 'Open a session log at a search hit', params: true, effect: 'navigate' });
    rt.actions.register('build-search.command', ([a]) => { rt.navigate(VIEW); void runCommand(arg(a)); }, { label: 'Build search: run a typed command', params: true, effect: 'write' });
    rt.actions.register('build-search.ai.on', () => void setAi(true), { label: 'Build search: allow AI features', effect: 'write' });
    rt.actions.register('build-search.ai.off', () => void setAi(false), { label: 'Build search: turn AI features off', effect: 'write' });
    rt.actions.register('build-search.close', () => closeLog(), { label: 'Build search: close the log viewer' });
    services()[CAPABILITY] = {
      version: 1,
      search: (q: string, opts?: { types?: string[]; build?: string }) => runQuery(q, opts),
      open: (id: string) => hit(rt, id),
      command: (text: string) => runCommand(text),
      state: () => getState(),
    };
    // The global search: the page itself, plus every document of the last Build search with its hit count.
    rt.search.add('build-search.docs', () => (getState().result?.groups ?? []).slice(0, 200).map((g) => ({
      id: `build-search:${g.doc}`, kind: 'build', label: g.title, icon: g.icon,
      detail: `Build search · ${g.typeLabel} · ${g.count} hit(s) for “${getState().q}”`,
      keywords: [g.build, g.type, g.doc].filter(Boolean),
      focus: { kind: 'action' as const, spec: `build-search.hit:${encodeURIComponent(g.hits[0]?.id ?? g.doc)}` },
    })));
    followLink(rt);
  },
  views: { [VIEW]: { title: 'Build search', icon: 'search', keywords: ['search', 'builds', 'session', 'log', 'history', 'notes', 'report', 'find', 'instances'], render: () => <BuildSearchView /> } },
  nav: { label: 'Builds', items: [{ id: 'build-search', label: 'Build search', icon: 'search', view: 'build-search' }] },
  contextMenu: [{ id: 'build-search.default', target: 'default', order: 92, items: [{ id: 'build-search', label: 'Search builds and logs', icon: 'search', action: 'build-search.open' }] }],
  settingsTabs: [{ id: 'build-search', label: 'Build search', icon: 'search', parent: 'plugins', order: 44, description: 'Sources, hit actions, limits and the AI switch (off by default).' }],
  settingsPanels: [
    { id: 'build-search.settings', tab: 'build-search', title: 'Build search', icon: 'search', order: 10, render: () => <SettingsPanel /> },
    { id: 'build-search.lifecycle', tab: 'build-search', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
};
