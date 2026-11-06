/**
 * Chrome context menu + settings host (chrome-settings@1; Brett, Nov 4 2026, build tab-group-assets, addendum 1:
 * "navigation menus, toolbars, banners, are all asset types, and they all have a settings interface, which is an
 * asset, and we can get to their settings by right-clicking all of them.").
 *
 * One block of items on the context menu of every tab group, toolbar, banner, navigation menu and application menu
 * bar, the same for all four (five) kinds: **Settings…**, **Change <kind>…** (an asset picker) and **Move ▸**
 * (where the kind can go). The targets each kind reports and the fields each settings dialog edits are the
 * registry in core/engines/chrome-settings-rules.mjs; this file is the web host of it.
 *
 * The settings dialog renders through a `settings` asset (settings-ui@1) whose data.for names the chrome type: the
 * shared default `chrome-<type>` unless the app picked its own copy (`axf.chrome.settings.<type>`), resolved through
 * `extends` (inherit@1). Its tabs come from the asset (Look / Behaviour / Asset / Interface, relabelled, reordered or
 * hidden by it), its level toolbar from `levels`, its extra option groups from `groups`. What the person changes is
 * saved as an override for that one instance (`axf.chrome.<type>.<instance>`), never written into the asset.
 *
 * Actions (console-visible, so Amber can drive them by voice through console_action):
 *   chrome.settings:<type>:<instance>            open the settings dialog
 *   chrome.pick:<type>:<instance>                open the asset picker
 *   chrome.move:<type>:<instance>:<position>     move it (tab group: its own position; toolbar / nav: the layout)
 *   chrome.set:<type>:<instance>:<field>:<value> set one field for that instance (value: on/off, a word, a number)
 *   chrome.reset:<type>:<instance>               drop every override + the instance's own asset pick
 *   chrome.swap:<type>:<instance>:<asset|next>   use another asset (tab groups: for this row; the rest: the app's slot)
 *   chrome.interface:<type>:<settings id|default|custom|reset>   which settings interface the dialog uses
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CHROME_FIELDS, CHROME_ICONS, CHROME_INSTANCE_ASSET_KEY, CHROME_INSTANCE_KEY, CHROME_LABELS, CHROME_MANY, CHROME_MOVES, CHROME_SETTINGS_PATCH_KEY, CHROME_SETTINGS_PICK_KEY, CHROME_SETTINGS_TABS, CHROME_TYPES, FRAMEWORK_MODULE, POSITION_LABELS, SETTINGS_LEVEL_KEY, SETTINGS_LEVELS, SETTINGS_LEVEL_LABEL, chromeFieldValue, chromeLabel, chromeSettingsChoices, chromeSettingsCustomId, chromeSettingsDefaultId, chromeSettingsPick, chromeTypeOfTarget, isChromeInstanceId, isChromeType, normalizeInstanceOverride, normalizeSettingsUi, resolveSettingsChain, settingsLevelOf, settingsLevelRank, type AssetType, type AxfRuntime, type ChromeField, type ChromeType, type SettingsLevel, type SettingsUi, type SettingSpec, type SettingValue } from '../../core';
import { CONTROL_TOKEN_SLOTS, withTokenOverride, withoutTokenOverride } from '../../core/engines/control-tokens.mjs';
import { SCREEN_LAYOUT_CTX } from '../../core/engines/screen-layouts.mjs';
import type { MenuEntry } from '../../core/engines/windows';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, Segmented, Slider } from './Controls';
import { ChoiceGrid, Note, Section, SelectField, Switch, TextField } from './Forms';
import { Icon } from './Icon';
import type { DialogMap } from './Overlays';
import { TabGroup } from './TabGroup';
import { BANNER_SETTINGS_DIALOG } from './BannerSettings';

export const CHROME_SETTINGS_DIALOG = 'axf.chrome.settings';
export const CHROME_PICK_DIALOG = 'axf.chrome.pick';
/** The instance id of a kind the app shows once (toolbar, banner, nav, menu bar) when the element names none. */
export const CHROME_APP_INSTANCE = 'app';

const installed = new WeakSet<AxfRuntime>();

const instanceOf = (type: ChromeType, payload: string | undefined): string => (CHROME_MANY[type] || (payload && isChromeInstanceId(payload)) ? (payload && isChromeInstanceId(payload) ? payload : '') : CHROME_APP_INSTANCE);

/** The settings asset a type's dialog renders through, resolved (inherit@1) and normalized; null when the app ships none. */
export function chromeSettingsUi(rt: AxfRuntime, type: ChromeType): { id: string; ui: SettingsUi; custom: boolean } | null {
  const assets = rt.registry.list('settings');
  const id = chromeSettingsPick(rt.settings.get(CHROME_SETTINGS_PICK_KEY(type)), type, assets.map((a) => a.id));
  if (!id) return null;
  const patch = rt.settings.get(CHROME_SETTINGS_PATCH_KEY(type));
  const get = (x: string) => rt.registry.get('settings', x) ?? null;
  const data = resolveSettingsChain(get, id);
  if (!data) return null;
  const custom = id !== chromeSettingsDefaultId(type);
  const merged = custom && patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...data, ...(patch as Record<string, unknown>) } : data;
  return { id, ui: normalizeSettingsUi(merged), custom };
}

/** The data an instance renders with today (the active asset, or the row's own pick, plus its overrides). */
function baseDataOf(rt: AxfRuntime, type: ChromeType, instance: string): Record<string, unknown> | null {
  if (type === 'tab-group') {
    const pick = rt.settings.get(CHROME_INSTANCE_ASSET_KEY(type, instance));
    const own = typeof pick === 'string' && pick ? rt.registry.get('tab-group', pick) : null;
    return (own?.data as unknown as Record<string, unknown>) ?? (rt.assetOrNull('tab-group')?.data as unknown as Record<string, unknown>) ?? null;
  }
  return (rt.assetOrNull(type as AssetType)?.data as Record<string, unknown>) ?? null;
}

/** Set one field for an instance (dropping the override when it equals the asset's own value). */
export function setChromeField(rt: AxfRuntime, type: ChromeType, instance: string, key: string, value: string | number | boolean | null): void {
  const k = CHROME_INSTANCE_KEY(type, instance);
  const cur = normalizeInstanceOverride(type, rt.settings.get(k));
  const base = baseDataOf(rt, type, instance);
  const next: Record<string, string | number | boolean> = { ...cur };
  if (value === null || (base && base[key] === value)) delete next[key]; else next[key] = value;
  const clean = normalizeInstanceOverride(type, next);
  if (Object.keys(clean).length) rt.settings.set(k, clean as never); else rt.settings.clear(k);
}

/** Parse a `chrome.set` value: on/off/true/false → boolean, a number → number, else the word. */
function parseValue(type: ChromeType, key: string, raw: string): string | number | boolean | null {
  const f = CHROME_FIELDS[type].find((x) => x.key === key);
  if (!f) return null;
  if (f.kind === 'toggle') return /^(on|true|yes|1)$/i.test(raw) ? true : /^(off|false|no|0)$/i.test(raw) ? false : null;
  if (f.kind === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : null; }
  return f.options?.includes(raw) ? raw : null;
}

/** Move a chrome kind: tab groups set their own position; toolbar / nav set the layout token (tokens.layout override). */
export function moveChrome(rt: AxfRuntime, type: ChromeType, instance: string, position: string): boolean {
  const m = CHROME_MOVES[type];
  if (!m.positions.includes(position as never)) return false;
  if (m.via === 'instance') { setChromeField(rt, type, instance, m.field, position); return true; }
  if (m.via === 'layout') {
    const key = CONTROL_TOKEN_SLOTS['tokens.layout'].key;
    const own = (rt.asset('layout').data as unknown as Record<string, unknown>)[m.field];
    const raw = rt.settings.get(key);
    const next = own === position ? withoutTokenOverride(raw, m.field) : withTokenOverride(raw, m.field, position);
    if (next && typeof next === 'object' && Object.keys(next).length) rt.settings.set(key, next as never); else rt.settings.clear(key);
    return true;
  }
  return false;
}

/** Use another asset: a tab group picks for itself, every other kind swaps the app's slot. `next` cycles. */
export function swapChrome(rt: AxfRuntime, type: ChromeType, instance: string, asset: string): boolean {
  const list = rt.registry.list(type as AssetType);
  if (!list.length) return false;
  let id = asset;
  if (asset === 'next' || asset === 'prev') {
    const cur = type === 'tab-group' ? (rt.settings.get(CHROME_INSTANCE_ASSET_KEY(type, instance)) as string) || rt.getState().active['tab-group'] || '' : rt.getState().active[type as AssetType] ?? '';
    const i = list.findIndex((a) => a.id === cur);
    id = list[(i + (asset === 'next' ? 1 : list.length - 1)) % list.length]!.id;
  }
  if (type === 'tab-group') {
    if (id === 'default' || id === '') { rt.settings.clear(CHROME_INSTANCE_ASSET_KEY(type, instance)); return true; }
    if (!list.some((a) => a.id === id)) return false;
    rt.settings.set(CHROME_INSTANCE_ASSET_KEY(type, instance), id);
    return true;
  }
  return rt.swap(type as AssetType, id);
}

/** The context-menu block every chrome kind shares. */
export function chromeMenu(rt: AxfRuntime, type: ChromeType, instance: string): MenuEntry[] {
  const label = chromeLabel(type);
  const m = CHROME_MOVES[type];
  const items: MenuEntry[] = [
    { id: `chrome-settings-${type}`, label: `${label} settings…`, icon: 'settings', action: `chrome.settings:${type}:${instance}` },
    { id: `chrome-pick-${type}`, label: type === 'tab-group' ? 'Change tab style…' : `Change ${label.toLowerCase()}…`, icon: CHROME_ICONS[type], action: `chrome.pick:${type}:${instance}` },
  ];
  if (m.positions.length) {
    const cur = m.via === 'instance' ? chromeFieldValue(type, baseDataOf(rt, type, instance), rt.settings.get(CHROME_INSTANCE_KEY(type, instance)), m.field) : (rt.asset('layout').data as unknown as Record<string, unknown>)[m.field];
    items.push({ id: `chrome-move-${type}`, label: 'Move', icon: 'move', items: m.positions.map((p) => ({ id: `chrome-move-${type}-${p}`, label: `${POSITION_LABELS[p]}${cur === p ? ' ✓' : ''}`, action: `chrome.move:${type}:${instance}:${p}` })) });
  }
  return items;
}

/** Install the actions, the shared context block and nothing else; once per runtime (AppShell calls it). */
export function installChrome(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  rt.actions.withModule(FRAMEWORK_MODULE, () => {
    const t = (v: unknown): ChromeType | null => (isChromeType(v) ? v : null);
    const inst = (type: ChromeType, v: unknown, ctx?: { payload?: unknown }) => instanceOf(type, (typeof v === 'string' && v) || (typeof ctx?.payload === 'string' ? ctx.payload : undefined)) || CHROME_APP_INSTANCE;
    rt.actions.register('chrome.settings', ([type, instance], ctx) => { const ty = t(type); if (ty) rt.openDialog(CHROME_SETTINGS_DIALOG, { type: ty, instance: inst(ty, instance, ctx) }); }, { label: 'Chrome settings (tab group, toolbar, banner, nav, menu bar)', params: true });
    rt.actions.register('chrome.pick', ([type, instance], ctx) => { const ty = t(type); if (ty) rt.openDialog(CHROME_PICK_DIALOG, { type: ty, instance: inst(ty, instance, ctx) }); }, { label: 'Change a chrome asset (picker)', params: true });
    rt.actions.register('chrome.move', ([type, instance, position = ''], ctx) => { const ty = t(type); if (ty && !moveChrome(rt, ty, inst(ty, instance, ctx), position)) rt.toast(`${chromeLabel(ty ?? type ?? '')} can't move to "${position}".`, 'warning', 'Move'); }, { label: 'Move a chrome piece (top / bottom / left / right)', params: true, requires: 'assets.swap' });
    rt.actions.register('chrome.set', ([type, instance, key = '', ...rest], ctx) => {
      const ty = t(type); if (!ty) return;
      const v = parseValue(ty, key, rest.join(':'));
      if (v === null) { rt.toast(`${chromeLabel(ty)} has no setting "${key}" with that value.`, 'warning', 'Chrome settings'); return; }
      setChromeField(rt, ty, inst(ty, instance, ctx), key, v);
    }, { label: 'Set one chrome setting (chrome.set:<type>:<instance>:<field>:<value>)', params: true, requires: 'assets.swap' });
    rt.actions.register('chrome.reset', ([type, instance], ctx) => { const ty = t(type); if (!ty) return; const i = inst(ty, instance, ctx); rt.settings.clear(CHROME_INSTANCE_KEY(ty, i)); rt.settings.clear(CHROME_INSTANCE_ASSET_KEY(ty, i)); }, { label: 'Reset a chrome piece to its asset', params: true, requires: 'assets.swap' });
    rt.actions.register('chrome.swap', ([type, instance, asset = 'next'], ctx) => { const ty = t(type); if (ty && !swapChrome(rt, ty, inst(ty, instance, ctx), asset)) rt.toast(`No ${chromeLabel(ty).toLowerCase()} asset "${asset}".`, 'warning', 'Change'); }, { label: 'Use another chrome asset (chrome.swap:<type>:<instance>:<asset|next>)', params: true, requires: 'assets.swap' });
    rt.actions.register('chrome.interface', ([type, which = 'default']) => {
      const ty = t(type); if (!ty) return;
      const key = CHROME_SETTINGS_PICK_KEY(ty);
      if (which === 'reset') { rt.settings.clear(CHROME_SETTINGS_PATCH_KEY(ty)); return; }
      const id = which === 'default' ? chromeSettingsDefaultId(ty) : which === 'custom' ? chromeSettingsCustomId(ty, rt.manifest.app.id) : which;
      if (!rt.registry.get('settings', id)) { rt.toast(`No settings interface "${id}".`, 'warning', 'Chrome settings'); return; }
      if (id === chromeSettingsDefaultId(ty)) rt.settings.clear(key); else rt.settings.set(key, id);
    }, { label: 'Pick which settings interface a chrome kind uses (default | custom | <id> | reset)', params: true });
  });
  // The shared block, after the kind's own items (window tab groups: Undock / Split…; banners: Hide…).
  rt.contextExtras.set('*:chrome', (target, payload) => {
    const type = chromeTypeOfTarget(target);
    if (!type) return [];
    // screen-layouts@1: the layout toolbar's Change and Move would act on the app's toolbar, so it keeps Settings… here;
    // its own items (own copy / back to shared / hide) are the way to change it
    if (target === SCREEN_LAYOUT_CTX.toolbar) return chromeMenu(rt, type, rt.layoutToolbarInstance(payload ?? '')).filter((e) => e.id === `chrome-settings-${type}`);
    const instance = instanceOf(type, payload);
    return instance ? chromeMenu(rt, type, instance) : [];
  });
}

/* ================================================================== dialogs */

function useSettingsTick(rt: AxfRuntime, keys: string[]): number {
  const [tick, setTick] = useState(0);
  useEffect(() => { const offs = keys.map((k) => rt.settings.onChange(k, () => setTick((n) => n + 1))); return () => offs.forEach((f) => f()); }, [rt, keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return tick;
}

function FieldControl({ type, instance, field, descriptions }: { type: ChromeType; instance: string; field: ChromeField; descriptions: boolean }) {
  const rt = useRuntime();
  const base = baseDataOf(rt, type, instance);
  const override = rt.settings.get(CHROME_INSTANCE_KEY(type, instance));
  const value = chromeFieldValue(type, base, override, field.key);
  const overridden = field.key in normalizeInstanceOverride(type, override);
  const hint = descriptions && overridden ? 'Set for this one (the asset says otherwise)' : undefined;
  const set = (v: string | number | boolean | null) => setChromeField(rt, type, instance, field.key, v);
  if (field.kind === 'toggle') return <Switch label={field.label} hint={hint} checked={value === true} onChange={(on) => set(on)} />;
  if (field.kind === 'number') return <Slider label={field.label} value={typeof value === 'number' ? value : field.min ?? 0} min={field.min} max={field.max} step={1} onChange={(n) => set(n)} />;
  const options = (field.options ?? []).map((o) => ({ value: o, label: field.labels?.[o] ?? o.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) }));
  if (options.length <= 4) return <div className="fx-stack fx-stack--xs"><span className="fx-field__label">{field.label}</span><Segmented size="sm" label={field.label} value={typeof value === 'string' ? value : ''} options={options} onChange={(v) => set(v)} />{hint && <span className="fx-muted fx-field__hint">{hint}</span>}</div>;
  return <SelectField label={field.label} hint={hint} value={typeof value === 'string' ? value : ''} options={options} onChange={(v) => set(v)} />;
}

/** The asset picker for a kind: tab groups pick for themselves (plus "the app's default"); the rest swap the app's slot. */
export function ChromeAssetPicker({ type, instance }: { type: ChromeType; instance: string }) {
  const rt = useRuntime();
  useAxfState();
  useSettingsTick(rt, [CHROME_INSTANCE_ASSET_KEY(type, instance)]);
  const list = rt.registry.list(type as AssetType);
  const own = type === 'tab-group' ? (rt.settings.get(CHROME_INSTANCE_ASSET_KEY(type, instance)) as string) || '' : '';
  const active = type === 'tab-group' ? own || 'default' : rt.getState().active[type as AssetType] ?? '';
  const choices = [
    ...(type === 'tab-group' ? [{ id: 'default', title: "The app's tab style", text: `Follows the app's active tab-group asset (${rt.getState().active['tab-group'] ?? 'none'}).`, icon: 'layers' }] : []),
    ...list.map((a) => ({ id: a.id, title: a.name, text: a.description, icon: CHROME_ICONS[type], tag: a.id === rt.getState().active[type as AssetType] && type !== 'tab-group' ? 'active' : undefined })),
  ];
  return (
    <div className="fx-stack">
      <ChoiceGrid label={`${chromeLabel(type)} asset`} choices={choices} selected={[active]} onToggle={(id) => swapChrome(rt, type, instance, id)} />
      {type !== 'tab-group' && <Note tone="info">Every {chromeLabel(type).toLowerCase()} in this app uses the picked asset (it is the app's {type} slot); the look is shared through axHub like every other look change.</Note>}
    </div>
  );
}

/** Interface tab: which settings interface this kind's dialog uses (the shared default first), + reset the custom copy. */
function InterfacePicker({ type }: { type: ChromeType }) {
  const rt = useRuntime();
  useAxfState();
  useSettingsTick(rt, [CHROME_SETTINGS_PICK_KEY(type), CHROME_SETTINGS_PATCH_KEY(type)]);
  const assets = rt.registry.list('settings');
  const choices = chromeSettingsChoices(type, assets as never);
  const picked = chromeSettingsPick(rt.settings.get(CHROME_SETTINGS_PICK_KEY(type)), type, assets.map((a) => a.id));
  const customId = chromeSettingsCustomId(type, rt.manifest.app.id);
  const patch = rt.settings.get(CHROME_SETTINGS_PATCH_KEY(type));
  const patched = !!patch && typeof patch === 'object' && Object.keys(patch as object).length > 0;
  const editing = picked && picked !== chromeSettingsDefaultId(type) ? picked : null;
  const current = editing ? resolveSettingsChain((x) => rt.registry.get('settings', x) ?? null, editing) : null;
  const ui = current ? normalizeSettingsUi({ ...current, ...((patched ? patch : {}) as object) }) : null;
  const setPatch = (k: string, v: unknown) => { const p = { ...((patched ? patch : {}) as Record<string, unknown>), [k]: v }; rt.settings.set(CHROME_SETTINGS_PATCH_KEY(type), p as never); };
  return (
    <div className="fx-stack">
      <ChoiceGrid label="Settings interface" choices={choices.map((c) => ({ id: c.id, title: c.name, text: c.custom ? `This app's own copy${c.extends ? ` (follows ${c.extends} until edited)` : ''}` : 'The shared default, used unless an app picks its copy.', icon: 'settings', tag: c.id === customId ? 'this app' : c.custom ? 'custom' : 'default' }))} selected={picked ? [picked] : []} onToggle={(id) => rt.dispatch(`chrome.interface:${type}:${id}`)} />
      {editing && ui && (
        <Section title="Edit this app's copy" aside={patched ? <Button size="sm" icon="undo" onClick={() => rt.dispatch(`chrome.interface:${type}:reset`)}>Reset custom to default</Button> : undefined}>
          <div className="fx-stack fx-stack--xs"><span className="fx-field__label">Layout</span><Segmented size="sm" label="Layout" value={ui.layout} options={[{ value: 'tabs-top', label: 'Tabs on top' }, { value: 'tabs-side', label: 'Tabs at the side' }, { value: 'list', label: 'List' }]} onChange={(v) => setPatch('layout', v)} /></div>
          <div className="fx-stack fx-stack--xs"><span className="fx-field__label">Header</span><Segmented size="sm" label="Header" value={ui.header} options={[{ value: 'full', label: 'Full' }, { value: 'compact', label: 'Compact' }, { value: 'none', label: 'None' }]} onChange={(v) => setPatch('header', v)} /></div>
          <Switch label="Search field" checked={ui.search} onChange={(on) => setPatch('search', on)} />
          <Switch label="Descriptions" checked={ui.descriptions} onChange={(on) => setPatch('descriptions', on)} />
          <Switch label="Level toolbar" checked={ui.levels} onChange={(on) => setPatch('levels', on)} />
          <TextField label="Hidden ids (comma-separated: a tab, group or field key)" value={ui.hide.join(', ')} onChange={(v) => setPatch('hide', v.split(',').map((s) => s.trim()).filter(Boolean))} />
        </Section>
      )}
      {!editing && <Note tone="info">The shared default is in use. Pick this app's copy to edit it; the default stays what every app starts from.</Note>}
    </div>
  );
}

/** A data-only option group a settings asset brings (settings-ui@1 `groups`), stored under the group's own keys. */
function ExtraGroup({ group }: { group: { id: string; label: string; icon?: string; description?: string; settings: SettingSpec[] } }) {
  const rt = useRuntime();
  useSettingsTick(rt, group.settings.map((s) => s.key));
  const row = (s: SettingSpec): ReactNode => {
    const v = rt.settings.get(s.key);
    const set = (x: SettingValue) => rt.settings.set(s.key, x);
    switch (s.kind) {
      case 'toggle': return <Switch key={s.key} label={s.label} hint={s.description} checked={v === true} onChange={(on) => set(on)} />;
      case 'slider': case 'number': return <Slider key={s.key} label={s.label} value={typeof v === 'number' ? v : Number(s.default ?? s.min ?? 0)} min={s.min} max={s.max} step={s.step} onChange={(n) => set(n)} />;
      case 'choice': return <SelectField key={s.key} label={s.label} hint={s.description} value={typeof v === 'string' ? v : String(s.default ?? '')} options={s.options ?? []} onChange={(x) => set(x)} />;
      case 'text': case 'color': return <TextField key={s.key} label={s.label} hint={s.description} value={typeof v === 'string' ? v : ''} onChange={(x) => set(x)} />;
      case 'section': return <h4 key={s.key} className="fx-eyebrow">{s.label}</h4>;
      default: return null;
    }
  };
  return <Section title={group.label}>{group.description && <p className="fx-muted">{group.description}</p>}{group.settings.map(row)}</Section>;
}

/** The settings dialog of one chrome instance, laid out by the settings asset in force for its type. */
export function ChromeSettingsPanel({ type, instance }: { type: ChromeType; instance: string }) {
  const rt = useRuntime();
  useAxfState();
  useSettingsTick(rt, [CHROME_INSTANCE_KEY(type, instance), CHROME_INSTANCE_ASSET_KEY(type, instance), CHROME_SETTINGS_PICK_KEY(type), CHROME_SETTINGS_PATCH_KEY(type), SETTINGS_LEVEL_KEY]);
  const res = chromeSettingsUi(rt, type);
  const ui = res?.ui ?? normalizeSettingsUi(null);
  const [query, setQuery] = useState('');
  const level: SettingsLevel = settingsLevelOf(rt.settings.get(SETTINGS_LEVEL_KEY)) ?? ui.defaultLevel;
  // the four chrome tabs, relabelled / reordered / hidden by the asset, minus `hide`
  const tabs = useMemo(() => {
    const base = CHROME_SETTINGS_TABS.map((t) => ({ ...t }));
    const extra = ui.tabs.filter((t) => !base.some((b) => b.id === t.id)).map((t, i) => ({ id: t.id, label: t.label ?? t.id, icon: t.icon ?? 'settings', order: t.order ?? 100 + i }));
    const all = [...base, ...extra].map((t) => { const o = ui.tabs.find((x) => x.id === t.id); return o ? { ...t, label: o.label ?? t.label, icon: o.icon ?? t.icon, order: o.order ?? t.order, hidden: o.hidden } : t; });
    return all.filter((t) => !('hidden' in t && t.hidden) && !ui.hide.includes(t.id)).sort((a, b) => a.order - b.order);
  }, [ui]);
  const [tab, setTab] = useState(tabs[0]?.id ?? 'look');
  const shownTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? 'look';
  const levelOk = (id: string, own: string) => !ui.levels || settingsLevelRank(level) >= settingsLevelRank(settingsLevelOf(ui.levelOf[id]) ?? (own as SettingsLevel));
  const q = query.trim().toLowerCase();
  const fields = (group: 'look' | 'behaviour') => CHROME_FIELDS[type].filter((f) => f.group === group && !ui.hide.includes(f.key) && levelOk(f.key, f.level) && (!q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)));
  const overrides = normalizeInstanceOverride(type, rt.settings.get(CHROME_INSTANCE_KEY(type, instance)));
  const title = `${chromeLabel(type)}${instance !== CHROME_APP_INSTANCE ? ` · ${instance}` : ''}`;
  const tabsForRow = tabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }));
  const body = (id: string): ReactNode => {
    if (id === 'look' || id === 'behaviour') {
      const fs = fields(id);
      return (
        <div className="fx-stack">
          {fs.length ? fs.map((f) => <FieldControl key={f.key} type={type} instance={instance} field={f} descriptions={ui.descriptions} />) : <p className="fx-muted">Nothing at this level{q ? ' matches' : ''}.</p>}
          {id === 'look' && type === 'banner' && <Button icon="settings" onClick={() => rt.openDialog(BANNER_SETTINGS_DIALOG, instance !== CHROME_APP_INSTANCE ? { id: instance } : {})}>Banner settings (look, behaviour, Apply to all)…</Button>}
          {id === 'behaviour' && type === 'toolbar' && <Note tone="info">Tap-to-confirm on touch and this toolbar's own override live in Settings → Plugins → Toolbars.</Note>}
          {id === 'behaviour' && type === 'nav-menu' && <Note tone="info">Sub menus, animation and colours of a nav that opts in are the Navigation style settings (nav-style@1).</Note>}
          {ui.groups.filter((g) => g.tab === id && levelOk(g.id, g.level ?? ui.defaultLevel)).map((g) => <ExtraGroup key={g.id} group={g} />)}
        </div>
      );
    }
    if (id === 'asset') return <ChromeAssetPicker type={type} instance={instance} />;
    if (id === 'interface') return <InterfacePicker type={type} />;
    return <div className="fx-stack">{ui.groups.filter((g) => g.tab === id).map((g) => <ExtraGroup key={g.id} group={g} />)}</div>;
  };
  const header = ui.header === 'none' ? null : (
    <div className="fx-row fx-row--between">
      <div><strong>{title}</strong>{ui.header === 'full' && <div className="fx-muted">{Object.keys(overrides).length ? `${Object.keys(overrides).length} setting(s) set for this one` : 'Follows its asset'}{res ? ` · interface ${res.id}` : ''}</div>}</div>
      <div className="fx-row">
        {Object.keys(overrides).length > 0 && <Button size="sm" icon="undo" onClick={() => rt.dispatch(`chrome.reset:${type}:${instance}`)}>Reset</Button>}
        {ui.levels && <Segmented<SettingsLevel> size="sm" label="Level" value={level} options={SETTINGS_LEVELS.map((l) => ({ value: l, label: SETTINGS_LEVEL_LABEL[l] }))} onChange={(l) => rt.settings.set(SETTINGS_LEVEL_KEY, l)} />}
      </div>
    </div>
  );
  const search = ui.search ? <TextField label="Find a setting" value={query} onChange={setQuery} placeholder="style, position, badges…" /> : null;
  if (!res) return <div className="fx-stack">{header}<Note tone="warning">This app ships no settings interface for {chromeLabel(type).toLowerCase()}s (chrome-settings@1: settings/{chromeSettingsDefaultId(type)}); showing the built-in layout.</Note>{search}<TabGroup id={`chrome.settings.${type}`} label={`${chromeLabel(type)} settings sections`} value={shownTab} onChange={setTab} tabs={tabsForRow}>{body(shownTab)}</TabGroup></div>;
  if (ui.layout === 'list') return <div className="fx-stack fx-stack--lg">{header}{search}{tabs.map((t) => <Section key={t.id} title={t.label}>{body(t.id)}</Section>)}</div>;
  return (
    <div className="fx-stack">
      {header}{search}
      <TabGroup id={`chrome.settings.${type}`} label={`${chromeLabel(type)} settings sections`} value={shownTab} onChange={setTab} tabs={tabsForRow} asset={ui.layout === 'tabs-side' ? 'side-dock' : undefined}>
        <div className="fx-stack" style={{ paddingBlockStart: 'var(--fx-dens-gap-md)' }}>{body(shownTab)}</div>
      </TabGroup>
    </div>
  );
}

const typeOf = (p: Record<string, unknown>): ChromeType => (isChromeType(p.type) ? p.type : 'tab-group');
const instOf = (p: Record<string, unknown>): string => (typeof p.instance === 'string' && isChromeInstanceId(p.instance) ? p.instance : CHROME_APP_INSTANCE);

/** The dialogs AppShell registers: chrome settings + the asset picker. */
export const chromeDialogs: DialogMap = {
  [CHROME_SETTINGS_DIALOG]: { title: 'Chrome settings', icon: 'settings', searchable: false, render: (p) => <ChromeSettingsPanel type={typeOf(p)} instance={instOf(p)} /> },
  [CHROME_PICK_DIALOG]: { title: 'Change asset', icon: 'layers', searchable: false, render: (p) => <div className="fx-stack"><p className="fx-muted"><Icon name={CHROME_ICONS[typeOf(p)]} size={14} /> {chromeLabel(typeOf(p))}{instOf(p) !== CHROME_APP_INSTANCE ? ` · ${instOf(p)}` : ''}</p><ChromeAssetPicker type={typeOf(p)} instance={instOf(p)} /></div> },
};

/** Every chrome type's settings reachable by voice: the catalog lists these ids (console.actions). */
export const CHROME_ACTION_IDS = ['chrome.settings', 'chrome.pick', 'chrome.move', 'chrome.set', 'chrome.reset', 'chrome.swap', 'chrome.interface'] as const;
export { CHROME_TYPES as CHROME_SETTINGS_TYPES, CHROME_LABELS as CHROME_SETTINGS_LABELS };
