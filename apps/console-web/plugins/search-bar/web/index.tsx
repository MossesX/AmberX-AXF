/**
 * Search bar console plugin (ai.amberx.axf.console.search-bar).
 *
 * Replaces the console's old "Search everything" box: while this plugin is on it draws every `search-bar` widget asset
 * (the banner's, any toolbar's, and the extra bars it places), so there is one search everywhere and it is this one.
 * Switched off, the framework's plain search box comes back (the plugin stays removable).
 *
 * Deep links / API (every action is also a console action on REST + MCP + CLI through plugin-commands@1, and voice):
 *   search-bar.open[:<query>]                  focus the main bar, type the query, show the drop-down
 *   search-bar.scope:<everything|settings>      globe / gear on the main bar (or `:<scope>:<bar id>`)
 *   search-bar.mode:<words|prefix|exact|regex>  matching mode   · search-bar.option:<caseSensitive|details>=<on|off>
 *   search-bar.ai:<on|off>                      AI assistance (used only with an Ollama connection)
 *   search-bar.go:<result id>                   go to a result (e.g. setting:axf.display.fontScale)
 *   search-bar.set:<setting key>=<value>        quick-set a setting, check-mark toast
 *   search-bar.add:<banner|toolbar>[:<bar|compact|icon>[:<everything|settings>]]   place another bar
 *   search-bar.remove:<bar id>                  take a placed bar off · search-bar.settings  open its settings
 * Server reads: GET /state (every open bar: scope, query, counts per category), GET /config, GET /ai.
 */
import { useEffect, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, SelectField, Switch, registerWidgetRenderer, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './search-bar.css';
import { MODES, parseValue, type Mode, type Scope } from './match.mjs';
import { SearchBarView, type BarData } from './SearchBar';
import { FOLDER, ID, PLACED_KEY, VIEWS, VIEW_LABELS, addPlaced, aiOn, findInstance, loadAi, loadConfig, paintPlaced, placedList, removePlaced, saveConfig, useSearchState } from './store';
import { appMenu } from './menu';

const MODE_LABELS: Record<Mode, string> = { words: 'Words (any order, anywhere)', prefix: 'Word starts', exact: 'Exact phrase', regex: 'Regular expression' };

/** Built-in bars (assets of the framework's `search-bar` type): pick one in any banner / toolbar like any other widget. */
const BUILT_IN = [
  { id: 'globe-bar', name: 'Search everything (globe)', view: 'bar', scope: 'everything', width: 'regular', placeholder: 'Search everything…' },
  { id: 'gear-bar', name: 'Search settings (gear)', view: 'bar', scope: 'settings', width: 'regular', placeholder: 'Search settings…' },
  { id: 'globe-compact', name: 'Search everything, compact', view: 'compact', scope: 'everything', width: 'compact', placeholder: 'Search…' },
  { id: 'globe-icon', name: 'Search everything, icon', view: 'icon', scope: 'everything', width: 'compact', placeholder: 'Search everything…' },
];

function registerAssets(rt: AxfRuntime) {
  for (const b of BUILT_IN) {
    rt.registry.register({
      $axf: 'asset@1', type: 'search-bar', id: b.id, name: b.name, version: '0.1.0', author: 'Search bar plugin', tags: ['search', 'widget'],
      description: `Live search with a category column and a tree of matches; ${b.scope === 'settings' ? 'settings only (gear)' : 'everything (globe)'}; ${VIEW_LABELS[b.view]}.`,
      data: { placeholder: b.placeholder, maxResults: 25, width: b.width, shortcut: false, view: b.view, scope: b.scope },
    }, 'app', ID);
  }
}

const say = (rt: AxfRuntime, text: string) => rt.toast(text, 'success', 'Search bar');
const args = (a: string[]) => a.join(':');

function registerActions(rt: AxfRuntime) {
  rt.actions.register('search-bar.open', (a) => {
    const i = findInstance();
    if (!i) { rt.toast('No search bar is on screen. Add one: Search bar settings → Bars.', 'warning', 'Search bar'); return; }
    i.show(a.length ? args(a) : undefined);
  }, { label: 'Open the search bar', params: false });
  rt.actions.register('search-bar.scope', ([s, which]) => {
    const scope: Scope = s === 'settings' || s === 'gear' ? 'settings' : 'everything';
    const i = findInstance(which);
    if (!i) return;
    i.setScope(scope);
    say(rt, scope === 'settings' ? 'Searching settings only' : 'Searching everything');
  }, { label: 'Search bar scope: everything or settings', params: true });
  rt.actions.register('search-bar.mode', ([m]) => {
    if (!(MODES as string[]).includes(m ?? '')) { rt.toast(`Mode is one of ${MODES.join(', ')}.`, 'warning', 'Search bar'); return; }
    void saveConfig({ mode: m as Mode }).then((err) => (err ? rt.toast(err, 'danger', 'Search bar') : say(rt, `Matching: ${MODE_LABELS[m as Mode]}`)));
  }, { label: 'Search bar matching mode', params: true });
  rt.actions.register('search-bar.option', (a) => {
    const [k, v] = args(a).split('=');
    if (k !== 'caseSensitive' && k !== 'details') { rt.toast('Option is caseSensitive or details.', 'warning', 'Search bar'); return; }
    const on = parseValue(undefined, v);
    void saveConfig({ [k]: on === true }).then((err) => (err ? rt.toast(err, 'danger', 'Search bar') : say(rt, `${k} ${on === true ? 'on' : 'off'}`)));
  }, { label: 'Search bar option', params: true });
  rt.actions.register('search-bar.ai', ([v]) => {
    const on = parseValue(undefined, v) === true;
    void saveConfig({ ai: on }).then((err) => (err ? rt.toast(err, 'danger', 'Search bar') : say(rt, on ? (aiOn() ? 'AI ranking on (local Llama)' : 'AI assistance on; no Ollama connection, so built-in matching stays') : 'AI ranking off')));
  }, { label: 'Search bar AI assistance on/off', params: true });
  rt.actions.register('search-bar.go', (a) => {
    const id = args(a);
    const e = rt.search.entries().find((x) => x.id === id);
    if (!e) { rt.toast(`No result "${id}".`, 'warning', 'Search bar'); return; }
    rt.search.focus(e);
  }, { label: 'Go to a search result', params: true });
  rt.actions.register('search-bar.set', (a) => {
    const raw = args(a);
    const at = raw.indexOf('=');
    const key = at > 0 ? raw.slice(0, at) : raw;
    const spec = rt.settings.spec(key);
    const value = parseValue(spec as never, at > 0 ? raw.slice(at + 1) : '');
    if (!spec || value === undefined) { rt.toast(`Can't set "${key}" to that.`, 'warning', 'Search bar'); return; }
    if (spec.requires && rt.gate(spec.requires) !== 'allow') { rt.toast(`"${spec.label}" needs ${spec.requires}.`, 'warning', 'Locked'); return; }
    rt.settings.set(key, value as never);
    rt.toast(`✓ ${spec.label}`, 'success');
  }, { label: 'Quick-set a setting (key=value)', params: true });
  rt.actions.register('search-bar.add', ([host, view, scope]) => {
    const p = addPlaced(rt, host === 'toolbar' ? 'toolbar' : 'banner', view ?? 'bar', scope === 'settings' ? 'settings' : 'everything');
    say(rt, `Search bar ${p.id} added to the ${p.host}`);
  }, { label: 'Add a search bar to the banner or a toolbar', params: true });
  rt.actions.register('search-bar.remove', ([id]) => { if (id && removePlaced(rt, id)) say(rt, `Search bar ${id} removed`); }, { label: 'Remove a placed search bar', params: true });
  rt.actions.register('search-bar.settings', () => rt.dispatch('settings.open:search-bar'), { label: 'Search bar settings', params: false });
  rt.actions.register('search-bar.focus', () => rt.dispatch('search-bar.open'), { label: 'Focus the search bar', params: false });
}

/* ---------------- settings panels ---------------- */

function MatchingPanel() {
  const s = useSearchState();
  const [msg, setMsg] = useState('');
  const save = (p: Parameters<typeof saveConfig>[0]) => void saveConfig(p).then((e) => setMsg(e || 'Saved.'));
  const nums = (n: number[]) => n.map((x) => ({ value: String(x), label: String(x) }));
  return (
    <div className="fx-stack">
      <SelectField label="Matching" value={s.options.mode} options={MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))} onChange={(v) => save({ mode: v as Mode })}
        hint="Regular expression: the text is a JavaScript pattern, matched against each name (and, with details on, where it lives)." />
      <Switch label="Case-sensitive" checked={s.options.caseSensitive} onChange={(v) => save({ caseSensitive: v })} />
      <Switch label="Also match where it lives and its keywords" checked={s.options.details} onChange={(v) => save({ details: v })} />
      <SelectField label="Results per category" value={String(s.options.perCategory)} options={nums([5, 10, 25, 50, 100])} onChange={(v) => save({ perCategory: Number(v) })} />
      <SelectField label="Results in all" value={String(s.options.total)} options={nums([50, 100, 200, 500, 1000])} onChange={(v) => save({ total: Number(v) })} />
      {msg && <p className="fx-small" role="status">{msg}</p>}
    </div>
  );
}

function AiPanel() {
  const s = useSearchState();
  const [msg, setMsg] = useState('');
  useEffect(() => { void loadAi(); }, []);
  const why = !s.ai.capability ? 'No AI assistant capability is installed.' : !s.ai.ollama ? 'No Ollama (local Llama) provider is connected.' : !s.aiEnabled ? 'AI assistance is off.' : `Using ${s.ai.profile}.`;
  return (
    <div className="fx-stack">
      <Switch label="Use AI assistance to rank results" checked={s.aiEnabled} onChange={(v) => void saveConfig({ ai: v }).then((e) => setMsg(e || 'Saved.'))}
        hint="Only with an Ollama (local Llama) connection. Without it, the bar uses its own matching and sends nothing anywhere." />
      <p className="fx-small">{aiOn(s) ? 'AI ranking is on.' : 'Built-in matching.'} {why}</p>
      <Button icon="refresh" onClick={() => void loadAi()}>Check again</Button>
      {msg && <p className="fx-small" role="status">{msg}</p>}
    </div>
  );
}

function BarsPanel() {
  const rt = useRuntime();
  useSearchState();
  const [, bump] = useState(0);
  const [host, setHost] = useState('banner');
  const [view, setView] = useState('bar');
  const [scope, setScope] = useState('everything');
  const list = placedList(rt);
  return (
    <div className="fx-stack">
      <p className="fx-small">The banner's search bar is drawn by this plugin. Add more here, or pick any “Search …” widget in a banner or toolbar's Widgets menu; Arrange mode snaps them where you drop them.</p>
      <div className="axp-search-bar__addrow">
        <SelectField label="Where" value={host} options={[{ value: 'banner', label: 'Banner' }, { value: 'toolbar', label: 'Toolbar' }]} onChange={setHost} />
        <SelectField label="View" value={view} options={VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v]! }))} onChange={setView} />
        <SelectField label="Searches" value={scope} options={[{ value: 'everything', label: 'Everything (globe)' }, { value: 'settings', label: 'Settings only (gear)' }]} onChange={setScope} />
        <Button tone="primary" icon="plus" onClick={() => { rt.dispatch(`search-bar.add:${host}:${view}:${scope}`); bump((n) => n + 1); }}>Add</Button>
      </div>
      {list.length === 0 && <p className="fx-small">No extra bars yet.</p>}
      {list.map((p) => (
        <div key={p.id} className="fx-row fx-row--wrap">
          <span className="fx-mono fx-small">{p.id}</span>
          <span className="fx-small">{p.host} · {VIEW_LABELS[p.view] ?? p.view} · {p.scope === 'settings' ? 'settings' : 'everything'}</span>
          <Button icon="x" onClick={() => { removePlaced(rt, p.id); bump((n) => n + 1); }}>Remove</Button>
        </div>
      ))}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID,
  label: 'Search bar',
  version: '0.1.0',
  provides: ['widget.search-bar'],
  register(rt) {
    // This plugin draws every search-bar widget: the old "Search everything" box no longer appears anywhere.
    registerWidgetRenderer<BarData>('search-bar', SearchBarView);
    registerAssets(rt);
    registerActions(rt);
    paintPlaced(rt);
    rt.settings.onChange(PLACED_KEY, () => paintPlaced(rt));
    void loadConfig();
  },
  settingsTabs: [{ id: 'search-bar', label: 'Search bar', icon: 'search', parent: 'plugins', order: 48, description: 'Matching, AI assistance and the search bars on the banner and toolbars.' }],
  settingsPanels: [
    { id: 'search-bar.matching', tab: 'search-bar', title: 'Matching', icon: 'search', order: 10, render: () => <MatchingPanel /> },
    { id: 'search-bar.ai', tab: 'search-bar', title: 'AI assistance', icon: 'sparkles', order: 20, render: () => <AiPanel /> },
    { id: 'search-bar.bars', tab: 'search-bar', title: 'Bars', icon: 'layout', order: 30, render: () => <BarsPanel /> },
    { id: 'search-bar.lifecycle', tab: 'search-bar', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

