import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { isLevel, matchPhrase } from '@console/axf/core/engines/context-menus-rules.mjs';
import { ContextMenusPage } from './ContextMenus';
import { appMenu } from './menu';
import * as S from './store';
import './context-menus.css';

/*
 * Context menus (web part): Plugins → Context menus. On start every menu on the hub is registered as a context-menu
 * asset and the one the app shows is swapped in; the capability `context-menus@1` is published for other plugins' web
 * parts. Actions (also MCP / CLI / voice through plugin-commands): context-menus.open [tab] | .generate <level> [app]
 * | .preview <level> [app] | .apply [draft id] | .use <menu id> | .zones | .say "<sentence>".
 */
let focus: { tab?: 'generate' | 'drafts' | 'menus' | 'zones'; level?: 'beginner' | 'amateur' | 'pro' | 'advanced'; menu?: string } = {};

async function generate(rt: ReturnType<typeof useRuntime>, level: string, app?: string, apply = false) {
  if (!isLevel(level)) { rt.toast(`Level must be beginner, amateur, pro or advanced (got "${level}")`, 'warning', 'Context menus'); return; }
  const s = S.getState() ?? (await S.load(rt));
  if (s && !s.claude.ready) { rt.toast(s.claude.reason, 'warning', 'Context menus'); focus = { tab: 'generate', level }; rt.navigate(S.VIEW); return; }
  rt.toast(`Generating ${level} context menus${app ? ` for ${app}` : ''}…`, 'info', 'Context menus');
  try {
    const r = await S.generate(level, { app, actions: S.liveActions(rt), apply });
    await S.load(rt);
    if (!r.ok) { rt.toast(r.error ?? 'Claude did not answer', 'warning', 'Context menus'); return; }
    rt.toast(apply ? `${r.menu?.name ?? 'Menu'} applied and in use.` : `Draft ready: ${r.draft?.summary.items ?? 0} items in ${r.draft?.summary.targets ?? 0} zones. Preview it, then Apply.`, 'success', 'Context menus');
    focus = { tab: apply ? 'menus' : 'drafts', level };
    rt.navigate(S.VIEW);
  } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger', 'Context menus'); }
}

export const plugin: AxfWebLibrary = {
  id: S.ID,
  label: 'Context menus',
  version: '0.1.0',
  appMenu,
  uiEditor: ['manager'],
  provides: [S.CAPABILITY],
  register(rt) {
    S.publishService(rt);
    void S.load(rt);
    rt.actions.register('context-menus.open', ([tab, menu]) => { focus = { tab: (tab as typeof focus.tab) || undefined, menu: menu || undefined }; rt.navigate(S.VIEW); }, { label: 'Open Context menus (tab: generate / drafts / menus / zones)', params: true });
    rt.actions.register('context-menus.generate', ([level, app]) => { void generate(rt, level || 'pro', app || undefined, false); }, { label: 'Generate context menus with Claude at a level (a draft to preview)', params: true });
    rt.actions.register('context-menus.preview', ([level, app]) => { void generate(rt, level || 'pro', app || undefined, false); }, { label: 'Preview Claude-generated context menus at a level', params: true });
    rt.actions.register('context-menus.apply', ([id]) => {
      const d = id ? S.getState()?.drafts.find((x) => x.id === id) : S.getState()?.drafts[0];
      if (!d) { rt.toast('No draft to apply: generate one first.', 'warning', 'Context menus'); return; }
      void S.applyDraft(d.id, true).then(() => S.load(rt)).then(() => rt.toast(`${d.menu.name} applied and in use.`, 'success', 'Context menus')).catch((e: Error) => rt.toast(e.message, 'danger', 'Context menus'));
    }, { label: 'Apply the newest (or a named) context-menu draft', params: true });
    rt.actions.register('context-menus.use', ([id]) => {
      if (!id) { focus = { tab: 'menus' }; rt.navigate(S.VIEW); return; }
      void S.useMenu(id).then(() => S.load(rt)).then(() => rt.toast(`Context menu ${id} is in use.`, 'success', 'Context menus')).catch((e: Error) => rt.toast(e.message, 'danger', 'Context menus'));
    }, { label: 'Use a context menu (by id)', params: true });
    rt.actions.register('context-menus.zones', () => { focus = { tab: 'zones' }; rt.navigate(S.VIEW); void S.reportZones(rt); }, { label: 'Open the context-menu zone map and report this screen' });
    rt.actions.register('context-menus.say', ([text]) => {
      const p = matchPhrase(text ?? '');
      if (!p) { rt.toast('Say for example "generate pro context menus" or "list context menus".', 'info', 'Context menus'); return; }
      if (p.op === 'generate') void generate(rt, p.level, p.app, false);
      else if (p.op === 'apply') rt.dispatch('context-menus.apply');
      else if (p.op === 'use') rt.dispatch(`context-menus.use:${p.id}`);
      else rt.dispatch('context-menus.open:menus');
    }, { label: 'Voice: one sentence about context menus ("generate pro context menus")', params: true });
  },
  views: {
    'context-menus': {
      title: 'Context menus',
      icon: 'menu',
      keywords: ['context menu', 'right-click', 'zones', 'generate', 'claude', 'beginner', 'pro', 'advanced'],
      render: () => { const f = focus; focus = {}; return <ContextMenusPage focus={f} />; },
    },
  },
  nav: { label: 'Plugins', items: [{ id: 'context-menus', label: 'Context menus', icon: 'menu', view: 'context-menus' }] },
  contextMenu: [
    { id: 'context-menus.default', target: 'default', order: 94, items: [{ id: 'context-menus', label: 'Context menus…', icon: 'menu', action: 'context-menus.open' }] },
    { id: 'context-menus.zone', target: 'context-menus-zone', items: [{ id: 'context-menus-zone-open', label: 'Map this zone…', icon: 'target', action: 'context-menus.zones' }] },
  ],
  settingsTabs: [{ id: 'context-menus', label: 'Context menus', icon: 'menu', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'context-menus.open', tab: 'context-menus', title: 'Context menus', icon: 'menu', order: 10, render: () => <OpenPanel /> },
    { id: 'context-menus.lifecycle', tab: 'context-menus', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={S.FOLDER} /> },
  ],
};

function OpenPanel() {
  const rt = useRuntime();
  const s = S.getState();
  return (
    <div className="fx-stack">
      <p className="fx-muted axp-ctxm-fine">{s?.onHub ? 'Menus are kept on axHub (one true source for every plugin and app).' : 'No hub mounted here: menus stay in this console’s plugin data folder until it runs on the VPS.'}</p>
      <div className="fx-row axp-ctxm-actions">
        <Button size="sm" icon="menu" onClick={() => rt.dispatch('context-menus.open')}>Open Context menus</Button>
        <Button size="sm" icon="sparkles" onClick={() => rt.dispatch('context-menus.open:generate')}>Generate…</Button>
      </div>
    </div>
  );
}
