/**
 * Settings library (web port of ai.amberx.axf.settings, Android: framework/android/lib-settings).
 *
 * A schema-driven Settings page with tabs. The standard tabs are Appearance, Account & security,
 * Connections, Plugins and About; any library or plugin can add settings groups (generated controls)
 * or panels (custom UI) to any tab through its AxfWebLibrary (`settings`, `settingsPanels`,
 * `settingsTabs`), or a new tab of its own. Values persist per app (secrets never do).
 *
 * Open it with the standard `app.settings` action, or `settings.open:<tab>` for a tab.
 */
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ASSET_TYPES, assetTypeSpecs, rollNever, rollSlotDefault, ROLL_ASSET_KEY, ROLL_SLOT_KEY, type AssetType, type AxfRuntime, type SettingSpec, type SettingValue, type SettingsGroup } from '../../core';
import { Button, Chip, Container, Icon, Slider, useAsset, useAxfState, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';

export const SETTINGS_LIBRARY_ID = 'ai.amberx.axf.settings';
const VIEW = 'settings';
const TAB_KEY = 'axf.settings.lastTab';

/** Standard tabs, in order. Ids are stable: libraries target them by id. */
export const SETTINGS_TABS = {
  appearance: { id: 'appearance', label: 'Appearance', icon: 'palette', order: 10, description: 'Every slot is a hot-swappable asset. Changes apply instantly and persist.' },
  account: { id: 'account', label: 'Account & security', icon: 'shield', order: 20, description: 'Who you are acting as, and how this app is protected.' },
  connections: { id: 'connections', label: 'Connections', icon: 'cloud', order: 30, description: 'Servers and services this app talks to.' },
  plugins: { id: 'plugins', label: 'Plugins', icon: 'package', order: 40, description: 'Libraries and plugins installed in this app.' },
  about: { id: 'about', label: 'About', icon: 'info', order: 90, description: 'Versions and help.' },
} as const;

/* ---------------- hooks ---------------- */

function useSettingsRevision(rt: AxfRuntime): number {
  return useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision);
}

/* ---------------- controls ---------------- */

/** Every row carries a search anchor, so the toolbar search can scroll to it and flash it. */
function SettingRow({ spec }: { spec: SettingSpec }) {
  return <div data-axf-anchor={`setting:${spec.key}`}><SettingControl spec={spec} /></div>;
}

function SettingControl({ spec }: { spec: SettingSpec }) {
  const rt = useRuntime();
  useAxfState();
  useSettingsRevision(rt);
  const locked = spec.requires ? rt.gate(spec.requires) !== 'allow' : false;
  const value = rt.settings.get(spec.key);
  const set = (v: SettingValue) => rt.settings.set(spec.key, v);

  let control: ReactNode;
  switch (spec.kind) {
    case 'section':
      return <h3 className="axf-settings__section">{spec.label}</h3>;
    case 'toggle':
      control = (
        <label className="axf-settings__switch">
          <input type="checkbox" checked={value === true} disabled={locked} onChange={(e) => set(e.target.checked)} />
          <span>{value === true ? 'On' : 'Off'}</span>
        </label>
      );
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
        <span>{locked && <Icon name="lock" size={13} />} {spec.label}{spec.restartRequired && <Chip tone="warning">restart</Chip>}</span>
        {spec.description && <span className="fx-muted axf-settings__hint">{spec.description}</span>}
      </div>
      <div className="axf-settings__control">{control}</div>
    </div>
  );
}

function AssetSlotControl({ type, locked }: { type: AssetType; locked: boolean }) {
  const rt = useRuntime();
  const state = useAxfState();
  const options = rt.registry.list(type);
  return (
    <select className="axf-settings__field" value={state.active[type]} disabled={locked || options.length < 2} onChange={(e) => rt.swap(type, e.target.value)}>
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function GroupCard({ group }: { group: SettingsGroup }) {
  return (
    <div data-axf-anchor={`settings-group:${group.id}`}>
      <Container title={group.label} icon={group.icon ?? 'settings'}>
        {group.description && <p className="fx-muted" style={{ marginTop: 0 }}>{group.description}</p>}
        <div className="axf-settings__rows">{group.settings.map((s) => <SettingRow key={s.key} spec={s} />)}</div>
      </Container>
    </div>
  );
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
    settings: ASSET_TYPES.filter((t) => !rollNever(t)).map((t) => ({
      key: ROLL_SLOT_KEY(t),
      label: assetTypeSpecs[t].label,
      kind: 'toggle' as const,
      default: rollSlotDefault(t),
      requires: 'assets.swap',
      ...(t === 'context-menu' ? { description: 'Off by default: rolls leave context menus alone.' } : {}),
    })),
  };
}

/** Per-asset switches: which assets a roll may pick. Context-menu assets are opt-in, one by one. */
function RollAssetsPanel() {
  const rt = useRuntime();
  useAxfState();
  useSettingsRevision(rt);
  const types = ASSET_TYPES.filter((t) => !rollNever(t));
  const [type, setType] = useState<AssetType>('context-menu');
  const locked = rt.gate('assets.swap') !== 'allow';
  const slotOn = rt.rollSlotIncluded(type);
  return (
    <div className="axf-settings__rows">
      <div className="axf-settings__row">
        <div className="axf-settings__label">
          <span>Slot</span>
          <span className="fx-muted axf-settings__hint">{slotOn ? 'Rolls change this slot, picking only the assets switched on below.' : 'This slot is off above, so rolls leave it alone whatever is switched on here.'}</span>
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
          <div key={a.id} className="axf-settings__row" data-axf-anchor={`roll-asset:${type}:${a.id}`}>
            <div className="axf-settings__label">
              <span>{a.name}</span>
              <span className="fx-muted axf-settings__hint fx-mono">{a.id}{overridden ? ' · changed here' : ''}</span>
            </div>
            <div className="axf-settings__control fx-row fx-row--wrap">
              <label className="axf-settings__switch">
                <input type="checkbox" checked={on} disabled={locked} onChange={(e) => rt.setRollAsset(type, a.id, e.target.checked)} aria-label={`Include ${a.name} in rolls`} />
                <span>{on ? 'In rolls' : 'Not in rolls'}</span>
              </label>
              {overridden && <Button tone="ghost" icon="refresh" disabled={locked} onClick={() => rt.setRollAsset(type, a.id, null)}>Default</Button>}
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

function LibrariesPanel() {
  const rt = useRuntime();
  useSettingsRevision(rt);
  if (!rt.libraries.length) return <p className="fx-muted" style={{ margin: 0 }}>No libraries installed.</p>;
  return (
    <ul className="axf-settings__list">
      {rt.libraries.map((l) => (
        <li key={l.id}><strong>{l.label}</strong> <span className="fx-muted">{l.version}</span><br /><span className="fx-mono axf-settings__hint">{l.id}</span></li>
      ))}
    </ul>
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
  const tabs = rt.settings.listTabs();
  const initial = (() => {
    const last = rt.settings.get(TAB_KEY);
    return typeof last === 'string' && tabs.some((t) => t.id === last) ? last : tabs[0]?.id ?? 'appearance';
  })();
  const [tab, setTab] = useState(initial);
  useEffect(() => {
    const onOpen = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) setTab(id); };
    globalThis.addEventListener?.('axf:settings-tab', onOpen);
    return () => globalThis.removeEventListener?.('axf:settings-tab', onOpen);
  }, []);
  const choose = (id: string) => { setTab(id); rt.settings.set(TAB_KEY, id); };
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const groups = current ? rt.settings.groupsIn(current.id) : [];
  const panels = current ? rt.settings.panelsIn(current.id) : [];

  return (
    <div className="fx-stack fx-stack--lg axf-settings">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">{rt.manifest.app.name}</p><h1>Settings</h1></div></header>
      <nav className="axf-settings__tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === current?.id} className={`axf-settings__tab ${t.id === current?.id ? 'is-active' : ''}`} onClick={() => choose(t.id)}>
            <Icon name={t.icon} size={15} /> {t.label}
          </button>
        ))}
      </nav>
      {current?.description && <p className="fx-muted" style={{ margin: 0 }}>{current.description}</p>}
      {/* panels and groups interleaved by `order` (panels first on a tie) */}
      {[...panels.map((p) => ({ order: p.order ?? 100, tie: 0, key: `p:${p.id}`, node: <div data-axf-anchor={`settings-panel:${p.id}`}><Container title={p.title} icon={p.icon ?? current?.icon ?? 'settings'}>{p.render() as ReactNode}</Container></div> })),
        ...groups.map((g) => ({ order: g.order ?? 100, tie: 1, key: `g:${g.id}`, node: <GroupCard group={g} /> }))]
        .sort((a, b) => a.order - b.order || a.tie - b.tie)
        .map((x) => <Fragment key={x.key}>{x.node}</Fragment>)}
      {!panels.length && !groups.length && (
        <p className="fx-muted">{current?.id === 'connections' ? 'Libraries and plugins that talk to servers and services add their connection settings here.' : 'Nothing here yet.'}</p>
      )}
    </div>
  );
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
.axf-settings__tabs{display:flex;gap:var(--fx-space);overflow-x:auto;padding-bottom:calc(var(--fx-space)/2);scrollbar-width:none;-webkit-overflow-scrolling:touch}
.axf-settings__tab{display:inline-flex;align-items:center;gap:calc(var(--fx-space)*.75);white-space:nowrap;padding:var(--fx-space) calc(var(--fx-space)*1.5);border-radius:var(--fx-radius-md);border:var(--fx-border-w) solid var(--fx-border);background:var(--fx-surface);color:var(--fx-muted);font:inherit;cursor:pointer;transition:background var(--fx-motion),color var(--fx-motion)}
.axf-settings__tab:hover{color:var(--fx-text)}
.axf-settings__tab.is-active{background:var(--fx-accent);color:var(--fx-accent-text);border-color:transparent}
.axf-settings__rows{display:flex;flex-direction:column;gap:calc(var(--fx-space)*1.5)}
.axf-settings__row{display:flex;gap:calc(var(--fx-space)*1.5);align-items:center;justify-content:space-between;flex-wrap:wrap}
.axf-settings__row--wide{flex-direction:column;align-items:stretch}
.axf-settings__label{display:flex;flex-direction:column;gap:calc(var(--fx-space)*.25);min-width:180px;flex:1}
.axf-settings__control{flex:0 1 260px;min-width:160px}
.axf-settings__control select,.axf-settings__control input:not([type=checkbox]):not([type=color]){width:100%}
.axf-settings__field{font:inherit;padding:calc(var(--fx-space)*.75) var(--fx-space);border-radius:var(--fx-radius-sm);border:var(--fx-border-w) solid var(--fx-border);background:var(--fx-surface2);color:var(--fx-text)}
.axf-settings__field:focus-visible{outline:2px solid var(--fx-accent);outline-offset:1px}
.axf-settings__field:disabled{opacity:var(--fx-opacity-disabled)}
.axf-settings input[type=checkbox]{accent-color:var(--fx-accent)}
.axf-settings__hint{font-size:.85em;color:var(--fx-muted)}
.axf-settings__switch{display:inline-flex;gap:var(--fx-space);align-items:center;cursor:pointer}
.axf-settings__multi{display:flex;flex-direction:column;gap:calc(var(--fx-space)/2)}
.axf-settings__section{margin:var(--fx-space) 0 0;font-size:.95em}
.axf-settings__list{margin:0;padding-left:calc(var(--fx-space)*2.25);display:flex;flex-direction:column;gap:var(--fx-space)}
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
    description: 'Pick the active asset for each slot.',
    settings: ASSET_TYPES.filter((t) => rt.registry.list(t).length > 0).map((t) => ({
      key: `axf.slot.${t}`,
      label: assetTypeSpecs[t].label,
      kind: 'asset_slot' as const,
      target: t,
      requires: t === 'uac-policy' ? 'uac.manage' : 'assets.swap',
      ...(t === 'uac-policy' ? { description: 'Changing the policy may change your role.' } : {}),
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
    rt.settings.addGroup(appearanceGroup(rt));
    rt.settings.addGroup(rollGroup());
    applyDisplay(rt);
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
  views: { [VIEW]: { title: 'Settings', icon: 'settings', render: () => <SettingsView /> } },
  settingsTabs: Object.values(SETTINGS_TABS),
  settings: [
    {
      id: 'axf.display',
      label: 'Display',
      icon: 'monitor',
      tab: 'appearance',
      order: 20,
      settings: [
        { key: 'axf.display.fontScale', label: 'Text size', kind: 'slider', default: 100, min: 80, max: 140, step: 5, description: 'Percent of the normal size.' },
        { key: 'axf.display.animations', label: 'Animations', kind: 'toggle', default: true, description: 'Off reduces motion.' },
      ],
    },
  ],
  settingsPanels: [
    { id: 'axf.account.role', tab: 'account', title: 'Role', icon: 'shield', order: 10, render: () => <RolePanel /> },
    { id: 'axf.account.profile', tab: 'account', title: 'Access policy', icon: 'user', order: 20, render: () => <AccessPanel /> },
    { id: 'axf.roll.assets', tab: 'appearance', title: 'Assets in rolls', icon: 'shuffle', order: 16, render: () => <RollAssetsPanel /> },
    { id: 'axf.plugins.libraries', tab: 'plugins', title: 'Installed libraries', icon: 'box', order: 50, render: () => <LibrariesPanel /> },
    { id: 'axf.about', tab: 'about', title: 'About', icon: 'info', order: 10, render: () => <AboutPanel /> },
  ],
};

/** Convenience for apps that render the page somewhere other than the `settings` view. */
export function useSettingsTabs(): string[] {
  const rt = useRuntime();
  const rev = useSettingsRevision(rt);
  return useMemo(() => rt.settings.listTabs().map((t) => t.id), [rt, rev]);
}
