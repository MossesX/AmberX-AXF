/**
 * Settings → Appearance → axHub style (build app-style-override; Brett, Nov 3 2026: "Put a button in each app's
 * settings to override axHub's style, in design and colors." … "And the hook will reload axHub, and you can also save
 * design back to axHub."). axHub's look is every app's default; two switches let this app keep its own design or
 * colours (engines/app-style.mjs over inherit@1). Off = "Inherited from axHub" with axHub's theme; on = "Overriding
 * axHub" with axHub's value beside this app's. Editing a design or colour pick while inheriting switches the override
 * on by itself (the runtime does it). Reload from axHub, Reset to axHub, Save to axHub (owner only, confirm lists the
 * apps that change, versioned) and Restore previous axHub style are buttons here and actions on the action bus, so
 * they can sit on any toolbar or menu.
 */
import { useState } from 'react';
import { APP_STYLE_APPS, APP_STYLE_PARTS, appsFollowing, type AppStylePart, type AppStyleValue, type AxfRuntime } from '../../core';
import { Button, Checkbox, Chip, Switch, useAxfState, useRuntime } from '../../react';

export const APP_STYLE_PANEL_ID = 'axf.appearance.axhub';
export const APP_STYLE_SAVE_DIALOG = 'axf.appearance.save-to-axhub';
export const APP_STYLE_ACTIONS = {
  reload: 'appearance.axhub.reload',
  reloadReset: 'appearance.axhub.reload-reset',
  reset: 'appearance.axhub.reset',
  override: 'appearance.axhub.override',
  save: 'appearance.axhub.save',
  restore: 'appearance.axhub.restore',
} as const;

/** The action bus entries (toolbars, menus, search, the console's commands all reach them by id). */
export function registerAppStyleActions(rt: AxfRuntime): void {
  rt.actions.register(APP_STYLE_ACTIONS.reload, () => rt.reloadStyleFromHub(), { label: 'Reload the look from axHub (keep this app\'s overrides)' });
  rt.actions.register(APP_STYLE_ACTIONS.reloadReset, () => rt.reloadStyleFromHub({ reset: true }), { label: 'Reload the look from axHub and reset this app\'s overrides' });
  rt.actions.register(APP_STYLE_ACTIONS.reset, () => rt.resetStyleToHub(), { label: 'Reset this app\'s design and colours to axHub' });
  rt.actions.register(APP_STYLE_ACTIONS.override, ([part, on]) => {
    if (part !== 'design' && part !== 'colors') return;
    rt.setStyleOverride(part, on === undefined ? !rt.appStyle()[part] : on === 'on');
  }, { label: 'Override axHub\'s design or colours in this app', params: true });
  // Saving changes every app: the action only opens the confirm dialog; the owner's tap there saves.
  rt.actions.register(APP_STYLE_ACTIONS.save, ([parts]) => rt.openDialog(APP_STYLE_SAVE_DIALOG, parts ? { parts } : undefined), { label: 'Save this app\'s design or colours to axHub…', params: true });
  rt.actions.register(APP_STYLE_ACTIONS.restore, () => rt.restorePreviousHubStyle(), { label: 'Restore the previous axHub style' });
}

const nameOf = (rt: AxfRuntime, v: AppStyleValue, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (v.kind === 'slot') return rt.registry.get(v.name as never, String(value))?.name ?? String(value);
  const n = typeof value === 'object' ? Object.values(value as Record<string, object>).reduce((s, m) => s + Object.keys(m ?? {}).length, 0) : 0;
  return n ? `${n} token change${n === 1 ? '' : 's'}` : 'changed';
};

const VALUE_LABEL: Record<string, string> = {
  'style-theme': 'Style theme', 'color-theme': 'Colour theme', 'design-package': 'Design theme',
  'axf.tokens.style': 'Style tokens', 'axf.tokens.theme': 'Colour tokens', 'axf.tokens.typography': 'Type tokens', 'axf.tokens.density': 'Density tokens', 'axf.tokens.sizing': 'Size tokens',
};

/** The axHub style panel: inherit / override per part, then the reload, reset, save and restore buttons. */
export function AppStylePanel() {
  const rt = useRuntime();
  useAxfState();
  const locked = !rt.can('assets.swap') || rt.lockedByAppearance('assets.swap');
  const view = rt.appStyleView();
  const hub = rt.hasAppearanceSource();
  const [resetAsk, setResetAsk] = useState(false);
  if (view.source) {
    return (
      <div className="axf-settings__rows" data-axf-app-style="source">
        <p className="fx-muted axf-settings__desc">This is axHub: its design and colours are the default look of every app. A change here changes every app that inherits it.</p>
        <div className="axf-settings__row axf-appstyle__actions">
          <Button size="sm" tone="quiet" icon="refresh" disabled={!hub} onClick={() => rt.reloadStyleFromHub()}>Reload from axHub</Button>
          <Button size="sm" tone="quiet" icon="undo" disabled={locked || !hub || view.history === 0} onClick={() => rt.restorePreviousHubStyle()}>Restore previous axHub style</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="axf-settings__rows" data-axf-app-style="app">
      <p className="fx-muted axf-settings__desc">
        {hub ? 'axHub sets the default design and colours of every app. Switch one on to give this app its own.' : 'This app has no axHub connection, so it keeps its own look.'}
      </p>
      {view.parts.map((p) => (
        <div key={p.id} className="axf-appstyle__part" data-overriding={p.overriding ? '1' : '0'}>
          <Switch
            label={`Override axHub ${p.id === 'design' ? 'design' : 'colours'}`}
            checked={p.overriding}
            disabled={locked}
            className="axf-settings__switch"
            hint={p.detail}
            onChange={(on) => rt.setStyleOverride(p.id, on)}
          />
          <div className="axf-appstyle__values">
            {p.values.filter((v) => v.kind === 'slot' || p.overriding || v.axhub !== null).map((v) => (
              <div key={v.name} className="axf-appstyle__value">
                <span className="axf-appstyle__name">{VALUE_LABEL[v.name] ?? v.name}</span>
                {p.overriding ? (
                  <>
                    <Chip tone={v.differs ? 'warning' : undefined}>Overriding axHub</Chip>
                    <span>{nameOf(rt, v, v.own)}</span>
                    <span className="fx-muted axf-settings__hint">axHub: {nameOf(rt, v, v.axhub)}</span>
                  </>
                ) : (
                  <>
                    <Chip>Inherited from axHub</Chip>
                    <span>{nameOf(rt, v, v.axhub)}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="axf-settings__row axf-appstyle__actions">
        <Button size="sm" tone="quiet" icon="refresh" disabled={!hub} onClick={() => rt.reloadStyleFromHub()} title="Re-read axHub's design and colours now; this app's overrides stay">Reload from axHub</Button>
        <Button size="sm" tone="quiet" icon="undo" disabled={locked || !view.parts.some((p) => p.overriding)} onClick={() => {
          if (!resetAsk) { setResetAsk(true); setTimeout(() => setResetAsk(false), 4000); return; }
          setResetAsk(false);
          rt.reloadStyleFromHub({ reset: true });
        }}>{resetAsk ? 'Tap again to reset' : 'Reset to axHub'}</Button>
        <Button size="sm" tone="quiet" icon="upload" disabled={locked || !hub} onClick={() => rt.openDialog(APP_STYLE_SAVE_DIALOG)}>Save to axHub…</Button>
        <Button size="sm" tone="quiet" icon="undo" disabled={locked || !hub || view.history === 0} onClick={() => rt.restorePreviousHubStyle()}>Restore previous axHub style</Button>
      </div>
    </div>
  );
}

/** The hint under the Look panel's style / colour pickers: inherited, or overriding with axHub's value. */
export function useStyleNote(part: AppStylePart): string {
  const rt = useRuntime();
  useAxfState();
  if (!rt.hasAppearanceSource() || rt.isStyleSource()) return '';
  const p = rt.appStyleView().parts.find((x) => x.id === part);
  if (!p) return '';
  if (!p.overriding) return 'Inherited from axHub. Picking one here overrides axHub in this app.';
  const slot = p.values.find((v) => v.kind === 'slot' && v.name !== 'design-package');
  return `Overriding axHub${slot ? ` (axHub: ${nameOf(rt, slot, slot.axhub)})` : ''}.`;
}

/** Save to axHub: pick design, colours or both; see which apps change; the owner's tap saves (and can be undone). */
export function SaveToAxhubDialog({ parts: initial }: { parts?: string }) {
  const rt = useRuntime();
  useAxfState();
  const first = (initial ?? '').split(/[,+ ]+/).filter((p): p is AppStylePart => p === 'design' || p === 'colors');
  const [parts, setParts] = useState<AppStylePart[]>(first.length ? first : ['design', 'colors']);
  const locked = !rt.can('assets.swap') || rt.lockedByAppearance('assets.swap');
  const doc = { settings: Object.fromEntries(APP_STYLE_APPS.map((a) => [`axf.appearance.app.${a.id}`, rt.settings.get(`axf.appearance.app.${a.id}`)])) };
  const apps = appsFollowing(doc, parts);
  const toggle = (p: AppStylePart, on: boolean) => setParts((cur) => (on ? [...new Set([...cur, p])] : cur.filter((x) => x !== p)));
  return (
    <div className="fx-stack axf-settings axf-appstyle__save">
      <p>This app's {parts.map((p) => (p === 'design' ? 'design' : 'colours')).join(' and ') || '…'} become axHub's look: the default of every app that inherits {parts.length > 1 ? 'them' : 'it'}.</p>
      {APP_STYLE_PARTS.map((p) => <Checkbox key={p.id} label={p.id === 'design' ? 'Design (style theme)' : 'Colours (colour theme)'} checked={parts.includes(p.id as AppStylePart)} onChange={(on) => toggle(p.id as AppStylePart, on)} />)}
      <div>
        <p className="fx-eyebrow">These apps change</p>
        {apps.length ? <ul className="axf-settings__list">{apps.map((a) => <li key={a.id}>{a.label}</li>)}</ul> : <p className="fx-muted">None: every app overrides {parts.length > 1 ? 'these parts' : 'this part'}.</p>}
      </div>
      <p className="fx-muted axf-settings__hint">The current axHub style is kept, so Restore previous axHub style takes this back. Only you can save: agents and other sessions can't.</p>
      <div className="axf-appstyle__actions">
        <Button tone="quiet" onClick={() => rt.closeDialog()}>Cancel</Button>
        <Button tone="primary" icon="upload" disabled={locked || !parts.length} onClick={() => { if (rt.saveStyleToHub(parts)) rt.closeDialog(); }}>Save to axHub</Button>
      </div>
    </div>
  );
}

export const APP_STYLE_CSS = `
.axf-appstyle__part{display:flex;flex-direction:column;gap:var(--fx-dens-gap-md);padding:var(--fx-dens-gap-lg) var(--fx-dens-gap-xl);border-radius:var(--fx-radius-md);border:var(--fx-border-w) solid var(--fx-border);background:var(--fx-surface2)}
.axf-appstyle__part[data-overriding='1']{border-color:var(--fx-warning)}
.axf-appstyle__values{display:flex;flex-direction:column;gap:var(--fx-dens-gap-sm)}
.axf-appstyle__value{display:flex;flex-wrap:wrap;align-items:center;gap:var(--fx-dens-gap-md);min-width:0}
.axf-appstyle__name{font-weight:600;min-width:0}
.axf-appstyle__actions{display:flex;flex-wrap:wrap;gap:var(--fx-dens-gap-md);justify-content:flex-start}
.axf-appstyle__save .axf-appstyle__actions{justify-content:flex-end}
`;
