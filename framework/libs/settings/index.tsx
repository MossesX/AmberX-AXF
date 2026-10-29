/**
 * Settings library (web port of ai.amberx.axf.settings, Android: framework/android/lib-settings).
 *
 * A schema-driven Settings page with tabs. The standard tabs are Appearance, Account & security,
 * Connections, Plugins and About; any library or plugin can add settings groups (generated controls)
 * or panels (custom UI) to any tab through its AxfWebLibrary (`settings`, `settingsPanels`,
 * `settingsTabs`), or a new tab of its own. Values persist per app (secrets never do).
 *
 * Open it with the standard `app.settings` action, or `settings.open:<tab>` for a tab.
 *
 * The page itself follows the active `settings` asset (settings-ui@1, core/engines/settingsui.ts): layout, header,
 * search, descriptions, tab order/labels, what is left out and extra option groups, so apps loading the same
 * settings asset share one settings interface with the same options. No settings asset = the page as before.
 */
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { APPEARANCE_LOCK_KEY, ASSET_TYPES, assetTypeSpecs, attachable, hideable, SPACING_DEFAULT, SPACING_KEY, SPACING_LABEL, SPACINGS, rollNever, rollSlotDefault, ROLL_ASSET_KEY, ROLL_SLOT_KEY, PLACEMENT_LABELS, arrangeSettingsTabs, filterSettingsGroup, normalizeSettingsUi, settingMatches, settingsShown, settingsUiGroups, SETTINGS_LEVEL_KEY, SETTINGS_LEVEL_HINT, SETTINGS_LEVEL_LABEL, SETTINGS_LEVELS, settingsLevel, shownAtLevel, lookCss, lookChanged, normalizeLook, type SettingsLevel, type LookValues, CUSTOM_GROUPS, customEditable, customizable, customTokensFor, effectiveCustom, iconSet, iconSetDecls, ICON_SETS, setApplyAll, setCustomToken, type CustomTokenSpec, type CustomValue, type CustomValues, type HostAttachment, type SettingsUi, type AssetType, type AxfRuntime, type SettingSpec, type SettingValue, type SettingsGroup } from '../../core';
import { AssetToolbar, askBannerTab, BANNERS_VIEW, BannerSettingsPanel, bannerSettingsTabs, Button, Checkbox, Chip, Container, Icon, LookEditor, ModelBadge, Segmented, setBannerOwnSettingsRenderer, Slider, Switch, TextField, useAsset, useAxfState, useKnownBanners, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import { runtimeInventory } from '../../react/pluginRecords';

export const SETTINGS_LIBRARY_ID = 'ai.amberx.axf.settings';
const VIEW = 'settings';
const TAB_KEY = 'axf.settings.lastTab';

/** Standard tabs, in order. Ids are stable: libraries target them by id. */
export const SETTINGS_TABS = {
  appearance: { id: 'appearance', label: 'Appearance', icon: 'palette', order: 10, description: 'Every slot is a hot-swappable asset. Changes apply instantly and persist.' },
  account: { id: 'account', label: 'Account & security', icon: 'shield', order: 20, description: 'Who you are acting as, and how this app is protected.' },
  connections: { id: 'connections', label: 'Connections', icon: 'cloud', order: 30, description: 'Servers and services this app talks to.' },
  plugins: { id: 'plugins', label: 'Plugins', icon: 'package', order: 40, description: 'Libraries and plugins installed in this app.' },
  // Every banner plugin's settings in one place (Brett, Oct 22 2026); shown only while the app has banners.
  banners: { id: 'banners', label: 'Banners', icon: 'bell', parent: 'plugins', order: 1, description: 'Every banner: its look, its behaviour and its plugin’s own settings, one tab each. Right-click (or long-press) any banner for the same.' },
  about: { id: 'about', label: 'About', icon: 'info', order: 90, description: 'Versions and help.' },
} as const;

/* ---------------- hooks ---------------- */

function useSettingsRevision(rt: AxfRuntime): number {
  return useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision);
}

/** The active settings interface (the `settings` asset), normalized; defaults when the app has none. */
function settingsUi(rt: AxfRuntime): SettingsUi {
  return normalizeSettingsUi(rt.assetOrNull('settings')?.data);
}
/** The level the settings page shows (Simple / Basic / Developer / Administrator), when the interface has levels. */
function useSettingsLevel(ui: SettingsUi): SettingsLevel {
  const rt = useRuntime();
  const sub = useMemo(() => (fn: () => void) => rt.settings.onChange(SETTINGS_LEVEL_KEY, fn), [rt]);
  const raw = useSyncExternalStore(sub, () => rt.settings.get(SETTINGS_LEVEL_KEY), () => rt.settings.get(SETTINGS_LEVEL_KEY));
  return settingsLevel(ui, raw);
}

function useSettingsUi(): SettingsUi {
  const rt = useRuntime();
  useAxfState();
  const a = rt.assetOrNull('settings');
  return useMemo(() => normalizeSettingsUi(a?.data), [a]);
}

/* ---------------- controls ---------------- */

/** Every row carries a search anchor, so the toolbar search can scroll to it and flash it. */
function SettingRow({ spec }: { spec: SettingSpec }) {
  const rt = useRuntime();
  useAxfState();
  useSettingsRevision(rt);
  // Inside a host app (embed@1), settings about chrome the host owns aren't shown at all (never greyed out).
  if ((spec.slot && rt.slotOwnedByHost(spec.slot as AssetType)) || (spec.kind === 'asset_slot' && spec.target && rt.slotOwnedByHost(spec.target as AssetType))) return null;
  // A setting about a slot the user hid is greyed out (and its control disabled) until the slot is shown again.
  const off = !!spec.slot && rt.slotHiddenOwn(spec.slot as AssetType);
  // the look is locked: every look setting greys out (its control is disabled below through `requires`)
  const grey = off || (!!spec.requires && rt.lockedByAppearance(spec.requires));
  return (
    <div data-axf-anchor={`setting:${spec.key}`} className={grey ? 'axf-settings__off' : undefined} aria-disabled={grey || undefined}>
      <SettingControl spec={spec} off={off} />
      {off && <p className="fx-muted axf-settings__hint axf-settings__offnote">{assetTypeSpecs[spec.slot as AssetType]?.label ?? spec.slot} is hidden (Assets above).</p>}
    </div>
  );
}

function SettingControl({ spec, off = false }: { spec: SettingSpec; off?: boolean }) {
  const rt = useRuntime();
  useAxfState();
  useSettingsRevision(rt);
  // `denied` = the role can't change it (lock icon); `off` = its slot is hidden (greyed, no lock).
  const denied = spec.requires ? rt.gate(spec.requires) !== 'allow' : false;
  const locked = off || denied;
  const value = rt.settings.get(spec.key);
  const set = (v: SettingValue) => rt.settings.set(spec.key, v);

  let control: ReactNode;
  switch (spec.kind) {
    case 'section':
      return <h3 className="axf-settings__section">{spec.label}</h3>;
    case 'toggle':
      control = <Switch hideLabel className="axf-settings__switch" label={spec.label} text={value === true ? 'On' : 'Off'} checked={value === true} disabled={locked} onChange={(on) => set(on)} />;
      break;
    case 'slider':
      return (
        <div className="axf-settings__row axf-settings__row--wide">
          <Slider label={spec.label} value={typeof value === 'number' ? value : Number(spec.default ?? spec.min ?? 0)} min={spec.min} max={spec.max} step={spec.step} onChange={(v) => !locked && set(v)} />
          {spec.description && <p className="fx-muted axf-settings__hint">{spec.description}</p>}
        </div>
      );
    case 'number':
      control = <input className="axf-settings__field" type="number" value={typeof value === 'number' ? value : ''} min={spec.min} max={spec.max} step={spec.step} disabled={locked} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} />;
      break;
    case 'text':
    case 'secret':
      control = <input className="axf-settings__field" type={spec.kind === 'secret' ? 'password' : 'text'} autoComplete="off" value={typeof value === 'string' ? value : ''} disabled={locked} onChange={(e) => set(e.target.value)} />;
      break;
    case 'color':
      control = <input type="color" value={typeof value === 'string' ? value : '#000000' /* theme-ok: data value, not styling */} disabled={locked} onChange={(e) => set(e.target.value)} />;
      break;
    case 'choice':
      // Up to three options read better as a three-way switch (radio group) than a drop-down.
      if ((spec.options ?? []).length > 1 && (spec.options ?? []).length <= 3) {
        const cur = typeof value === 'string' ? value : String(spec.default ?? '');
        control = (
          <div className="fx-seg" role="radiogroup" aria-label={spec.label}>
            {(spec.options ?? []).map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={cur === o.value} disabled={locked}
                className={`fx-seg__opt${cur === o.value ? ' is-on' : ''}`} onClick={() => cur !== o.value && set(o.value)}>{o.label}</button>
            ))}
          </div>
        );
        break;
      }
      control = (
        <select className="axf-settings__field" value={typeof value === 'string' ? value : ''} disabled={locked} onChange={(e) => set(e.target.value)}>
          {(spec.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case 'multi_choice': {
      const chosen = Array.isArray(value) ? value : [];
      control = (
        <div className="axf-settings__multi">
          {(spec.options ?? []).map((o) => (
            <label key={o.value}><input type="checkbox" disabled={locked} checked={chosen.includes(o.value)} onChange={(e) => set(e.target.checked ? [...chosen, o.value] : chosen.filter((c) => c !== o.value))} /> {o.label}</label>
          ))}
        </div>
      );
      break;
    }
    case 'asset_slot':
      control = <AssetSlotControl type={spec.target as AssetType} locked={locked} />;
      break;
    case 'action':
      control = <Button icon={spec.icon ?? 'play'} disabled={locked} onClick={() => spec.target && rt.dispatch(spec.target)}>{spec.label}</Button>;
      return <div className="axf-settings__row"><div className="axf-settings__label">{spec.description ?? ''}</div>{control}</div>;
    case 'link':
      control = <Button icon={spec.icon ?? 'chevron-right'} onClick={() => spec.target && rt.navigate(spec.target)}>Open</Button>;
      break;
    default:
      return null;
  }
  return (
    <div className="axf-settings__row">
      <div className="axf-settings__label">
        <span>{denied && <Icon name="lock" size={13} />} {spec.label}{spec.restartRequired && <Chip tone="warning">restart</Chip>}</span>
        {spec.description && <span className="fx-muted axf-settings__hint">{spec.description}</span>}
      </div>
      <div className="axf-settings__control">{control}</div>
    </div>
  );
}

/** Picks the active asset of a slot. Chrome slots (hideable in asset-types.json) also offer Hidden. */
const HIDDEN = '__axf-hidden';
function AssetSlotControl({ type, locked }: { type: AssetType; locked: boolean }) {
  const rt = useRuntime();
  const state = useAxfState();
  const options = rt.registry.list(type);
  const canHide = hideable(type);
  // The app's own choice (a host app's chrome never shows here: those rows are left out, see SettingRow).
  const hidden = rt.slotHiddenOwn(type);
  const pick = (v: string) => {
    if (v === HIDDEN) return rt.setSlotHidden(type, true);
    if (hidden) rt.setSlotHidden(type, false);
    if (v !== state.active[type]) rt.swap(type, v);
  };
  return (
    <select className="axf-settings__field" value={hidden ? HIDDEN : state.active[type]} disabled={locked || options.length + (canHide ? 1 : 0) < 2} onChange={(e) => pick(e.target.value)}>
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      {canHide && <option value={HIDDEN}>Hidden</option>}
    </select>
  );
}

/* ---------------- Settings interface: pick the settings page every app shares ---------------- */

const SETTINGS_LAYOUT_LABEL: Record<string, string> = { 'tabs-top': 'tabs across the top', 'tabs-side': 'tabs at the side', list: 'a list you drill into' };

/**
 * Appearance → Settings interface: every `settings` asset the app ships, the active one marked, Use on the others.
 * A pick is an ordinary swap, so a developer app that reads its look from axHub saves it to the hub's appearance
 * document and every other app shipping the same asset id switches to it live.
 */
function SettingsInterfacePanel() {
  const rt = useRuntime();
  const state = useAxfState();
  const options = rt.registry.list('settings');
  const active = state.active['settings'];
  const denied = rt.gate('assets.swap') !== 'allow';
  const hub = rt.appearanceHub();
  if (!options.length) return <p className="fx-muted axf-settings__hint">This app ships no settings interface asset.</p>;
  return (
    <div className="axf-settings__rows">
      <p className="fx-muted axf-settings__hint">
        {hub
          ? `Shared through axHub (${hub.replace(/^https?:\/\//, '')}): picking one here changes the settings page in every app that reads its look from the hub and ships the same interface.`
          : 'This app keeps the pick on this device. Apps that read their look from axHub share it.'}
      </p>
      {options.map((a) => {
        const ui = normalizeSettingsUi(a.data);
        const on = a.id === active;
        const bits = [SETTINGS_LAYOUT_LABEL[ui.layout] ?? ui.layout, `${ui.header} header`, ui.search ? 'search' : '', ui.descriptions ? 'descriptions' : 'no descriptions', ui.toolbar ? `toolbar: ${rt.registry.list('toolbar').find((x) => x.id === ui.toolbar)?.name ?? `${ui.toolbar} (missing)`}` : ''].filter(Boolean).join(' · ');
        return (
          <div key={a.id} className="axf-settings__row" data-axf-anchor={`settings-ui:${a.id}`}>
            <div className="axf-settings__label">
              <span>{a.name}{on ? ' (in use)' : ''}</span>
              <span className="fx-muted axf-settings__hint">{a.description ? `${a.description} ` : ''}{bits}</span>
            </div>
            <div className="axf-settings__control">
              <Button size="sm" tone={on ? 'quiet' : 'primary'} disabled={on || denied} onClick={() => rt.swap('settings', a.id)}>{on ? 'In use' : 'Use'}</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Assets: one collapsible card per slot, one per asset, extra tokens (core/engines/customize.ts) ---------------- */

const humanize = (v: string) => (v === 'theme' ? 'Theme default' : v.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));

function TokenControl({ token, value, onChange }: { token: CustomTokenSpec; value: CustomValue; onChange: (v: CustomValue | null) => void }) {
  switch (token.kind) {
    case 'scale':
      return <Slider label={token.label} value={Number(value)} min={token.min} max={token.max} step={token.step} unit={token.unit} onChange={(v) => onChange(v)} />;
    case 'toggle':
      return <Switch label={token.label} checked={value === true} onChange={(v) => onChange(v)} />;
    case 'iconset': {
      const set = iconSet(value) ?? ICON_SETS[0]!;
      const cls = `axf-iconprev--${set.id}`;
      return (
        <div className="axf-settings__row">
          <div className="axf-settings__label">
            <span>{token.label}</span>
            <span className={`axf-settings__iconprev ${cls}`} aria-hidden="true">
              <style>{`.${cls} .fx-icon{${iconSetDecls(set).join(';')}}`}</style>
              {['home', 'search', 'bell', 'settings', 'star', 'folder'].map((n) => <Icon key={n} name={n} size={16} />)}
            </span>
          </div>
          <div className="axf-settings__control">
            <select className="axf-settings__field" aria-label={token.label} value={set.id} onChange={(e) => onChange(e.target.value)}>
              {ICON_SETS.map((i, n) => <option key={i.id} value={i.id}>{n + 1}. {i.label}</option>)}
            </select>
          </div>
        </div>
      );
    }
    default:
      return (
        <div className="axf-settings__row">
          <div className="axf-settings__label"><span>{token.label}</span></div>
          <div className="axf-settings__control">
            <select className="axf-settings__field" aria-label={token.label} value={String(value)} onChange={(e) => onChange(e.target.value)}>
              {(token.options ?? []).map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
            </select>
          </div>
        </div>
      );
  }
}

function TokenEditor({ type, values, onChange }: { type: AssetType; values: CustomValues; onChange: (key: string, v: CustomValue | null) => void }) {
  const tokens = customTokensFor(type);
  return (
    <div className="axf-settings__rows">
      {CUSTOM_GROUPS.map((g) => {
        const list = tokens.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <Fragment key={g}>
            <h4 className="axf-settings__section">{g}</h4>
            {list.map((t) => <TokenControl key={t.key} token={t} value={values[t.key] ?? t.default} onChange={(v) => onChange(t.key, v === t.default ? null : v)} />)}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The assets of `type` this app actually uses: the active one plus any attached to a banner or toolbar. */
function usedAssetIds(rt: AxfRuntime, type: AssetType, active: string | undefined): string[] {
  const ids: string[] = [];
  const add = (id: unknown) => { if (typeof id === 'string' && !ids.includes(id)) ids.push(id); };
  add(active);
  const attached = (list: unknown) => {
    if (Array.isArray(list)) for (const a of list) if (a && (a as HostAttachment).type === type) add((a as HostAttachment).id);
  };
  attached((rt.assetOrNull('banner')?.data as { attach?: unknown } | undefined)?.attach);
  attached((rt.assetOrNull('toolbar')?.data as { widgets?: unknown } | undefined)?.widgets);
  attached(rt.hostAttachments('banner'));
  attached(rt.hostAttachments('toolbar'));
  return ids.filter((id) => rt.registry.list(type).some((a) => a.id === id));
}

/**
 * The assets of a slot this app uses, each in its own collapsible card, inside one collapsible group.
 * "Apply settings to all" shows only when the app uses two or more of the type (two toolbars, two clocks);
 * with one, it's edited on its own.
 */
function AssetInstances({ type }: { type: AssetType }) {
  const rt = useRuntime();
  const state = useAxfState();
  useSettingsRevision(rt);
  const active = (state.active as Record<string, string | undefined>)[type];
  const ids = usedAssetIds(rt, type, active);
  const all = rt.registry.list(type);
  const assets = ids.map((id) => all.find((a) => a.id === id)!).filter(Boolean);
  const stored = rt.customSlot(type);
  const many = assets.length > 1;
  // One asset: never shared. A saved "apply to all" is read as that asset's own values.
  const slot = many || !stored.all || !ids[0] ? stored : { all: false, shared: stored.shared, byId: { ...stored.byId, [ids[0]]: { ...stored.shared, ...(stored.byId[ids[0]] ?? {}) } } };
  const locked = rt.gate('assets.swap') !== 'allow';
  const first = assets[0];
  if (!first) return null;
  const label = assetTypeSpecs[type].label.toLowerCase();
  const cards = assets.map((a, i) => {
    const editable = !locked && customEditable(slot, ids, a.id);
    const values = effectiveCustom(slot, a.id);
    const changed = Object.keys(values).length;
    const own = slot.all ? (i === 0) : true;
    return (
      <div key={a.id} className={editable ? '' : 'axf-settings__off'} aria-disabled={!editable || undefined} data-axf-anchor={`custom-asset:${type}:${a.id}`}>
        <Container collapsible defaultOpen={!many} title={a.name} icon={assetTypeSpecs[type].icon}
          actions={<>{a.id === active && <Chip tone="accent">active</Chip>}{own && changed > 0 && <Chip>{changed} changed</Chip>}</>}>
          {!editable && !locked && <p className="fx-muted axf-settings__hint">Uses the settings of {first.name} (Apply settings to all). Untick it to edit this one.</p>}
          <fieldset className="axf-settings__fieldset" disabled={!editable}>
            <TokenEditor type={type} values={values} onChange={(k, v) => rt.setCustomSlot(type, setCustomToken(slot, a.id, k, v, type))} />
            {own && changed > 0 && <Button tone="ghost" icon="refresh" onClick={() => rt.setCustomSlot(type, slot.all ? { ...slot, shared: {} } : { ...slot, byId: { ...slot.byId, [a.id]: {} } })}>Back to the theme</Button>}
          </fieldset>
        </Container>
      </div>
    );
  });
  if (!many) return <div className="axf-settings__rows">{cards}</div>;
  return (
    <Container collapsible defaultOpen title={`${assets.length} ${assetTypeSpecs[type].label.toLowerCase()} assets in this app`} icon={assetTypeSpecs[type].icon}>
      <div className="axf-settings__rows">
        <Checkbox label="Apply settings to all" checked={slot.all} disabled={locked}
          title={slot.all ? `Every ${label} uses the settings of ${first.name}. Untick to edit each one.` : 'Each one keeps its own settings. Tick to use the first one\'s for all.'}
          onChange={(v) => rt.setCustomSlot(type, setApplyAll(slot, ids, v))} />
        {cards}
      </div>
    </Container>
  );
}

function AssetSlotCard({ spec }: { spec: SettingSpec }) {
  const rt = useRuntime();
  const type = spec.target as AssetType;
  if (rt.slotOwnedByHost(type)) return null;
  return (
    <div data-axf-anchor={`settings-slot:${type}`}>
      <Container collapsible defaultOpen={false} title={assetTypeSpecs[type].label} icon={assetTypeSpecs[type].icon}>
        <div className="axf-settings__rows">
          <SettingRow spec={spec} />
        </div>
      </Container>
    </div>
  );
}

/**
 * Appearance → Asset appearance: laid out like the Assets section (one collapsible card per slot), holding each
 * slot's per-asset appearance editors (text, colours, layout, shape, icons, motion, hover, click; core/engines/customize.ts).
 * Only slots with editable tokens that the app actually shows; a slot the host owns or that is hidden is left out.
 */
function AssetAppearancePanel() {
  const rt = useRuntime();
  useAxfState();
  useSettingsRevision(rt);
  const types = ASSET_TYPES.filter((t) => customizable(t) && rt.registry.list(t).length > 0 && !rt.slotOwnedByHost(t) && !rt.slotHiddenOwn(t));
  if (!types.length) return <p className="fx-muted axf-settings__hint">No asset in this app has appearance settings.</p>;
  return (
    <div className="axf-settings__rows">
      {types.map((t) => (
        <div key={t} data-axf-anchor={`settings-appearance:${t}`}>
          <Container collapsible defaultOpen={false} title={assetTypeSpecs[t].label} icon={assetTypeSpecs[t].icon}>
            <AssetInstances type={t} />
          </Container>
        </div>
      ))}
    </div>
  );
}

function GroupCard({ group }: { group: SettingsGroup }) {
  if (group.id === 'axf.appearance') {
    return (
      <div data-axf-anchor={`settings-group:${group.id}`}>
        <Container title={group.label} icon={group.icon ?? 'settings'}>
          {group.description && <p className="fx-muted axf-settings__desc" style={{ marginTop: 0 }}>{group.description}</p>}
          <div className="axf-settings__rows">{group.settings.map((s) => s.kind === 'asset_slot' ? <AssetSlotCard key={s.key} spec={s} /> : <SettingRow key={s.key} spec={s} />)}</div>
        </Container>
      </div>
    );
  }
  const g = group as SettingsGroup & { collapsible?: boolean; collapsed?: boolean };
  return (
    <div data-axf-anchor={`settings-group:${group.id}`}>
      <Container title={group.label} icon={group.icon ?? 'settings'} collapsible={g.collapsible} defaultOpen={!g.collapsed}>
        {group.description && <p className="fx-muted axf-settings__desc" style={{ marginTop: 0 }}>{group.description}</p>}
        <div className="axf-settings__rows">{group.settings.map((s) => <SettingRow key={s.key} spec={s} />)}</div>
      </Container>
    </div>
  );
}

/* ---------------- Sliders (look@1 for the whole app, Oct 26 2026) ---------------- */

/** One setting: look@1 values for the whole page, only the changed tokens (they override the inherited theme). */
export const APP_LOOK_KEY = 'axf.look';
/** Panels drawn as collapsible sections. */
const COLLAPSIBLE_PANELS = new Set(['axf.look.sliders']);

/** Every slider for the whole app in one collapsible section, with Reset. Simple level in the shared settings interface. */
function LookSlidersPanel() {
  const rt = useRuntime();
  useSettingsRevision(rt);
  const sub = useMemo(() => (fn: () => void) => rt.settings.onChange(APP_LOOK_KEY, fn), [rt]);
  useSyncExternalStore(sub, () => JSON.stringify(rt.settings.get(APP_LOOK_KEY) ?? null), () => '');
  const values: LookValues = normalizeLook(rt.settings.get(APP_LOOK_KEY));
  const n = lookChanged(values);
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  const save = (next: LookValues) => rt.settings.set(APP_LOOK_KEY, (Object.keys(next).length ? next : null) as never);
  const locked = rt.gate('assets.swap') !== 'allow';
  return (
    <div className="fx-stack" aria-disabled={locked || undefined}>
      <p className="fx-muted axf-settings__desc" style={{ margin: 0 }}>Every slider for the whole app. Compact at 0 leaves no space at all. Only what you move overrides the theme.</p>
      <fieldset className="axf-settings__fieldset" disabled={locked}>
        <LookEditor values={values} onChange={save} scope="app" level="advanced" only="slider" open />
      </fieldset>
      <div className="fx-row fx-row--wrap">
        <Button tone={sure ? 'danger' : 'ghost'} icon="refresh" disabled={n === 0 || locked} onClick={() => { if (!sure) { setSure(true); return; } setSure(false); save({}); }}>
          {sure ? 'Tap again to reset every slider' : `Reset sliders${n ? ` (${n} changed)` : ''}`}
        </Button>
      </div>
    </div>
  );
}

/** The app-wide look: one stylesheet on body over the theme captured on html (empty = the theme as is). */
function applyAppLook(rt: AxfRuntime): void {
  const doc = globalThis.document;
  if (!doc) return;
  let el = doc.getElementById('axf-app-look') as HTMLStyleElement | null;
  // locked: this device's sliders are set aside (kept, not applied) so the look is the theme's own
  const css = rt.appearanceLocked() ? '' : lookCss(rt.settings.get(APP_LOOK_KEY), { scope: 'body', base: 'html', p: 'fxa', for: 'app' });
  if (!css) { el?.remove(); return; }
  if (!el) { el = doc.createElement('style'); el.id = 'axf-app-look'; doc.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

/* ---------------- randomize rolls (core/engines/roll.ts) ---------------- */

/** Slot switches: which slots "Randomize all" may change. Context menus start off. uac-policy is never rolled. */
function rollGroup(): SettingsGroup {
  return {
    id: 'axf.roll',
    label: 'Randomize',
    icon: 'shuffle',
    tab: 'appearance',
    order: 15,
    description: 'Which slots "Randomize all" may change. A slot that is off keeps its current asset.',
    settings: ASSET_TYPES.filter((t) => !rollNever(t) && !attachable(t)).map((t) => ({
      key: ROLL_SLOT_KEY(t),
      label: assetTypeSpecs[t].label,
      kind: 'toggle' as const,
      default: rollSlotDefault(t),
      requires: 'assets.swap',
      slot: t,
      ...(t === 'context-menu' ? { description: 'Off by default: rolls leave context menus alone.' } : {}),
    })),
  };
}

/** Per-asset switches: which assets a roll may pick. Context-menu assets are opt-in, one by one. */
function RollAssetsPanel() {
  const rt = useRuntime();
  useAxfState();
  useSettingsRevision(rt);
  const types = ASSET_TYPES.filter((t) => !rollNever(t) && !attachable(t) && !rt.slotOwnedByHost(t));
  const [type, setType] = useState<AssetType>('context-menu');
  const locked = rt.gate('assets.swap') !== 'allow';
  const slotOn = rt.rollSlotIncluded(type);
  const hidden = rt.slotHiddenOwn(type);
  return (
    <div className="axf-settings__rows">
      <div className="axf-settings__row">
        <div className="axf-settings__label">
          <span>Slot</span>
          <span className="fx-muted axf-settings__hint">{hidden ? `${assetTypeSpecs[type].label} is hidden (Assets above), so rolls skip it.` : slotOn ? 'Rolls change this slot, picking only the assets switched on below.' : 'This slot is off above, so rolls leave it alone whatever is switched on here.'}</span>
        </div>
        <div className="axf-settings__control">
          <select className="axf-settings__field" value={type} onChange={(e) => setType(e.target.value as AssetType)} aria-label="Slot">
            {types.map((t) => <option key={t} value={t}>{assetTypeSpecs[t].label}</option>)}
          </select>
        </div>
      </div>
      {rt.registry.list(type).map((a) => {
        const on = rt.rollAssetIncluded(type, a.id);
        const overridden = typeof rt.settings.get(ROLL_ASSET_KEY(type, a.id)) === 'boolean';
        return (
          <div key={a.id} className={`axf-settings__row${hidden ? ' axf-settings__off' : ''}`} aria-disabled={hidden || undefined} data-axf-anchor={`roll-asset:${type}:${a.id}`}>
            <div className="axf-settings__label">
              <span>{a.name}</span>
              <span className="fx-muted axf-settings__hint fx-mono">{a.id}{overridden ? ' · changed here' : ''}</span>
            </div>
            <div className="axf-settings__control fx-row fx-row--wrap">
              <Switch hideLabel className="axf-settings__switch" label={`Include ${a.name} in rolls`} text={on ? 'In rolls' : 'Not in rolls'} checked={on} disabled={locked || hidden} onChange={(v) => rt.setRollAsset(type, a.id, v)} />
              {overridden && <Button tone="ghost" icon="refresh" disabled={locked || hidden} onClick={() => rt.setRollAsset(type, a.id, null)}>Default</Button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- standard panels ---------------- */

function RolePanel() {
  const rt = useRuntime();
  const state = useAxfState();
  const policy = useAsset('uac-policy');
  return (
    <div className="axf-settings__rows">
      <div className="axf-settings__row">
        <div className="axf-settings__label"><span>Acting as</span><span className="fx-muted axf-settings__hint">Roles come from the active access policy ({policy.name}).</span></div>
        <div className="axf-settings__control">
          <select className="axf-settings__field" value={state.role} onChange={(e) => rt.setRole(e.target.value)}>
            {policy.data.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function AccessPanel() {
  const rt = useRuntime();
  const policy = useAsset('uac-policy');
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ marginTop: 0 }}>{policy.name}: {policy.description}</p>
      <div><Button icon="chevron-right" onClick={() => rt.navigate('account')}>Roles and permissions</Button></div>
    </div>
  );
}

/**
 * Every installed library with its health, straight from the plugin inventory engine (plugin-inventory@1), so every app
 * ships a plugin list in Settings → Plugins. Each row opens the library's settings tab when it has one, or the Plugin
 * Manager (`plugin-manager.open:<id>`) when that plugin is installed (same on Android: `InstalledModulesPanel`).
 */
function LibrariesPanel() {
  const rt = useRuntime();
  useSettingsRevision(rt);
  const inv = useMemo(() => runtimeInventory(rt), [rt, rt.libraries.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const manager = Boolean(rt.actions.get('plugin-manager.open'));
  if (!inv.items.length && !rt.skippedLibraries.length) return <p className="fx-muted" style={{ margin: 0 }}>No libraries installed.</p>;
  const tone = (h: string) => (h === 'ok' ? 'success' : h === 'partial' ? 'warning' : h === 'off' ? undefined : 'danger');
  return (
    <div className="fx-stack">
      {manager && <div className="fx-row fx-row--wrap"><Button icon="package" onClick={() => rt.dispatch('plugin-manager.open')}>Open the Plugin Manager</Button></div>}
      <ul className="axf-settings__list">
        {inv.items.map((l) => {
          const lib = rt.libraries.find((x) => x.id === l.id);
          const tab = lib?.ui?.settingsTabs[0];
          return (
            <li key={l.id} className="fx-row fx-row--wrap">
              <span className="fx-grow"><strong>{l.name}</strong> <span className="fx-muted">{l.version}</span><br /><span className="fx-mono axf-settings__hint">{l.id}</span></span>
              <ModelBadge model={lib?.builtWith?.model} builtAt={lib?.builtWith?.builtAt} compact />
              {lib?.opens && <Chip>opens in {PLACEMENT_LABELS[rt.placementOf(l.id) ?? lib.opens].toLowerCase()}</Chip>}
              <Chip tone={tone(l.health)}>{l.health === 'ok' ? 'healthy' : l.health}</Chip>
              {l.dependents.length > 0 && <Chip>used by {l.dependents.length}</Chip>}
              {tab && <Button tone="ghost" icon="settings" onClick={() => rt.dispatch(`settings.open:${tab.id}`)}>Settings</Button>}
              {manager && <Button tone="ghost" icon="package" onClick={() => rt.dispatch(`plugin-manager.open:${l.folder}`)}>Details</Button>}
            </li>
          );
        })}
      </ul>
      {inv.conflicts.length > 0 && <p className="fx-muted axf-settings__hint">{inv.conflicts.length} clash{inv.conflicts.length > 1 ? 'es' : ''}: {inv.conflicts.map((c) => c.id).join(', ')}</p>}
      {rt.skippedLibraries.length > 0 && (
        <div className="fx-stack">
          <p className="fx-muted axf-settings__hint" style={{ margin: 0 }}>Not loaded inside {rt.embedded?.host ?? 'the host app'} (it does their job, or hides what they draw). They load as usual when this app runs on its own.</p>
          <ul className="axf-settings__list">
            {rt.skippedLibraries.map((l) => (
              <li key={l.id} className="fx-row fx-row--wrap">
                <span className="fx-grow"><strong>{l.label}</strong> <span className="fx-muted">{l.version}</span><br /><span className="fx-mono axf-settings__hint">{l.id}</span></span>
                <Chip>{l.reason}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AboutPanel() {
  const rt = useRuntime();
  const m = rt.manifest;
  const counts = ASSET_TYPES.map((t) => rt.registry.list(t).length).reduce((a, b) => a + b, 0);
  return (
    <div className="axf-settings__rows">
      <p style={{ marginTop: 0 }}><strong>{m.app.name}</strong> {m.app.version}</p>
      <p className="fx-muted">AmberX AXF {m.framework.version} · {m.framework.template} · {counts} assets · {rt.libraries.length} libraries</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="info" onClick={() => rt.dispatch('help.about')}>About this app</Button>
        <Button icon="keyboard" onClick={() => rt.dispatch('view.shortcuts')}>Shortcuts</Button>
        <Button icon="refresh" requires="assets.swap" onClick={() => rt.dispatch('assets.reset')}>Reset assets to defaults</Button>
      </div>
    </div>
  );
}

/* ---------------- the page ---------------- */

export function SettingsView() {
  const rt = useRuntime();
  useSettingsRevision(rt);
  const ui = useSettingsUi();
  // Inside a host that manages plugins (embed@1 take `plugins`, Patches) the plugin list (Settings → Plugins itself) isn't
  // shown: the host installs and switches them. Each plugin's own settings stay, as usual (never greyed out).
  const pluginLock = rt.hostLockNote('plugins');
  // Every tab as the settings asset arranges it (order, labels, left out), then split into top tabs and sub-tabs.
  const level = useSettingsLevel(ui);
  const all = arrangeSettingsTabs(rt.settings.listTabs(), ui).filter((t) => shownAtLevel(ui, t.id, level));
  const byId = new Map(all.map((t) => [t.id, t]));
  const childrenOf = (id: string) => all.filter((t) => t.parent === id);
  const tabs = all.filter((t) => !t.parent || !byId.has(t.parent)).filter((t) => !(pluginLock && t.id === 'plugins' && !childrenOf('plugins').length));
  // A remembered or requested id may be a sub-tab: resolve it to [top tab, sub-tab].
  // A banner plugin's own settings live inside Banners (one interface for every banner): its tab opens Banners on it.
  const banners = useKnownBanners();
  const folded = banners.length ? bannerSettingsTabs(rt) : new Set<string>();
  const resolve = (id: unknown): [string, string] => {
    if (typeof id === 'string' && folded.has(id)) { askBannerTab(rt, id); return ['plugins', 'banners']; }
    const t = typeof id === 'string' ? byId.get(id) : undefined;
    if (t?.parent && byId.has(t.parent)) return [t.parent, t.id];
    if (t) return [t.id, ''];
    return [ui.layout === 'list' ? '' : tabs[0]?.id ?? 'appearance', ''];
  };
  const [[tab, sub], setSel] = useState<[string, string]>(() => resolve(rt.settings.get(TAB_KEY)));
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onOpen = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) { setQuery(''); setSel(resolve(id)); } };
    globalThis.addEventListener?.('axf:settings-tab', onOpen);
    return () => globalThis.removeEventListener?.('axf:settings-tab', onOpen);
  }, []);
  const choose = (top: string, child = '') => { setSel([top, child]); rt.settings.set(TAB_KEY, child || top); };
  // List layout: no tab picked = the list of tabs (drill-down, with Back); the other layouts always show a tab.
  const current = tabs.find((t) => t.id === tab) ?? (ui.layout === 'list' ? undefined : tabs[0]);
  const subs = current ? childrenOf(current.id).filter((t) => !folded.has(t.id) && (t.id !== 'banners' || banners.length > 0)) : [];
  const noOverview = !!pluginLock && current?.id === 'plugins' && subs.length > 0;
  const shown = (sub && subs.find((t) => t.id === sub)) || (noOverview ? subs[0] : current);
  // The page's own toolbar (settings asset `toolbar` = a toolbar asset id); its search spot holds the settings search.
  const toolbarAsset = ui.toolbar ? rt.registry.list('toolbar').find((a) => a.id === ui.toolbar) : undefined;
  const toolbarSearch = !!toolbarAsset && (toolbarAsset.data as { showSearch?: boolean }).showSearch === true;
  const searchOn = ui.search || toolbarSearch;
  const searching = searchOn && query.trim().length > 0;
  const cls = ['fx-stack', 'fx-stack--lg', 'axf-settings', `axf-settings--${ui.layout}`, ui.descriptions ? '' : 'axf-settings--nodesc'].filter(Boolean).join(' ');

  const tabBar = ui.layout === 'list' ? null : (
    <nav className="axf-settings__tabs" role="tablist" aria-label="Settings sections" aria-orientation={ui.layout === 'tabs-side' ? 'vertical' : 'horizontal'}>
      {tabs.map((t) => (
        <Button key={t.id} role="tab" aria-selected={t.id === current?.id} tone={t.id === current?.id ? 'primary' : 'neutral'} icon={t.icon} onClick={() => { setQuery(''); choose(t.id); }}>{t.label}</Button>
      ))}
    </nav>
  );
  const body = searching ? <SearchResults query={query} tabs={all} ui={ui} /> : !current ? (
    <div className="axf-settings__tablist" role="list">
      {tabs.map((t) => (
        <Button key={t.id} role="listitem" icon={t.icon} className="axf-settings__listitem" onClick={() => choose(t.id)}>
          <span className="axf-settings__listlabel">{t.label}</span>
          {t.description && <span className="fx-muted axf-settings__hint axf-settings__desc">{t.description}</span>}
        </Button>
      ))}
    </div>
  ) : (
    <div className="fx-stack axf-settings__body">
      {ui.layout === 'list' && <div><Button size="sm" tone="quiet" icon="chevron-left" onClick={() => choose('')}>All settings</Button></div>}
      {ui.layout === 'list' && <h2 className="axf-settings__tabtitle">{current.label}</h2>}
      {subs.length > 0 && (
        <nav className="axf-settings__subtabs" role="tablist" aria-label={`${current.label} sections`}>
          {!noOverview && (
            <button type="button" role="tab" aria-selected={shown?.id === current.id} className={`fx-tab ${shown?.id === current.id ? 'is-active' : ''}`} onClick={() => choose(current.id)}>
              <Icon name={current.icon} size={13} /> {current.id === 'plugins' ? 'All plugins' : 'Overview'}
            </button>
          )}
          {subs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === shown?.id} className={`fx-tab ${t.id === shown?.id ? 'is-active' : ''}`} onClick={() => choose(current.id, t.id)}>
              <Icon name={t.icon} size={13} /> {t.label}
            </button>
          ))}
        </nav>
      )}
      {shown?.description && <p className="fx-muted axf-settings__desc" style={{ margin: 0 }}>{shown.description}</p>}
      {shown && <TabContent id={shown.id} />}
    </div>
  );

  return (
    <div className={cls}>
      {ui.header === 'full' && <header className="fx-pagehead"><div><p className="fx-eyebrow">{rt.manifest.app.name}</p><h1>Settings</h1></div></header>}
      {ui.header === 'compact' && <h2 className="axf-settings__title">Settings</h2>}
      {toolbarAsset && (
        <AssetToolbar id={toolbarAsset.id} label="Settings toolbar" search={
          <form className="fx-search" role="search" onSubmit={(e) => e.preventDefault()}>
            <Icon name="search" size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search every setting" aria-label="Search settings" />
          </form>
        } />
      )}
      {ui.levels && <div className="fx-look__levels"><Segmented label="Settings level" value={level} onChange={(l) => rt.settings.set(SETTINGS_LEVEL_KEY, l)} options={SETTINGS_LEVELS.map((l) => ({ value: l, label: SETTINGS_LEVEL_LABEL[l], title: SETTINGS_LEVEL_HINT[l] }))} /><span className="fx-muted fx-look__levelhint">{SETTINGS_LEVEL_HINT[level]}</span></div>}
      {ui.search && !toolbarSearch && <TextField label="Search settings" value={query} onChange={setQuery} placeholder="Search every setting" className="axf-settings__search" />}
      {ui.layout === 'tabs-side' && !searching ? <div className="axf-settings__split">{tabBar}{body}</div> : <>{!searching && tabBar}{body}</>}
    </div>
  );
}

/** Search across every tab the interface shows: matching settings, grouped by tab and group (panels are custom UI and aren't searched). */
function SearchResults({ query, tabs, ui }: { query: string; tabs: SettingsTabLike[]; ui: SettingsUi }) {
  const rt = useRuntime();
  useSettingsRevision(rt);
  const hits = tabs.flatMap((t) => rt.settings.groupsIn(t.id)
    .map((g) => filterSettingsGroup(g, ui))
    .filter((g): g is SettingsGroup => !!g)
    .map((g) => ({ tab: t, group: { ...g, settings: g.settings.filter((s) => s.kind !== 'section' && settingMatches(s, query)) } }))
    .filter((x) => x.group.settings.length > 0));
  if (!hits.length) return <p className="fx-muted">No setting matches “{query.trim()}”.</p>;
  return (
    <div className="fx-stack">
      {hits.map(({ tab, group }) => <GroupCard key={`${tab.id}:${group.id}`} group={{ ...group, label: `${tab.label} · ${group.label}` }} />)}
    </div>
  );
}
type SettingsTabLike = { id: string; label: string };

const DESIGN_PANEL_ID = 'axf.design-package';
const LOCK_PANEL_ID = 'axf.appearance.lock';

/**
 * Settings → Appearance, on top: lock the look (every look control greys out, this device's own tweaks are set aside
 * but kept) and, in a developer app, whether the look is read from axHub at all. Both switches stay usable while
 * locked; they need a role that may change the look.
 */
function AppearanceLockPanel() {
  const rt = useRuntime();
  useAxfState();
  const locked = rt.appearanceLocked();
  const may = rt.mayChangeLook();
  const hub = rt.hasAppearanceSource();
  const following = rt.appearanceFollowing();
  return (
    <div className="fx-stack">
      <Switch label="Lock the look" checked={locked} disabled={!may} text={locked ? 'Locked' : 'Off'}
        hint="Greys out everything that changes how the app looks, so nothing can change it by accident. Your own tweaks here (Sliders, asset appearance) are set aside while it's on and come back when you turn it off."
        onChange={(on) => rt.setAppearanceLocked(on)} />
      {hub && (
        <Switch label="Get the look from axHub" checked={following} disabled={!may} text={following ? 'On' : 'Off'}
          hint={following
            ? 'On: this app shows the same look as your other developer apps and follows changes made in any of them.'
            : 'Off: this app stops reading its look from axHub and keeps its own saved look. Changes here aren\'t sent to axHub either.'}
          onChange={(on) => rt.setAppearanceFollowing(on)} />
      )}
      {locked && <p className="fx-muted axf-settings__desc" style={{ margin: 0 }}>{hub && following ? 'The look from axHub still applies.' : 'The app shows its saved look.'}</p>}
    </div>
  );
}

/** Settings → Appearance → AmberX Design Package: pick a package (style + colour theme + layout + behaviour theme,
 *  plus its extras), save the current look as one, or go back to the app's default look. */
function DesignPackagePanel() {
  const rt = useRuntime();
  useAxfState();
  useSettingsRevision(rt);
  const packages = rt.registry.list('design-package');
  const applied = rt.appliedDesignPackage();
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState('');
  const locked = !rt.can('assets.swap');
  const label = (t: string, id: string) => (id ? rt.registry.get(t as AssetType, id)?.name ?? id : '—');
  const save = () => {
    const title = name.trim() || 'My look';
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-look';
    let id = base.length < 2 ? `${base}-look` : base; let n = 2;
    while (rt.registry.get('design-package', id)) id = `${base}-${n++}`;
    const r = rt.importAsset({ $axf: 'asset@1', type: 'design-package', id, name: title, version: '1.0.0', description: 'Saved from Settings → Appearance.', data: rt.captureDesignPackage(true) }, false, 'settings');
    if (r.ok) { rt.applyDesignPackage(id); setName(''); }
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted">One pick sets the style theme, colour theme, layout and behaviour theme together (and the rest of the look a package carries).</p>
      {!packages.length && <p className="fx-muted">No design packages in this app yet. Save the current look below.</p>}
      {packages.map((p) => {
        const d = p.data as unknown as Record<string, string>;
        const on = p.id === applied;
        return (
          <div key={p.id} className="fx-row" style={{ alignItems: 'center', gap: 'var(--fx-space)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 14em', minWidth: 0 }}>
              <strong>{p.name}</strong>{on && <> <Chip>In use</Chip></>}
              <div className="fx-muted">{label('style-theme', d['style-theme'] ?? '')} · {label('color-theme', d['color-theme'] ?? '')} · {label('layout', d.layout ?? '')} · {label('behavior-theme', d['behavior-theme'] ?? '')}</div>
            </div>
            <Button size="sm" tone={on ? 'quiet' : 'primary'} disabled={locked} onClick={() => rt.applyDesignPackage(p.id)}>{on ? 'Apply again' : 'Apply'}</Button>
          </div>
        );
      })}
      <div className="fx-row" style={{ gap: 'var(--fx-space)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 12em' }}><TextField label="Save the current look as" value={name} onChange={setName} placeholder="My look" /></div>
        <Button size="sm" disabled={locked} onClick={save}>Save</Button>
        <Button size="sm" tone="quiet" disabled={locked} onClick={() => { if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); return; } setConfirm(false); rt.restoreDefaultAppearance(); }}>{confirm ? 'Tap again to restore' : 'Restore default appearance'}</Button>
      </div>
    </div>
  );
}

/** One settings tab's panels and groups, interleaved by `order` (panels first on a tie). Also used inside Banner settings.
 *  What the active settings asset leaves out (group, panel or setting ids) isn't shown. */
export function TabContent({ id, all = false }: { id: string; all?: boolean }) {
  const rt = useRuntime();
  useSettingsRevision(rt);
  const ui = useSettingsUi();
  const level = useSettingsLevel(ui);
  // `all`: every level (a plugin's own settings inside Banner settings aren't cut by the page's level)
  const at = all ? undefined : level;
  const tab = rt.settings.getTab(id);
  const groups = rt.settings.groupsIn(id).map((g) => filterSettingsGroup(g, ui, at)).filter((g): g is SettingsGroup => !!g);
  const panels = rt.settings.panelsIn(id).filter((p) => settingsShown(ui, p.id) && (!at || shownAtLevel(ui, p.id, at)));
  // Settings → Appearance: the AmberX Design Package picker on top, everything else in one collapsible container
  const design = id === 'appearance' && !all ? panels.find((p) => p.id === DESIGN_PANEL_ID) : undefined;
  const lock = design ? panels.find((p) => p.id === LOCK_PANEL_ID) : undefined;
  const rest = design ? panels.filter((p) => p !== design && p !== lock) : panels;
  const items = [...rest.map((p) => ({ order: p.order ?? 100, tie: 0, key: `p:${p.id}`, node: <div data-axf-anchor={`settings-panel:${p.id}`}><Container title={p.title} icon={p.icon ?? tab?.icon ?? 'settings'} collapsible={COLLAPSIBLE_PANELS.has(p.id) || undefined}>{p.render() as ReactNode}</Container></div> })),
    ...groups.map((g) => ({ order: g.order ?? 100, tie: 1, key: `g:${g.id}`, node: <GroupCard group={g} /> }))]
    .sort((a, b) => a.order - b.order || a.tie - b.tie)
    .map((x) => <Fragment key={x.key}>{x.node}</Fragment>);
  if (design) return (
    <>
      {lock && <div data-axf-anchor={`settings-panel:${lock.id}`}><Container title={lock.title} icon={lock.icon ?? 'lock'}>{lock.render() as ReactNode}</Container></div>}
      <div data-axf-anchor={`settings-panel:${design.id}`}><Container title={design.title} icon={design.icon ?? 'palette'}>{design.render() as ReactNode}</Container></div>
      {items.length > 0 && <div data-axf-anchor="settings-panel:axf.appearance.rest"><Container title="Everything else" icon="sliders" collapsible defaultOpen={false}><div className="fx-stack">{items}</div></Container></div>}
    </>
  );
  return (
    <>
      {[...panels.map((p) => ({ order: p.order ?? 100, tie: 0, key: `p:${p.id}`, node: <div data-axf-anchor={`settings-panel:${p.id}`}><Container title={p.title} icon={p.icon ?? tab?.icon ?? 'settings'} collapsible={COLLAPSIBLE_PANELS.has(p.id) || undefined}>{p.render() as ReactNode}</Container></div> })),
        ...groups.map((g) => ({ order: g.order ?? 100, tie: 1, key: `g:${g.id}`, node: <GroupCard group={g} /> }))]
        .sort((a, b) => a.order - b.order || a.tie - b.tie)
        .map((x) => <Fragment key={x.key}>{x.node}</Fragment>)}
      {!panels.length && !groups.length && (
        <p className="fx-muted">{id === 'connections' ? 'Libraries and plugins that talk to servers and services add their connection settings here.' : ui.levels && !all ? 'Nothing here at this level. Pick a higher level above for more.' : 'Nothing here yet.'}</p>
      )}
    </>
  );
}

/** Registers the active settings asset's own tabs and option groups (module `asset:settings/<id>`), and swaps them
 *  when another settings asset becomes active. Values persist under the same keys in every app, so one shared
 *  asset gives every app the same options. */
function syncSettingsAsset(rt: AxfRuntime): () => void {
  let owned = '';
  let tabs: string[] = [];
  const sync = () => {
    const a = rt.assetOrNull('settings');
    const key = a ? `${a.id}@${a.version}:${JSON.stringify(a.data).length}` : '';
    if (key === owned) return;
    if (owned) { rt.settings.removeModule(`asset:settings/${owned.split('@')[0]}`); tabs.forEach((t) => rt.settings.removeTab(t)); }
    owned = key;
    tabs = [];
    if (!a) return;
    const ui = settingsUi(rt);
    const known = new Set(rt.settings.listTabs().map((t) => t.id));
    ui.tabs.forEach((t, i) => {
      if (known.has(t.id) || !t.label) return;
      rt.settings.addTab({ id: t.id, label: t.label, icon: t.icon ?? 'settings', order: t.order ?? 100 + i, ...(t.description ? { description: t.description } : {}), ...(t.parent ? { parent: t.parent } : {}), module: `asset:settings/${a.id}` });
      tabs.push(t.id);
    });
    settingsUiGroups(ui, a.id).forEach((g) => rt.settings.addGroup(g));
  };
  sync();
  return rt.subscribe(sync);
}

/* ---------------- display effects ---------------- */

function applyDisplay(rt: AxfRuntime): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  const scale = rt.settings.get('axf.display.fontScale');
  root.style.fontSize = typeof scale === 'number' && scale !== 100 ? `${scale}%` : '';
  root.toggleAttribute('data-reduced-motion', rt.settings.get('axf.display.animations') === false);
}

/* ---------------- styles (tokens only) ---------------- */

/* Theme-engine tokens only (framework/core/engines/theme.ts + framework/ui/axf.css): no literal colours,
   sizes come from --fx-space / radius / border tokens, so every color-theme and style-theme asset applies. */
const CSS = `
.axf-settings__rows{display:flex;flex-direction:column;gap:calc(var(--fx-space)*1.5)}
.axf-settings__row{display:flex;gap:calc(var(--fx-space)*1.5);align-items:center;justify-content:space-between;flex-wrap:wrap}
.axf-settings__row--wide{flex-direction:column;align-items:stretch}
.axf-settings__label{display:flex;flex-direction:column;gap:calc(var(--fx-space)*.25);min-width:180px;flex:1}
.axf-settings__control{flex:0 1 260px;min-width:160px}
.axf-settings__control select,.axf-settings__control input:not([type=checkbox]):not([type=color]){width:100%}
.axf-settings__field{font:inherit;padding:calc(var(--fx-space)*.75) var(--fx-space);border-radius:var(--fx-radius-sm);border:var(--fx-border-w) solid var(--fx-border);background:var(--fx-surface2);color:var(--fx-text)}
.axf-settings__field:focus-visible{outline:2px solid var(--fx-accent);outline-offset:1px}
.axf-settings__field:disabled{opacity:var(--fx-opacity-disabled)}
.axf-settings__off{opacity:var(--fx-opacity-disabled)}
.axf-settings__off .axf-settings__field:disabled{opacity:1}
.axf-settings__offnote{margin:calc(var(--fx-space)*.25) 0 0}
.axf-settings input[type=checkbox]{accent-color:var(--fx-accent)}
.axf-settings__hint{font-size:.85em;color:var(--fx-muted)}
.axf-settings__switch{gap:var(--fx-space)}
.axf-settings__fieldset{border:0;margin:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:calc(var(--fx-space)*1.5)}
.axf-settings__iconprev{display:inline-flex;gap:calc(var(--fx-space)*.75);color:var(--fx-text)}
.axf-settings__multi{display:flex;flex-direction:column;gap:calc(var(--fx-space)/2)}
.axf-settings__section{margin:var(--fx-space) 0 0;font-size:.95em}
.axf-settings__list{margin:0;padding-left:calc(var(--fx-space)*2.25);display:flex;flex-direction:column;gap:var(--fx-space)}
.axf-settings__tablist{display:flex;flex-direction:column;gap:calc(var(--fx-space)/2)}
.axf-settings__listitem{justify-content:flex-start;text-align:left;width:100%}
.axf-settings__listlabel{font-weight:600}
.axf-settings__listitem .axf-settings__hint{margin-left:var(--fx-space)}
.axf-settings__title,.axf-settings__tabtitle{margin:0}
.axf-settings__search{max-width:420px}
.axf-settings__split{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:calc(var(--fx-space)*2);align-items:start}
.axf-settings--tabs-side .axf-settings__tabs{display:flex;flex-direction:column;align-items:stretch;gap:calc(var(--fx-space)/2)}
.axf-settings--tabs-side .axf-settings__tabs>*{justify-content:flex-start}
.axf-settings--nodesc .axf-settings__hint,.axf-settings--nodesc .axf-settings__desc{display:none}
@media (max-width:640px){.axf-settings__split{grid-template-columns:1fr}.axf-settings--tabs-side .axf-settings__tabs{flex-direction:row;flex-wrap:wrap}}
[data-reduced-motion] *{transition:none!important;animation:none!important}
`;

function injectStyles(): void {
  const doc = globalThis.document;
  if (!doc || doc.getElementById('axf-settings-css')) return;
  const el = doc.createElement('style');
  el.id = 'axf-settings-css';
  el.textContent = CSS;
  doc.head.appendChild(el);
}

/* ---------------- the library ---------------- */

/** Asset-slot settings for every asset type that has a choice to make. */
function appearanceGroup(rt: AxfRuntime): SettingsGroup {
  return {
    id: 'axf.appearance',
    label: 'Assets',
    icon: 'palette',
    tab: 'appearance',
    order: 10,
    description: 'Pick the active asset for each slot. Change how each one looks in Asset appearance below.',
    settings: ASSET_TYPES.filter((t) => rt.registry.list(t).length > 0 && !attachable(t)).map((t) => ({
      key: `axf.slot.${t}`,
      label: assetTypeSpecs[t].label,
      kind: 'asset_slot' as const,
      target: t,
      requires: t === 'uac-policy' ? 'uac.manage' : 'assets.swap',
      ...(t === 'uac-policy' ? { description: 'Changing the policy may change your role.' } : hideable(t) ? { description: 'Hidden removes it from the screen; its other options here grey out.' } : {}),
    })),
  };
}

export const library: AxfWebLibrary = {
  id: SETTINGS_LIBRARY_ID,
  label: 'Settings',
  version: '0.1.0',
  provides: ['axf.settings'],
  register(rt) {
    injectStyles();
    setBannerOwnSettingsRenderer((tab) => <TabContent id={tab} all />);
    rt.settings.addGroup(appearanceGroup(rt));
    rt.settings.addGroup(rollGroup());
    syncSettingsAsset(rt);
    applyDisplay(rt);
    applyAppLook(rt);
    rt.settings.onChange(APP_LOOK_KEY, () => applyAppLook(rt));
    rt.settings.onChange(APPEARANCE_LOCK_KEY, () => applyAppLook(rt));
    rt.settings.onChange('axf.display.fontScale', () => applyDisplay(rt));
    rt.settings.onChange('axf.display.animations', () => applyDisplay(rt));
    rt.actions.register('app.settings', () => rt.navigate(VIEW), { label: 'Settings' });
    rt.actions.register('settings.open', ([tab]) => {
      rt.navigate(VIEW);
      if (tab) {
        rt.settings.set(TAB_KEY, tab);
        globalThis.dispatchEvent?.(new CustomEvent('axf:settings-tab', { detail: tab }));
      }
    }, { label: 'Open a settings tab', params: true });
  },
  views: {
    [VIEW]: { title: 'Settings', icon: 'settings', render: () => <SettingsView /> },
    // Banners on their own: the page a host shows in its own settings (embed@1 page `banners`, Patches' Banners tab).
    [BANNERS_VIEW]: { title: 'Banners', icon: 'bell', render: () => <div className="fx-stack fx-stack--lg axf-settings"><header className="fx-pagehead"><div><p className="fx-eyebrow">Settings</p><h1>Banners</h1></div></header><BannerSettingsPanel /></div> },
  },
  settingsTabs: Object.values(SETTINGS_TABS),
  settings: [
    {
      id: 'axf.display',
      label: 'Display',
      icon: 'monitor',
      tab: 'appearance',
      order: 20,
      settings: [
        { key: SPACING_KEY, label: 'Spacing', kind: 'choice', default: SPACING_DEFAULT, requires: 'assets.swap', options: SPACINGS.map((v) => ({ value: v, label: SPACING_LABEL[v] })), description: 'How much room between and around things. Applies to every theme; Regular shows the style theme as designed.' },
        { key: 'axf.display.fontScale', label: 'Text size', kind: 'slider', default: 100, min: 80, max: 140, step: 5, requires: 'assets.swap', description: 'Percent of the normal size.' },
        { key: 'axf.display.animations', label: 'Animations', kind: 'toggle', default: true, requires: 'assets.swap', description: 'Off reduces motion.' },
      ],
    },
  ],
  settingsPanels: [
    { id: 'axf.account.role', tab: 'account', title: 'Role', icon: 'shield', order: 10, render: () => <RolePanel /> },
    { id: 'axf.account.profile', tab: 'account', title: 'Access policy', icon: 'user', order: 20, render: () => <AccessPanel /> },
    { id: LOCK_PANEL_ID, tab: 'appearance', title: 'Lock the look', icon: 'lock', order: -1, render: () => <AppearanceLockPanel /> },
    { id: DESIGN_PANEL_ID, tab: 'appearance', title: 'AmberX Design Package', icon: 'palette', order: 0, render: () => <DesignPackagePanel /> },
    { id: 'axf.look.sliders', tab: 'appearance', title: 'Sliders', icon: 'sliders', order: 1, render: () => <LookSlidersPanel /> },
    { id: 'axf.settings-ui', tab: 'appearance', title: 'Settings interface', icon: 'settings', order: 5, render: () => <SettingsInterfacePanel /> },
    { id: 'axf.asset-appearance', tab: 'appearance', title: 'Asset appearance', icon: 'sliders', order: 11, render: () => <AssetAppearancePanel /> },
    { id: 'axf.roll.assets', tab: 'appearance', title: 'Assets in rolls', icon: 'shuffle', order: 16, render: () => <RollAssetsPanel /> },
    { id: 'axf.plugins.libraries', tab: 'plugins', title: 'Installed plugins and libraries', icon: 'box', order: 50, render: () => <LibrariesPanel /> },
    { id: 'axf.banners', tab: 'banners', title: 'Every banner', icon: 'bell', order: 10, render: () => <BannerSettingsPanel /> },
    { id: 'axf.about', tab: 'about', title: 'About', icon: 'info', order: 10, render: () => <AboutPanel /> },
  ],
};

/** Convenience for apps that render the page somewhere other than the `settings` view. */
export function useSettingsTabs(): string[] {
  const rt = useRuntime();
  const rev = useSettingsRevision(rt);
  return useMemo(() => rt.settings.listTabs().map((t) => t.id), [rt, rev]);
}
