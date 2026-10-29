/**
 * Plugin theme override (`ai.amberx.axf.plugintheme`, web; Brett Oct 28 2026; refactor-all s72–s75, Opus).
 *
 * Every plugin UI gets a theme override on top of the app's (axHub) theme: Settings → Plugins → <plugin> → Appearance
 * holds a "Theme override" switch and, in a collapsible container, every layout / colour / style / animation token,
 * edited in three views (token tree with tri-state groups and search, grouped form, raw JSON), copied from another
 * plugin or a theme asset, reset per token / group / all, with a live preview. Switchable from right-click (inside any
 * plugin UI), the toolbar button and the application menu's Plugins ladder (`plugin-theme.toggle:<pluginId>`).
 *
 *   import { pluginThemeLibrary, withPluginTheme } from '<app>/axf/libs/plugintheme';
 *   installLibraries(rt, [settingsLibrary, pluginThemeLibrary, ...plugins.map((p) => withPluginTheme(p.library, { id, name }))]);
 *
 * `withPluginTheme` is the only per-app step: it marks every UI root of the plugin (views, dialogs, window / tab-group
 * tabs, its settings tab and panels) with `data-axf-plugin="<id>"` and adds the Appearance panel to its settings tab, so
 * no plugin needs code of its own. Storage and CSS: ./core.ts. UI-editor rules: last save wins (one key per plugin),
 * fresh on focus (useEditorSync).
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import './plugintheme.css';
import { Button, Checkbox, Chip, ColorField, Container, IconButton, Note, Segmented, SelectField, Slider, Switch, TextField, useEditorSync, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import type { AxfRuntime } from '../../core/runtime';
import type { ColorThemeData, StyleThemeData } from '../../core';
import {
  EDITOR_ATTR, LIBRARY_ID, PLUGIN_ATTR, PLUGIN_LOOK_COUNTER, PLUGIN_LOOK_KEY, PLUGIN_THEME_GROUPS, changedCount, groupState, lookJson, mergeTokens,
  normalizePluginLook, normalizeTokenValue, numberOf, numberValue, parseLookJson, pluginThemeCss, resetTokens, searchTokens, setToken, storedLook,
  tokensFromThemes, tokensIn, validPluginId, type PluginLook, type PluginThemeGroup, type PluginThemeToken,
} from './core';

export * from './core';

/** Show the toolbar button (default on). */
export const TOOLBAR_KEY = 'axf.pluginTheme.toolbar';
const BUTTON_ID = 'plugin-theme';
const STYLE_ID = 'axf-plugin-theme';
const CTX = '*:plugin-theme';

/* ---------------- which plugins there are ---------------- */

export interface PluginThemeMeta {
  /** plugin id (the scope attribute's value) */
  id: string;
  name: string;
  /** the settings tab holding its Appearance panel */
  tab: string;
  /** its views (the toolbar button picks the plugin of the page on screen) */
  views: string[];
}
const metas = new Map<string, PluginThemeMeta>();
let runtime: AxfRuntime | null = null;
/** The plugin UI the pointer was last in (right-click, tap), for the context menu and the toolbar button. */
let lastPlugin: string | null = null;

/** Every plugin that has a theme override UI (registered by withPluginTheme), by name. */
export function pluginThemePlugins(): PluginThemeMeta[] {
  return [...metas.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const readLook = (rt: AxfRuntime, id: string): PluginLook => normalizePluginLook(rt.settings.get(PLUGIN_LOOK_KEY(id)));
const saveLook = (rt: AxfRuntime, id: string, look: PluginLook) => rt.settings.set(PLUGIN_LOOK_KEY(id), storedLook(look) as never);

/** Switch one plugin's override on or off (the menus and the toolbar). */
export function togglePluginTheme(rt: AxfRuntime, id: string, on?: boolean): boolean {
  const meta = metas.get(id);
  if (!meta) return false;
  const look = readLook(rt, id);
  const next = on ?? !look.on;
  saveLook(rt, id, { ...look, on: next });
  const n = changedCount(look);
  rt.toast(next ? (n ? `${meta.name}: theme override on (${n} token${n === 1 ? '' : 's'}).` : `${meta.name}: theme override on. Nothing is changed yet: edit it in Settings → Plugins → ${meta.name} → Appearance.`) : `${meta.name}: theme override off, the app’s theme again.`, 'info', 'Theme override');
  return true;
}

/** The plugin the toolbar button means: the one last pointed at, else the one whose page is on screen. */
function currentPlugin(rt: AxfRuntime): string | null {
  if (lastPlugin && metas.has(lastPlugin)) return lastPlugin;
  const view = (rt.getState() as { view?: string }).view;
  return [...metas.values()].find((m) => view && m.views.includes(view))?.id ?? null;
}

/* ---------------- scope + stylesheet ---------------- */

/** A plugin UI root: no box of its own, carries the scope attribute. */
export function PluginScope({ id, children }: { id: string; children: ReactNode }) {
  return <div className="fx-plugin-scope" {...{ [PLUGIN_ATTR]: id }}>{children}</div>;
}

function apply(rt: AxfRuntime) {
  const looks: Record<string, unknown> = {};
  for (const id of metas.keys()) {
    looks[id] = rt.settings.get(PLUGIN_LOOK_KEY(id));
    rt.setBadge(PLUGIN_LOOK_COUNTER(id), normalizePluginLook(looks[id]).on ? 1 : 0);
  }
  const doc = globalThis.document;
  if (!doc) return;
  // the appearance lock sets this device's own look aside: overrides are kept, not applied
  const css = pluginThemeCss(looks, { locked: rt.appearanceLocked() });
  let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) { el?.remove(); return; }
  if (!el) { el = doc.createElement('style'); el.id = STYLE_ID; doc.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

/* ---------------- the plugin wrapper ---------------- */

/**
 * Give a plugin's web library its theme override: every UI root carries data-axf-plugin, its settings tab gets the
 * Appearance panel (a plugin without a settings tab gets one under Settings → Plugins holding just that). Pure wrapper:
 * the plugin's own code is untouched, and everything added goes with the plugin (same module id).
 */
export function withPluginTheme(lib: AxfWebLibrary, meta: { id: string; name: string }): AxfWebLibrary {
  const { id, name } = meta;
  if (!validPluginId(id)) return lib;
  const scope = (node: ReactNode) => <PluginScope id={id}>{node}</PluginScope>;
  const ownTab = lib.settingsTabs?.[0]?.id;
  const tab = ownTab ?? `${id}.appearance`;
  const views = Object.fromEntries(Object.entries(lib.views ?? {}).map(([k, v]) => [k, { ...v, render: () => scope(v.render()) }]));
  const dialogs = Object.fromEntries(Object.entries(lib.dialogs ?? {}).map(([k, d]) => [k, { ...d, render: (p: Record<string, unknown>, close: () => void) => scope(d.render(p, close)) }]));
  const tabs = Object.fromEntries(Object.entries(lib.tabs ?? {}).map(([k, r]) => [k, (t: Parameters<typeof r>[0]) => scope(r(t))]));
  const settingsTabs = ownTab
    ? lib.settingsTabs!.map((t) => ({ ...t, plugin: id }))
    : [{ id: tab, label: name, icon: 'palette', order: 900, parent: 'plugins', plugin: id, description: `${name} has no settings of its own; its look can still be changed here.` }];
  const panels = (lib.settingsPanels ?? []).map((p) => ({ ...p, render: () => scope(p.render() as ReactNode) }));
  return {
    ...lib,
    ...(lib.views ? { views } : {}),
    ...(lib.dialogs ? { dialogs } : {}),
    ...(lib.tabs ? { tabs } : {}),
    settingsTabs,
    settingsPanels: [...panels, { id: `${id}.theme-override`, tab, title: 'Appearance', icon: 'palette', order: 950, render: () => <PluginThemePanel id={id} name={name} /> }],
    register(rt) {
      metas.set(id, { id, name, tab, views: Object.keys(lib.views ?? {}) });
      lib.register?.call(lib, rt);
      if (runtime) apply(runtime);
    },
  };
}

/* ---------------- helpers for the editor ---------------- */

/** What a token is right now on the page (the app's theme under any override), for "start from the current value". */
function computed(name: string, id?: string): string {
  const doc = globalThis.document;
  if (!doc?.body) return '';
  const el = (id && doc.querySelector(`[${PLUGIN_ATTR}="${id}"]:not(.fx-plugin-scope)`)) || doc.body;
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** rgb()/rgba()/#rgb → #rrggbb for the colour picker (alpha dropped), else undefined. (theme-ok: text) */
export function toHex(css: string): string | undefined {
  const s = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  return m ? `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}` : undefined;
}

/** The value a token starts from when ticked in the tree: what the page shows now, checked; else the token's middle. */
function startValue(t: PluginThemeToken): string {
  const cur = normalizeTokenValue(t.name, computed(t.name));
  if (cur) return cur;
  if (t.kind === 'choice' || t.kind === 'colour') return t.options?.[0]?.value ?? '';
  return numberValue(t, ((t.min ?? 0) + (t.max ?? 0)) / 2);
}

function usePluginLook(id: string): [PluginLook, (next: PluginLook) => void] {
  const rt = useRuntime();
  const key = PLUGIN_LOOK_KEY(id);
  const [, setTick] = useState(0);
  // UI-editor rule: fresh on focus (re-read saved values whenever the editor opens or comes back)
  useEditorSync({ onRefresh: () => setTick((n) => n + 1) });
  const sub = useMemo(() => (fn: () => void) => rt.settings.onChange(key, fn), [rt, key]);
  const raw = useSyncExternalStore(sub, () => JSON.stringify(rt.settings.get(key) ?? null), () => 'null');
  const look = useMemo(() => normalizePluginLook(JSON.parse(raw)), [raw]);
  return [look, (next) => saveLook(rt, id, next)];
}

/* ---------------- the Appearance panel ---------------- */

type ViewMode = 'form' | 'tree' | 'json';
const VIEW_KEY = 'axf.pluginTheme.view';

/** Settings → Plugins → <plugin> → Appearance. Drawn with the app's theme (EDITOR_ATTR), so a bad override can always be undone. */
export function PluginThemePanel({ id, name }: { id: string; name: string }) {
  const rt = useRuntime();
  const [look, save] = usePluginLook(id);
  const locked = rt.gate('assets.swap') !== 'allow';
  const lookLocked = rt.appearanceLocked();
  const [mode, setModeState] = useState<ViewMode>(() => (['form', 'tree', 'json'].includes(String(rt.settings.get(VIEW_KEY))) ? rt.settings.get(VIEW_KEY) as ViewMode : 'form'));
  const setMode = (m: ViewMode) => { setModeState(m); rt.settings.set(VIEW_KEY, m); };
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  const n = changedCount(look);
  return (
    <div className="fx-stack axf-plugintheme" {...{ [EDITOR_ATTR]: id }}>
      <p className="fx-muted" style={{ margin: 0 }}>{name} uses the app’s theme. Switch the override on to give it its own tokens on top of that theme: only what you change here is overridden, the rest follows the app (and a theme swap).</p>
      <fieldset className="axf-plugintheme__fieldset" disabled={locked}>
        <Switch label="Theme override" hint={look.on ? `${n} token${n === 1 ? '' : 's'} overridden in ${name}’s pages, dialogs, windows and settings.` : 'Off: the app’s theme.'} checked={look.on} onChange={(on) => save({ ...look, on })} />
        {lookLocked && look.on && <Note tone="warning">The look is locked (Settings → Appearance → Lock the look): the override is kept but not applied until it is unlocked.</Note>}
        {look.on && (
          <Container title={`Theme override tokens${n ? ` (${n} changed)` : ''}`} icon="sliders" collapsible defaultOpen>
            <div className="fx-stack">
              <div className="fx-row fx-row--wrap axf-plugintheme__bar">
                <Segmented label="Edit as" size="sm" value={mode} onChange={setMode} options={[{ value: 'form', label: 'Form', icon: 'sliders' }, { value: 'tree', label: 'Token tree', icon: 'list' }, { value: 'json', label: 'JSON', icon: 'code' }]} />
                <Button size="sm" tone={sure ? 'danger' : 'ghost'} icon="refresh" disabled={!n} onClick={() => { if (!sure) { setSure(true); return; } setSure(false); save(resetTokens(look)); }}>
                  {sure ? 'Tap again to reset all' : 'Reset all'}
                </Button>
              </div>
              <CopyFrom id={id} look={look} save={save} />
              {mode === 'form' && <FormView id={id} look={look} save={save} />}
              {mode === 'tree' && <TreeView look={look} save={save} />}
              {mode === 'json' && <JsonView look={look} save={save} />}
              <Preview id={id} name={name} />
            </div>
          </Container>
        )}
      </fieldset>
    </div>
  );
}

interface EditProps { look: PluginLook; save: (next: PluginLook) => void }

/** Copy every token from another plugin's override or a colour / style theme asset (merge, or replace). */
function CopyFrom({ id, look, save }: EditProps & { id: string }) {
  const rt = useRuntime();
  const [src, setSrc] = useState('');
  const [replace, setReplace] = useState(false);
  const others = pluginThemePlugins().filter((m) => m.id !== id && changedCount(readLook(rt, m.id)) > 0);
  const options = [
    ...others.map((m) => ({ value: `plugin:${m.id}`, label: `Plugin: ${m.name} (${changedCount(readLook(rt, m.id))})` })),
    ...rt.registry.list('color-theme').map((a) => ({ value: `color-theme:${a.id}`, label: `Colour theme: ${a.name}` })),
    ...rt.registry.list('style-theme').map((a) => ({ value: `style-theme:${a.id}`, label: `Style theme: ${a.name}` })),
  ];
  const copy = () => {
    const [kind, ...rest] = src.split(':');
    const ref = rest.join(':');
    const tokens = kind === 'plugin' ? readLook(rt, ref).tokens
      : kind === 'color-theme' ? tokensFromThemes(rt.registry.get('color-theme', ref)?.data as ColorThemeData | undefined)
        : kind === 'style-theme' ? tokensFromThemes(null, rt.registry.get('style-theme', ref)?.data as StyleThemeData | undefined) : {};
    const next = mergeTokens(look, tokens, replace);
    save(next);
    rt.toast(`Copied ${Object.keys(tokens).length} token${Object.keys(tokens).length === 1 ? '' : 's'}${replace ? ' (replaced the rest)' : ''}.`, 'success', 'Theme override');
  };
  return (
    <div className="fx-row fx-row--wrap axf-plugintheme__copy">
      <SelectField label="Copy from" value={src} onChange={setSrc} empty="Pick another plugin or a theme…" options={options} className="axf-plugintheme__grow" />
      <Switch label="Replace" checked={replace} onChange={setReplace} />
      <Button size="sm" icon="copy" disabled={!src} onClick={copy}>Copy</Button>
    </div>
  );
}

/** One token's control: slider, colour or choice, with its reset. */
function TokenControl({ id, token: t, look, save }: EditProps & { id: string; token: PluginThemeToken }) {
  const set = look.tokens[t.name];
  const reset = <IconButton icon="undo" label={`Reset ${t.label}`} disabled={set === undefined} onClick={() => save(setToken(look, t.name, null))} />;
  let control: ReactNode;
  if (t.kind === 'colour') {
    control = (
      <div className="fx-row fx-row--wrap axf-plugintheme__colour">
        <ColorField label={`${t.label}`} value={set ?? ''} swatch={toHex(computed(t.name, id))} onChange={(v) => save(setToken(look, t.name, v || null))} hint={set ? undefined : 'The app’s theme. Pick a colour or type one (hex, rgb(), var(--fx-accent)).'} className="axf-plugintheme__grow" /> {/* theme-ok: example text, not a style */}
        <SelectField label="Or a theme colour" value={t.options?.some((o) => o.value === set) ? set! : ''} empty="—" options={t.options ?? []} onChange={(v) => save(setToken(look, t.name, v || null))} />
      </div>
    );
  } else if (t.kind === 'choice') {
    control = <SelectField label={t.label} value={set ?? ''} empty="The app’s theme" options={[...(t.options ?? []), ...(set && !t.options?.some((o) => o.value === set) ? [{ value: set, label: set }] : [])]} onChange={(v) => save(setToken(look, t.name, v || null))} className="axf-plugintheme__grow" />;
  } else {
    const num = numberOf(set ?? computed(t.name, id)) ?? t.min ?? 0;
    control = <div className="axf-plugintheme__grow"><Slider label={`${t.label}${set === undefined ? ' (theme)' : ''}`} value={num} min={t.min} max={t.max} step={t.step} unit={t.unit} onChange={(v) => save(setToken(look, t.name, numberValue(t, v)))} /></div>;
  }
  return (
    <div className="fx-row axf-plugintheme__token" title={t.hint ? `${t.name} — ${t.hint}` : t.name}>
      {control}
      {reset}
    </div>
  );
}

/** Grouped form: one collapsible container per group, framework controls only. */
function FormView({ id, look, save }: EditProps & { id: string }) {
  return (
    <div className="fx-stack">
      {PLUGIN_THEME_GROUPS.map((g, i) => {
        const c = changedCount(look, g.id);
        return (
          <Container key={g.id} title={`${g.label}${c ? ` (${c})` : ''}`} icon={g.icon} collapsible defaultOpen={i === 0}
            actions={<IconButton icon="undo" label={`Reset ${g.label}`} disabled={!c} onClick={() => save(resetTokens(look, g.id))} />}>
            <div className="fx-stack">
              <p className="fx-muted" style={{ margin: 0 }}>{g.hint}</p>
              {tokensIn(g.id).map((t) => <TokenControl key={t.name} id={id} token={t} look={look} save={save} />)}
            </div>
          </Container>
        );
      })}
    </div>
  );
}

/** Token tree: groups with tri-state ticks (all / some / none overridden), every token under them, search. */
function TreeView({ look, save }: EditProps) {
  const [q, setQ] = useState('');
  const setGroup = (g: PluginThemeGroup, on: boolean) => {
    if (!on) return save(resetTokens(look, g));
    let next = look;
    for (const t of tokensIn(g)) if (!(t.name in next.tokens)) next = setToken(next, t.name, startValue(t));
    save(next);
  };
  return (
    <div className="fx-stack">
      <TextField label="Search tokens" value={q} onChange={setQ} placeholder="space, accent, radius, --fx-motion…" />
      <ul className="axf-plugintheme__tree" role="tree">
        {PLUGIN_THEME_GROUPS.map((g) => {
          const hits = searchTokens(q, g.id);
          if (!hits.length) return null;
          const st = groupState(look, g.id);
          return (
            <li key={g.id} role="treeitem" aria-expanded="true">
              <Checkbox label={<strong>{g.label} <span className="fx-muted">{changedCount(look, g.id)} / {tokensIn(g.id).length}</span></strong>} checked={st === 'all'} indeterminate={st === 'some'} onChange={(on) => setGroup(g.id, on)} />
              <ul className="axf-plugintheme__leaves" role="group">
                {hits.map((t) => (
                  <li key={t.name} role="treeitem" className="fx-row axf-plugintheme__leaf">
                    <Checkbox label={<>{t.label} <code className="fx-muted">{t.name}</code></>} checked={t.name in look.tokens} onChange={(on) => save(setToken(look, t.name, on ? startValue(t) : null))} />
                    {t.name in look.tokens && <Chip>{look.tokens[t.name]}</Chip>}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {PLUGIN_THEME_GROUPS.every((g) => !searchTokens(q, g.id).length) && <p className="fx-muted">No token matches “{q.trim()}”.</p>}
      <p className="fx-muted" style={{ margin: 0 }}>A tick overrides the token, starting from the value it has now; untick to give it back to the app’s theme. Change values in the form or the JSON.</p>
    </div>
  );
}

/** Raw JSON: the stored shape, applied on Apply (unknown tokens and bad values are dropped and listed). */
function JsonView({ look, save }: EditProps) {
  const text = lookJson(look);
  const [draft, setDraft] = useState(text);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'warning' | 'success'; text: string } | null>(null);
  useEffect(() => { setDraft(text); }, [text]);
  const applyJson = () => {
    const r = parseLookJson(draft);
    if (!r.look) { setMsg({ tone: 'danger', text: r.error ?? 'Not an override.' }); return; }
    save({ ...r.look, on: true });
    setMsg(r.dropped.length ? { tone: 'warning', text: `Applied. Dropped (unknown token or bad value): ${r.dropped.join(', ')}` } : { tone: 'success', text: 'Applied.' });
  };
  return (
    <div className="fx-stack">
      <TextField label="Override (JSON)" value={draft} onChange={setDraft} rows={14} mono hint={'{ "on": true, "tokens": { "--fx-space": "10px", "--fx-accent": "var(--fx-info)" } }'} /> {/* theme-ok: example text, not a style */}
      <div className="fx-row fx-row--wrap">
        <Button size="sm" tone="primary" icon="check" disabled={draft === text} onClick={applyJson}>Apply</Button>
        <Button size="sm" tone="ghost" icon="undo" disabled={draft === text} onClick={() => { setDraft(text); setMsg(null); }}>Revert</Button>
      </div>
      {msg && <Note tone={msg.tone === 'danger' ? 'danger' : msg.tone === 'warning' ? 'warning' : 'success'}>{msg.text}</Note>}
    </div>
  );
}

/** Live preview: a few framework controls drawn with the override (the plugin's attribute again inside the editor). */
function Preview({ id, name }: { id: string; name: string }) {
  const [sw, setSw] = useState(true);
  const [v, setV] = useState(40);
  return (
    <div className="fx-card axf-plugintheme__preview" {...{ [PLUGIN_ATTR]: id }} aria-label={`Preview of ${name} with its override`}>
      <div className="fx-stack">
        <strong>Preview</strong>
        <p className="fx-muted" style={{ margin: 0 }}>{name}’s own pages change the same way as you edit.</p>
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="check">Primary</Button>
          <Button icon="star">Neutral</Button>
          <Button tone="danger" icon="trash">Danger</Button>
          <Chip tone="accent">Chip</Chip>
          <Chip tone="success">Done</Chip>
        </div>
        <Switch label="A switch" checked={sw} onChange={setSw} />
        <Slider label="A slider" value={v} onChange={setV} unit="%" />
      </div>
    </div>
  );
}

/* ---------------- the library ---------------- */

/** Toolbar button (a framework action-button widget, attached at run time; the toolbar asset is never edited). */
function toolbarButton(rt: AxfRuntime) {
  if (rt.settings.get(TOOLBAR_KEY) === false) { rt.detachFromHost('toolbar', `action-button:${BUTTON_ID}`); return; }
  if (!rt.registry.has('action-button', BUTTON_ID)) {
    rt.registry.register({
      $axf: 'asset@1', type: 'action-button', id: BUTTON_ID, name: 'Theme override', version: '0.1.0', author: 'AmberX AXF',
      description: 'Switches the theme override of the plugin on screen (or last right-clicked) on or off.', tags: ['plugins', 'theme'],
      data: { icon: 'palette', label: 'Theme override', action: 'plugin-theme.toggle', show: 'icon', tooltip: 'Plugin theme override on / off' },
    }, 'app', LIBRARY_ID);
  }
  if (!rt.hostAttachments('toolbar').some((a) => a.type === 'action-button' && a.id === BUTTON_ID)) rt.attachToHost('toolbar', { type: 'action-button', id: BUTTON_ID, at: 'end', order: 60, origin: LIBRARY_ID });
}

export const pluginThemeLibrary: AxfWebLibrary = {
  id: LIBRARY_ID,
  label: 'Plugin theme override',
  version: '0.1.0',
  uiEditor: ['theme', 'style'],
  register(rt) {
    runtime = rt;
    apply(rt);
    rt.settings.subscribe(() => apply(rt));
    let locked = rt.appearanceLocked();
    rt.subscribe(() => { if (rt.appearanceLocked() !== locked) { locked = rt.appearanceLocked(); apply(rt); } });
    // which plugin UI the pointer is in (capture: runs before the context-menu host opens the menu)
    const track = (e: Event) => { lastPlugin = (e.target as Element | null)?.closest?.(`[${PLUGIN_ATTR}]:not([${EDITOR_ATTR}])`)?.getAttribute(PLUGIN_ATTR) ?? null; };
    globalThis.document?.addEventListener('contextmenu', track, true);
    globalThis.document?.addEventListener('pointerdown', track, true);
    rt.actions.register('plugin-theme.toggle', ([pid]) => {
      const id = pid || currentPlugin(rt);
      if (!id || !togglePluginTheme(rt, id)) rt.toast('Open a plugin’s page (or right-click inside one) first: the theme override belongs to a plugin.', 'info', 'Theme override');
    }, { label: 'Plugin theme override on / off', params: true });
    rt.actions.register('plugin-theme.edit', ([pid]) => {
      const m = metas.get(pid || currentPlugin(rt) || '');
      if (m) rt.dispatch(`settings.open:${m.tab}`);
    }, { label: 'Edit a plugin’s theme override', params: true });
    // right-click inside any plugin UI: its override (runtime contribution; the context-menu asset is untouched)
    rt.contextExtras.set(CTX, () => {
      const m = lastPlugin ? metas.get(lastPlugin) : undefined;
      if (!m) return [];
      return [
        { id: 'plugin-theme.toggle', label: `Theme override: ${m.name}`, icon: 'palette', action: `plugin-theme.toggle:${m.id}`, checked: `counter:${PLUGIN_LOOK_COUNTER(m.id)}` },
        { id: 'plugin-theme.edit', label: 'Edit theme override…', icon: 'sliders', action: `plugin-theme.edit:${m.id}` },
      ];
    });
    toolbarButton(rt);
    rt.settings.onChange(TOOLBAR_KEY, () => toolbarButton(rt));
  },
  settings: [{
    id: 'axf.pluginTheme', label: 'Plugin theme override', icon: 'palette', tab: 'plugins', order: 30,
    description: 'Each plugin’s own theme override lives in its settings: Settings → Plugins → <plugin> → Appearance.',
    settings: [{ key: TOOLBAR_KEY, label: 'Theme override button on the toolbar', kind: 'toggle', default: true, description: 'Switches the override of the plugin on screen (or last right-clicked).' }],
  }],
};
