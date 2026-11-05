import { useState, useSyncExternalStore } from 'react';
import { CONTROL_TOKEN_SLOTS, withTokenOverride, withoutTokenOverride, effectiveTokenOverrides } from '../../core/engines/control-tokens.mjs';
import { NAV_ACCENT_PREFIX, NAV_COLOR_TOKENS, NAV_STYLE_FIELDS, navIdList, normalizeNavStyle, type NavStyleData } from '../../core/engines/navstyle';
import type { AssetType } from '../../core';
import { NAV_COLLAPSED_KEY, NAV_OPEN_KEY, NAV_WIDTH_KEY } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, Slider } from './Controls';
import { SelectField, Switch } from './Forms';
import { Icon } from './Icon';

/**
 * The navigation settings interface (nav-style@1): every field of the nav-style in force, a preset picker, a live
 * preview and reset. A change is a control@1 token override (`tokens.nav`, settings key `axf.tokens.nav`), so it rides
 * the axHub look like every other look change and the REST API, MCP server and CLI read and set the same values
 * (`axf token nav set animation.kind push`). Any app whose nav opts in (nav-menu `navStyle: true`) can show it: one
 * panel per group (`NavStyleGroup`), or all of it (`NavStyleSettings`).
 */

const KEY = CONTROL_TOKEN_SLOTS['tokens.nav'].key;
const TYPE = 'nav-style' as AssetType;
export const NAV_STYLE_GROUP_IDS = ['presets', 'colors', 'font', 'icons', 'layout', 'width', 'animation', 'behavior', 'items'] as const;
export type NavStyleGroupId = (typeof NAV_STYLE_GROUP_IDS)[number];
export const NAV_STYLE_GROUP_TITLES: Record<NavStyleGroupId, string> = { presets: 'Presets & preview', colors: 'Colours', font: 'Font', icons: 'Icons', layout: 'Density & spacing', width: 'Width', animation: 'Animation', behavior: 'Behaviour', items: 'Items' };
export const NAV_STYLE_GROUP_ICONS: Record<NavStyleGroupId, string> = { presets: 'eye', colors: 'palette', font: 'type', icons: 'star', layout: 'sliders', width: 'move', animation: 'play', behavior: 'zap', items: 'list' };

/** A top-level item the Items group can pin, hide, reorder and give an accent (the app's apps, sections, pages). */
export interface NavStyleItem { id: string; label: string; icon?: string }

const LABELS: Record<string, string> = {
  'colors.background': 'Background', 'colors.text': 'Text', 'colors.hover': 'Hover', 'colors.active': 'Active item', 'colors.activeText': 'Active text', 'colors.submenu': 'Sub-menu background', 'colors.accent': 'Accent',
  'font.family': 'Font', 'font.size': 'Size', 'font.weight': 'Weight', 'icons.show': 'Show icons', 'icons.size': 'Icon size',
  'layout.density': 'Density', 'layout.indent': 'Sub-menu indent',
  'width.size': 'Width (0 = the layout’s)', 'width.min': 'Narrowest', 'width.max': 'Widest', 'width.resizable': 'Drag the edge to resize', 'width.collapsible': 'Can collapse to icons',
  'animation.kind': 'Sub menus open with', 'animation.durationMs': 'Duration (0 = the theme’s)', 'animation.easing': 'Easing', 'animation.staggerMs': 'Stagger between items', 'animation.chevron': 'Chevron', 'animation.reduced': 'Reduced motion',
  'behavior.single': 'One sub menu open at a time', 'behavior.openOn': 'Open on (desktop)', 'behavior.autoCollapse': 'Close the others when the page changes', 'behavior.remember': 'Remember what is open', 'behavior.followActive': 'Open the page’s own sub menu', 'behavior.swipe': 'Swipe up on the phone strip to open',
};
const HINTS: Record<string, string> = {
  'animation.reduced': 'System follows the device’s reduced-motion setting; Always turns motion off.',
  'behavior.openOn': 'Hover opens a sub menu when the pointer rests on it; a phone always taps.',
  'width.size': 'Pixels; the layout asset decides when 0.',
};
const OPTION_LABELS: Record<string, string> = { theme: 'Theme', accentSoft: 'Accent (soft)', accentText: 'Accent text', surface2: 'Surface 2', surface3: 'Surface 3', bg: 'Page background' };
const optionLabel = (v: string) => OPTION_LABELS[v] ?? (/^\d+$/.test(v) ? v : v.charAt(0).toUpperCase() + v.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase());

/** The nav-style in force, re-read whenever settings or the active asset change. */
export function useNavStyle(): { data: NavStyleData; assetId: string | null; overrides: Record<string, unknown> } {
  const rt = useRuntime();
  useAxfState();
  useSyncExternalStore((f) => rt.settings.onChange(KEY, f), () => rt.settings.get(KEY), () => rt.settings.get(KEY));
  const a = rt.assetOrNull(TYPE);
  const overrides = effectiveTokenOverrides(rt.settings.get(KEY), a?.id);
  return { data: rt.navStyleData() ?? normalizeNavStyle(a?.data), assetId: a?.id ?? null, overrides };
}

/** Set one field (or drop the override when it matches the asset's own value). */
export function setNavStyleField(rt: ReturnType<typeof useRuntime>, path: string, value: string | number | boolean | null): void {
  const a = rt.assetOrNull(TYPE);
  const own = normalizeNavStyle(a?.data);
  const [g, k] = path.split('.');
  const base = path.startsWith(NAV_ACCENT_PREFIX) ? own.accents[path.slice(NAV_ACCENT_PREFIX.length)] ?? 'theme' : (own as unknown as Record<string, Record<string, unknown>>)[g!]?.[k!];
  const raw = rt.settings.get(KEY);
  const next = value === null || value === base ? withoutTokenOverride(raw, path) : withTokenOverride(raw, path, value);
  if (next && typeof next === 'object' && Object.keys(next).length) rt.settings.set(KEY, next as never); else rt.settings.clear(KEY);
}

function Field({ path }: { path: string }) {
  const rt = useRuntime();
  const { data, overrides } = useNavStyle();
  const f = NAV_STYLE_FIELDS[path]!;
  const [g, k] = path.split('.');
  const v = (data as unknown as Record<string, Record<string, unknown>>)[g!]![k!];
  const label = LABELS[path] ?? path;
  const changed = Object.hasOwn(overrides, path);
  const hint = [HINTS[path], changed ? 'Changed here (Reset puts the preset’s back).' : ''].filter(Boolean).join(' ') || undefined;
  if (f.kind === 'boolean') return <Switch label={label} hint={hint} checked={v === true} onChange={(on) => setNavStyleField(rt, path, on)} />;
  if (f.kind === 'number') return <Slider label={label} value={Number(v)} min={f.min} max={f.max} step={f.unit === 'ms' ? 10 : 1} unit={f.unit === 'space' ? '×' : f.unit === 'px' ? 'px' : f.unit === 'ms' ? 'ms' : ''} onChange={(n) => setNavStyleField(rt, path, n)} />;
  const options = f.kind === 'color' ? ['theme', ...NAV_COLOR_TOKENS] : [...(f.options ?? [])];
  return <SelectField label={label} hint={hint} value={String(v)} options={options.map((o) => ({ value: o, label: optionLabel(o) }))} onChange={(x) => setNavStyleField(rt, path, x)} />;
}

const fieldsOf = (group: string) => Object.keys(NAV_STYLE_FIELDS).filter((p) => p.startsWith(`${group}.`) && !p.startsWith('items.'));

/** A small nav drawn with the same classes and tokens: what the style looks like, with a button that replays the sub menu. */
export function NavStylePreview() {
  const { data } = useNavStyle();
  const [open, setOpen] = useState(true);
  const kids = ['Overview', 'Builds', 'Plugins', 'Settings'];
  return (
    <div className="fx-stack">
      <div className="fx-navs fx-navs--preview" data-orient="vertical" aria-label="Navigation preview">
        <nav className="fx-nav fx-nav--list" data-orient="vertical" aria-hidden="true" data-axf-not-nav="a live preview of the nav style, not the app's navigation">
          <div className="fx-nav__section">
            <div className="fx-nav__label">Apps</div>
            <div className="fx-nav__group" data-open={open ? 'true' : 'false'}>
              <button type="button" tabIndex={-1} className="fx-nav__item fx-nav__item--parent is-within" onClick={() => setOpen((o) => !o)}>
                {data.icons.show && <Icon name="terminal" size={17} />}<span className="fx-nav__text">Console</span>
                <span className="fx-nav__chev"><Icon name={data.animation.chevron === 'flip' ? 'chevron-down' : 'chevron-right'} size={14} /></span>
              </button>
              <div className="fx-nav__sub" data-open={open ? 'true' : 'false'}>
                <div className="fx-nav__sub-inner">
                  {kids.map((k, i) => <button key={k} type="button" tabIndex={-1} className={`fx-nav__item${i === 1 ? ' is-active' : ''}`} data-depth={1} style={{ ['--navs-i' as string]: i }}>{data.icons.show && <Icon name="box" size={17} />}<span className="fx-nav__text">{k}</span></button>)}
                </div>
              </div>
            </div>
            <button type="button" tabIndex={-1} className="fx-nav__item">{data.icons.show && <Icon name="shield" size={17} />}<span className="fx-nav__text">axHub</span></button>
          </div>
        </nav>
      </div>
      <div className="fx-form__actions"><Button icon="play" onClick={() => { setOpen(false); window.setTimeout(() => setOpen(true), Math.max(160, data.animation.durationMs + 60)); }}>Replay the animation</Button></div>
    </div>
  );
}

function Presets() {
  const rt = useRuntime();
  const { assetId, overrides } = useNavStyle();
  const presets = rt.registry.list(TYPE) as unknown as { id: string; name: string; description?: string }[];
  const cur = presets.find((p) => p.id === assetId);
  const n = Object.keys(overrides).length;
  return (
    <div className="fx-stack">
      <SelectField label="Preset" hint={cur?.description} value={assetId ?? ''} options={presets.map((p) => ({ value: p.id, label: p.name }))} onChange={(id) => rt.swap(TYPE, id)} />
      <NavStylePreview />
      <div className="fx-form__actions">
        <Button icon="undo" disabled={!n} onClick={() => rt.settings.clear(KEY)}>{n ? `Reset ${n} change${n === 1 ? '' : 's'}` : 'Nothing changed'}</Button>
        <Button icon="refresh" onClick={() => { rt.settings.clear(NAV_OPEN_KEY); rt.settings.clear(NAV_WIDTH_KEY); rt.settings.clear(NAV_COLLAPSED_KEY); }}>Reset open menus and width</Button>
      </div>
    </div>
  );
}

/** Pin, hide, reorder and colour the top-level items (ids saved as comma lists, so each stays one token). */
function Items({ items }: { items: readonly NavStyleItem[] }) {
  const rt = useRuntime();
  const { data } = useNavStyle();
  const order = navIdList(data.items.order);
  const hidden = navIdList(data.items.hidden);
  const pinned = navIdList(data.items.pinned);
  const sorted = [...items].sort((a, b) => { const r = (x: NavStyleItem) => { const k = order.indexOf(x.id); return k === -1 ? order.length + items.indexOf(x) : k; }; return r(a) - r(b); });
  const move = (id: string, dir: -1 | 1) => { const ids = sorted.map((x) => x.id); const i = ids.indexOf(id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; setNavStyleField(rt, 'items.order', ids.join(',')); };
  const flip = (field: 'items.hidden' | 'items.pinned', list: string[], id: string, on: boolean) => setNavStyleField(rt, field, (on ? [...list, id] : list.filter((x) => x !== id)).join(','));
  if (!items.length) return <p className="fx-muted">No items to arrange yet.</p>;
  return (
    <ul className="fx-navs-items">
      {sorted.map((it, i) => (
        <li key={it.id} className="fx-navs-items__row">
          <span className="fx-navs-items__name">{it.icon && <Icon name={it.icon} size={16} />}<strong>{it.label}</strong></span>
          <Button icon="chevron-left" title="Move up" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => move(it.id, -1)}>Up</Button>
          <Button icon="chevron-right" title="Move down" aria-label={`Move ${it.label} down`} disabled={i === sorted.length - 1} onClick={() => move(it.id, 1)}>Down</Button>
          <Switch label="Pinned" checked={pinned.includes(it.id)} onChange={(on) => flip('items.pinned', pinned, it.id, on)} />
          <Switch label="Shown" checked={!hidden.includes(it.id)} onChange={(on) => flip('items.hidden', hidden, it.id, !on)} />
          <SelectField label="Accent" value={data.accents[it.id] ?? 'theme'} options={['theme', ...NAV_COLOR_TOKENS].map((o) => ({ value: o, label: optionLabel(o) }))} onChange={(v) => setNavStyleField(rt, `${NAV_ACCENT_PREFIX}${it.id}`, v)} />
        </li>
      ))}
    </ul>
  );
}

/** One group of the navigation settings (a settings panel each). */
export function NavStyleGroup({ group, items = [] }: { group: NavStyleGroupId; items?: readonly NavStyleItem[] }) {
  const rt = useRuntime();
  if (!rt.navStyleData()) return <p className="fx-muted">This app’s navigation doesn’t use sub menus (its nav-menu asset has no navStyle: true), so these settings don’t apply here.</p>;
  if (group === 'presets') return <Presets />;
  if (group === 'items') return <Items items={items} />;
  return <div className="fx-stack">{fieldsOf(group).map((p) => <Field key={p} path={p} />)}</div>;
}

/** Every group in one place (a dialog, or an app without per-panel settings). */
export function NavStyleSettings({ items = [] }: { items?: readonly NavStyleItem[] }) {
  return (
    <div className="fx-stack">
      {NAV_STYLE_GROUP_IDS.map((g) => (
        <section key={g} className="fx-stack" aria-label={NAV_STYLE_GROUP_TITLES[g]}>
          <h3 className="fx-navs-settings__title">{NAV_STYLE_GROUP_TITLES[g]}</h3>
          <NavStyleGroup group={g} items={items} />
        </section>
      ))}
    </div>
  );
}
