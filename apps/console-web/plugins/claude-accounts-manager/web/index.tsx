/**
 * Claude accounts manager (Brett, Nov 10 2026): one ordered list of every Claude account on the VPS, subscription and
 * API alike, with what each does, whether it is out of credits and its usage in percent and dollars. Drag to set the
 * order the build orchestrator follows. Adds, on its own and removed with it:
 *   - the page (Builds → Claude accounts manager) and Settings → Plugins → Claude accounts manager
 *   - a collapsible column in every Terminal window (slot terminal.side, hamburger to fold it)
 *   - a banner widget (status asset) whose drop-down picks the account it shows; settings pick what it shows
 *   - a floating overlay window with custom buttons and sub-menus (overlay.tsx)
 *   - a right-click menu on every account row anywhere (target claude-account): rename, move, Claude Code session
 * Actions (console API, MCP console actions, voice): claude-accounts-manager.open | session:<name> | add:<kind>:<name> |
 * add-dialog[:<kind>] | rename:<name> | move:<name>:<to> | overlay[:on|off|toggle] | widget:<name> | column[:on|off].
 */
import { useState } from 'react';
import { Button, Checkbox, Container, IconButton, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { AccountList, AddForm, PickList, RenameForm, Totals } from './ui';
import { OverlayWindow, openSession, osOverlaySupported } from './overlay';
import { CTX, FOLDER, ID, POLL_MS, SHOW_PARTS, VIEW, addAccount, load, move, saveSettings, snapshot, subscribe, useManager, widgetText, type MenuItem, type OverlayButton } from './data';
import './manager.css';

const ASSET_ID = 'claude-accounts-manager';
const COUNTER = 'claude-accounts-manager.widget';
const PICK = 'claude-accounts-manager.pick';
const ADD = 'claude-accounts-manager.add';
const RENAME = 'claude-accounts-manager.rename';

function Page() {
  const rt = useRuntime();
  const { view, error, refresh } = useManager();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugins · Claude accounts manager</p>
          <h1>Claude accounts</h1>
          <p className="fx-muted">Every Claude account on the VPS in the order the orchestrator follows. API keys are entries like any subscription: drag to set the order. Right-click a row to rename it, move it or open Claude Code as that account.</p>
        </div>
        <div className="axp-cam-actions" role="toolbar" aria-label="Claude accounts manager">
          <Button size="sm" tone="ghost" icon="layers" onClick={() => rt.dispatch('claude-accounts-manager.overlay:toggle')}>Overlay</Button>
          <Button size="sm" tone="ghost" icon="refresh" onClick={() => void refresh()}>Refresh</Button>
        </div>
      </header>
      {error && <Note tone="warning">{error}</Note>}
      {view && !view.usage && <Note tone="info">Usage percentages need the Badges plugin (axf.claude-usage@1).</Note>}
      {view && !view.dispatch && <Note tone="warning">The build orchestrator isn't installed: the order can't be saved.</Note>}
      {view && <Totals view={view} />}
      <Container title="Accounts in order" icon="list">{view ? <AccountList view={view} onSession={(n) => openSession(rt, n)} /> : <p className="fx-muted">Loading…</p>}</Container>
      <Container title="Add an account or API key" icon="plus"><AddForm /></Container>
    </div>
  );
}

/** The Terminal's accounts column: folds to a hamburger; same list, same right-click, Claude Code opens in this window. */
function TerminalColumn({ open }: { open?: (o: Record<string, unknown>) => void }) {
  const rt = useRuntime();
  const { view, settings } = useManager();
  if (!settings?.column.on) return null;
  const shown = settings.column.open;
  const toggle = () => void saveSettings({ column: { open: !shown } });
  const session = (name: string) => {
    import('./data').then(({ sessionFor }) => sessionFor(name)).then((r) => { if (open) open(r.open); else rt.dispatch(`terminal.tab:${encodeURIComponent(JSON.stringify(r.open))}`); }, (e: Error) => rt.toast(e.message, 'danger'));
  };
  return (
    <aside className={`axp-cam-col ${shown ? 'is-open' : ''}`} aria-label="Claude accounts">
      <div className="axp-cam-col__head" role="toolbar" aria-label="Claude accounts column">
        <IconButton icon="menu" label={shown ? 'Fold the accounts column' : 'Claude accounts'} aria-expanded={shown} onClick={toggle} />
        {shown && <><span className="axp-cam-col__title">Claude accounts</span><IconButton icon="plus" label="Add an account" onClick={() => rt.openDialog(ADD, {})} /></>}
      </div>
      {shown && <div className="axp-cam-col__body">{view ? <AccountList view={view} compact onSession={session} /> : <p className="fx-muted">Loading…</p>}</div>}
    </aside>
  );
}

/* ---------------- settings ---------------- */

function WidgetPanel() {
  const { view, settings } = useManager();
  if (!settings) return <p className="fx-muted">Loading…</p>;
  const w = settings.widget;
  const row = view?.accounts.find((a) => a.name === (w.account || view.active)) ?? view?.accounts[0];
  return (
    <div className="fx-stack">
      <Switch label="Show the widget on the banner" checked={w.on} onChange={(on) => void saveSettings({ widget: { on } })} />
      <SelectField label="Account it shows" value={w.account} empty="The console's account" onChange={(v) => void saveSettings({ widget: { account: v } })}
        options={(view?.accounts ?? []).map((a) => ({ value: a.name, label: `${a.n ? `${a.n}. ` : ''}${a.display}` }))} />
      <div className="axp-cam-checks" role="group" aria-label="What the widget shows">
        {SHOW_PARTS.map((p) => (
          <Checkbox key={p.value} label={p.label} checked={w.show.includes(p.value)}
            onChange={(on) => void saveSettings({ widget: { show: on ? [...w.show, p.value] : w.show.filter((x) => x !== p.value) } })} />
        ))}
      </div>
      <p className="fx-muted">Preview: <b>{widgetText(row, w.show)}</b>. Tap the widget for the drop-down.</p>
    </div>
  );
}

function ColumnPanel() {
  const { settings } = useManager();
  if (!settings) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <Switch label="Accounts column in the Terminal" text="A column of every Claude account beside the Terminal's panes; the hamburger folds it." checked={settings.column.on} onChange={(on) => void saveSettings({ column: { on } })} />
      <Switch label="Start unfolded" checked={settings.column.open} onChange={(open) => void saveSettings({ column: { open } })} />
    </div>
  );
}

function MenuEditor({ items, onChange }: { items: MenuItem[]; onChange: (m: MenuItem[]) => void }) {
  return (
    <div className="fx-stack">
      {items.map((m, i) => (
        <div key={i} className="axp-cam-edit-row">
          <TextField label="Item" value={m.label} onChange={(label) => onChange(items.map((x, j) => (j === i ? { ...x, label } : x)))} />
          <TextField label="Action" mono value={m.action} onChange={(action) => onChange(items.map((x, j) => (j === i ? { ...x, action } : x)))} placeholder="nav:builds" />
          <IconButton icon="trash" label="Remove item" onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button size="sm" tone="ghost" icon="plus" onClick={() => onChange([...items, { label: 'New item', action: '' }])}>Sub-menu item</Button>
    </div>
  );
}

function OverlayPanel() {
  const rt = useRuntime();
  const { settings } = useManager();
  const [buttons, setButtons] = useState<OverlayButton[] | null>(null);
  if (!settings) return <p className="fx-muted">Loading…</p>;
  const o = settings.overlay;
  const list = buttons ?? o.buttons;
  const edit = (i: number, p: Partial<OverlayButton>) => setButtons(list.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const save = () => saveSettings({ overlay: { buttons: list } }).then(() => { setButtons(null); rt.toast('Overlay buttons saved', 'success'); }, (e: Error) => rt.toast(e.message, 'danger'));
  return (
    <div className="fx-stack">
      <Switch label="Show the overlay window" checked={o.open} onChange={(open) => void saveSettings({ overlay: { open, minimized: false } })} />
      <SelectField label="Overlay scope" value={o.scope} onChange={(v) => void saveSettings({ overlay: { scope: v } })}
        options={[{ value: 'console', label: 'Just the console (in this page)' }, { value: 'os', label: `The whole screen (over every app${osOverlaySupported() ? '' : ': not in this browser'})` }]} />
      <SelectField label="Dock" value={o.dock} onChange={(v) => void saveSettings({ overlay: { dock: v } })}
        options={[{ value: 'free', label: 'Floating' }, { value: 'left', label: 'Left edge' }, { value: 'right', label: 'Right edge' }, { value: 'top', label: 'Top edge' }, { value: 'bottom', label: 'Bottom edge' }]} />
      <Switch label="Size lock" text="No moving or resizing until unlocked." checked={o.locked} onChange={(locked) => void saveSettings({ overlay: { locked } })} />
      <Switch label="Minimized" text="A pill on the main screen; tap it to restore." checked={o.minimized} onChange={(minimized) => void saveSettings({ overlay: { minimized } })} />
      <div className="axp-cam-edit-row">
        <TextField label="Width" value={String(o.w)} onChange={(v) => void saveSettings({ overlay: { w: Number(v) || o.w } })} />
        <TextField label="Height" value={String(o.h)} onChange={(v) => void saveSettings({ overlay: { h: Number(v) || o.h } })} />
        <TextField label="Opacity %" value={String(o.opacity)} onChange={(v) => void saveSettings({ overlay: { opacity: Number(v) || o.opacity } })} />
      </div>
      <h3 className="axp-cam-h">Buttons</h3>
      {list.map((b, i) => (
        <Container key={b.id || i} title={b.label || `Button ${i + 1}`} icon={b.icon}>
          <div className="fx-stack">
            <div className="axp-cam-edit-row">
              <TextField label="Label" value={b.label} onChange={(label) => edit(i, { label })} />
              <TextField label="Icon" value={b.icon} onChange={(icon) => edit(i, { icon })} />
              <TextField label="Action on tap" mono value={b.action} onChange={(action) => edit(i, { action })} placeholder="nav:claude-accounts-manager" hint="Any console action. Empty with a sub-menu = the tap opens the sub-menu." />
            </div>
            <SelectField label="Live list in the sub-menu" value={b.list} onChange={(v) => edit(i, { list: v as OverlayButton['list'] })}
              options={[{ value: '', label: 'None' }, { value: 'session', label: 'Accounts: open Claude Code' }, { value: 'rename', label: 'Accounts: rename' }, { value: 'accounts', label: 'Accounts: show on the banner widget' }]} />
            <MenuEditor items={b.menu} onChange={(menu) => edit(i, { menu })} />
            <div className="axp-cam-actions">
              <Button size="sm" tone="ghost" icon="chevron-up" disabled={i === 0} onClick={() => setButtons(list.map((x, j) => (j === i - 1 ? list[i] ?? x : j === i ? list[i - 1] ?? x : x)))}>Earlier</Button>
              <Button size="sm" tone="danger" icon="trash" onClick={() => setButtons(list.filter((_, j) => j !== i))}>Remove button</Button>
            </div>
          </div>
        </Container>
      ))}
      <div className="axp-cam-actions">
        <Button size="sm" tone="ghost" icon="plus" onClick={() => setButtons([...list, { id: `b${Date.now().toString(36)}`, label: 'New button', icon: 'star', action: '', list: '', menu: [] }])}>Add a button</Button>
        <Button size="sm" tone="primary" icon="save" disabled={!buttons} onClick={() => void save()}>Save buttons</Button>
      </div>
      <p className="fx-muted">The overlay is styled by the theme and style assets like the rest of the console.</p>
    </div>
  );
}

function PricesPanel() {
  const { view, settings } = useManager();
  if (!settings) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <p className="fx-muted">Claude reports a subscription's usage in percent only. Dollars = the plan's monthly price spread over the week, times the weekly percent. API keys use their real spend against their caps.</p>
      <div className="axp-cam-edit-row">
        {Object.entries(settings.prices).map(([k, v]) => <TextField key={k} label={`${k} $/month`} value={String(v)} onChange={(x) => void saveSettings({ prices: { [k]: Number(x) || 0 } })} />)}
      </div>
      <h3 className="axp-cam-h">Per account (overrides the plan)</h3>
      <div className="axp-cam-edit-row">
        {(view?.accounts ?? []).filter((a) => a.kind !== 'api').map((a) => (
          <TextField key={a.name} label={`${a.display} $/month`} value={settings.accountPrices[a.name] != null ? String(settings.accountPrices[a.name]) : ''} placeholder={a.planUsd != null ? String(a.planUsd) : ''}
            onChange={(x) => void saveSettings({ accountPrices: { ...settings.accountPrices, [a.name]: Number(x) || 0 } })} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- banner widget ---------------- */

function paint(rt: AxfRuntime) {
  const { view, settings } = snapshot();
  if (!view || !settings?.widget.on) { rt.setBadge(COUNTER, 0); rt.detachFromBanner(`status:${ASSET_ID}`); return; }
  const r = view.accounts.find((a) => a.name === (settings.widget.account || view.active)) ?? view.accounts[0];
  const label = widgetText(r, settings.widget.show);
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Claude account widget', version: '0.1.0', author: 'Claude accounts manager plugin',
    description: 'One Claude account on the banner: the parts picked in its settings. Tap for the drop-down of every account.', tags: ['claude', 'status'],
    data: { counter: COUNTER, onLabel: label, offLabel: label, onTone: r?.outOfCredits ? 'danger' : r?.kind === 'api' ? 'warning' : 'accent', offTone: 'muted', dot: true, link: PICK },
  }, 'app', ID);
  rt.setBadge(COUNTER, 1);
  rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'left', order: 22, origin: ID });
}

/* ---------------- actions and right-click ---------------- */

function register(rt: AxfRuntime) {
  const fail = (e: Error) => rt.toast(e.message, 'danger');
  const tab = (o: Record<string, unknown>) => rt.dispatch(`terminal.tab:${encodeURIComponent(JSON.stringify(o))}`);
  rt.actions.register('claude-accounts-manager.open', () => rt.dispatch(`nav:${VIEW}`), { label: 'Claude accounts manager' });
  rt.actions.register('claude-accounts-manager.session', ([name = '']) => openSession(rt as never, String(name)), { label: 'Claude Code as an account', params: true });
  rt.actions.register('claude-accounts-manager.add', ([kind = 'subscription', name = '']) => {
    if (!name) { rt.openDialog(ADD, { kind }); return; }
    addAccount(String(name), kind === 'api' ? 'api' : 'subscription').then((r) => { tab(r.open); rt.toast(r.message, 'info'); }, fail);
  }, { label: 'Add a Claude account', params: true });
  rt.actions.register('claude-accounts-manager.add-dialog', ([kind = 'subscription']) => rt.openDialog(ADD, { kind }), { label: 'Add a Claude account…', params: true });
  rt.actions.register('claude-accounts-manager.rename', ([name = '']) => rt.openDialog(RENAME, { name }), { label: 'Rename a Claude account', params: true, searchable: false });
  rt.actions.register('claude-accounts-manager.move', ([name = '', to = '']) => { move(String(name), /^\d+$/.test(String(to)) ? Number(to) : String(to)).then((r) => rt.toast(r.message, 'success'), fail); }, { label: 'Move a Claude account in the order', params: true, searchable: false });
  rt.actions.register('claude-accounts-manager.overlay', ([how = 'toggle']) => {
    const open = how === 'on' ? true : how === 'off' ? false : !snapshot().settings?.overlay.open;
    void saveSettings({ overlay: { open, minimized: false } });
  }, { label: 'Claude accounts overlay', params: true });
  rt.actions.register('claude-accounts-manager.widget', ([name = '']) => void saveSettings({ widget: { account: String(name) } }), { label: 'Banner widget account', params: true, searchable: false });
  rt.actions.register('claude-accounts-manager.column', ([how = 'toggle']) => {
    const cur = snapshot().settings?.column; const on = how === 'on' ? true : how === 'off' ? false : !cur?.on;
    void saveSettings({ column: { on } });
  }, { label: 'Claude accounts column in the Terminal', params: true });
  rt.actions.register('claude-accounts-manager.settings', () => rt.dispatch(`settings.open:${VIEW}`), { label: 'Claude accounts manager settings' });
  // right-click any account row anywhere (data-fx-ctx-target="claude-account")
  rt.contextExtras.set(CTX, (target, payload) => {
    if (target !== CTX || !payload) return [];
    const r = snapshot().view?.accounts.find((a) => a.name === payload);
    return [
      { id: 'cam.session', label: `Claude Code as ${r?.display ?? payload}`, icon: 'sparkles', action: `claude-accounts-manager.session:${payload}` },
      { id: 'cam.rename', label: 'Rename…', icon: 'edit', action: `claude-accounts-manager.rename:${payload}` },
      { id: 'cam.top', label: 'Move to the top', icon: 'chevron-up', action: `claude-accounts-manager.move:${payload}:top` },
      { id: 'cam.up', label: 'Move up', icon: 'chevron-up', action: `claude-accounts-manager.move:${payload}:up` },
      { id: 'cam.down', label: 'Move down', icon: 'chevron-down', action: `claude-accounts-manager.move:${payload}:down` },
      r?.inOrder ? { id: 'cam.out', label: 'Take out of the order', icon: 'minus', action: `claude-accounts-manager.move:${payload}:out` }
        : { id: 'cam.in', label: 'Add to the order', icon: 'plus', action: `claude-accounts-manager.move:${payload}:bottom` },
      { id: 'cam.widget', label: 'Show on the banner widget', icon: 'monitor', action: `claude-accounts-manager.widget:${payload}` },
    ];
  });
  subscribe(() => paint(rt));
  const tick = () => { if (document.visibilityState === 'visible') void load(); };
  tick();
  setInterval(tick, POLL_MS);
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Claude accounts manager',
  version: '0.1.0',
  appMenu,
  register,
  views: { [VIEW]: { title: 'Claude accounts manager', icon: 'key', render: () => <Page /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Claude accounts manager', icon: 'key', view: VIEW }] },
  dialogs: {
    [PICK]: { title: 'Claude accounts', icon: 'key', searchable: false, render: (_p, close) => <PickList close={close} onPick={(n) => void saveSettings({ widget: { account: n } })} /> },
    [ADD]: { title: 'Add a Claude account', icon: 'plus', searchable: false, render: (p, close) => <AddForm kind={p?.kind === 'api' ? 'api' : 'subscription'} onDone={close} /> },
    [RENAME]: { title: 'Rename a Claude account', icon: 'edit', searchable: false, render: (p, close) => <RenameForm name={String(p?.name ?? '')} close={close} /> },
  },
  slots: {
    'terminal.side': [{ id: 'claude-accounts-manager.column', order: 50, render: (p) => <TerminalColumn open={p.open as ((o: Record<string, unknown>) => void) | undefined} /> }],
    'app.frame.cover': [{ id: 'claude-accounts-manager.overlay', order: 80, render: () => <OverlayWindow /> }],
  },
  settingsTabs: [{ id: VIEW, label: 'Claude accounts manager', icon: 'key', order: 14, parent: 'plugins', description: 'The ordered list of every Claude account, the Terminal column, the banner widget, the floating overlay and the plan prices used for dollars.' }],
  settingsPanels: [
    { id: 'claude-accounts-manager.list', tab: VIEW, title: 'Accounts in order', icon: 'list', order: 1, render: () => <ListPanel /> },
    { id: 'claude-accounts-manager.widget', tab: VIEW, title: 'Banner widget', icon: 'monitor', order: 2, render: () => <WidgetPanel /> },
    { id: 'claude-accounts-manager.column', tab: VIEW, title: 'Terminal column', icon: 'terminal', order: 3, render: () => <ColumnPanel /> },
    { id: 'claude-accounts-manager.overlay', tab: VIEW, title: 'Floating overlay', icon: 'layers', order: 4, render: () => <OverlayPanel /> },
    { id: 'claude-accounts-manager.prices', tab: VIEW, title: 'Plan prices (dollars)', icon: 'chart', order: 5, render: () => <PricesPanel /> },
    { id: 'claude-accounts-manager.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

function ListPanel() {
  const rt = useRuntime();
  const { view, error } = useManager();
  if (error) return <Note tone="warning">{error}</Note>;
  return view ? <AccountList view={view} onSession={(n) => openSession(rt, n)} /> : <p className="fx-muted">Loading…</p>;
}
