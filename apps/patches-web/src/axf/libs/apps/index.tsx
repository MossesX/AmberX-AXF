/**
 * lib-apps — the framework's app directory and an app picker (library@1 `ai.amberx.axf.apps`). Harvested Oct 23 2026
 * from Patches (its fixed Console · Pilot · axHub tabs) and the console's App tabs plugin (its built-in app list).
 *
 * - `directoryApps()` / `availableApps()`: every framework web app with a home on the web (app-directory@1), plus apps a
 *   person adds by hand (https only);
 * - `pickedApps`, `toggleApp`, `moveApp`: the rules every picker follows;
 * - `<AppPicker>`: switch an app on or off, move it up or down, add your own; framework controls only, so it takes the
 *   app's look.
 * Parts (installed config `libraries.apps.parts`): custom (add your own apps), reorder (move apps up and down).
 */
import { useState } from 'react';
import { Button, IconButton, Icon, Note, SelectField, Switch, TextField } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import { partOn, type LibraryPart } from '../../core/library';
import { customEntry, decodeCustomApp, toggleApp, moveApp, type AppEntry, type AppEmbed, type CustomApp } from './apps';
import spec from './library.json';
import './apps.css';

export * from './apps';

export const APPS_LIBRARY_ID = 'ai.amberx.axf.apps';
const PARTS = (spec as { parts: LibraryPart[] }).parts;
export interface AppsConfig { custom: boolean; reorder: boolean }
let config: AppsConfig = { custom: true, reorder: true };
export function configureApps(installed: { parts?: Record<string, unknown> } | null | undefined): AppsConfig {
  config = { custom: partOn(installed, 'custom', PARTS), reorder: partOn(installed, 'reorder', PARTS) };
  return config;
}
export const appsConfig = () => config;

export interface AppPickerProps {
  /** every app that can be picked (usually `availableApps(custom, here)`) */
  apps: readonly AppEntry[];
  /** picked tab ids, in order */
  picked: readonly string[];
  onPicked: (next: string[]) => void;
  /** the custom apps as saved (encodeCustomApp strings, or objects); leave out (with onCustom) to hide "Add your own" */
  custom?: readonly unknown[];
  onCustom?: (next: CustomApp[]) => void;
  /** tab ids that can't be switched off (with why) */
  locked?: Readonly<Record<string, string>>;
  /** what "picked" means here, e.g. "Shown as a tab" */
  pickLabel?: string;
}

/** Pick apps, order them, add your own. Picked apps first (in order), then the rest. */
export function AppPicker({ apps, picked, onPicked, custom, onCustom, locked = {}, pickLabel = 'Shown' }: AppPickerProps) {
  const cfg = appsConfig();
  const on = picked.filter((t) => apps.some((a) => a.tab === t));
  const rows = [...on.map((t) => apps.find((a) => a.tab === t)!), ...apps.filter((a) => !on.includes(a.tab))];
  return (
    <div className="axf-apps">
      <ul className="axf-apps__list">
        {rows.map((a) => {
          const isOn = on.includes(a.tab);
          const lock = locked[a.tab];
          const i = on.indexOf(a.tab);
          return (
            <li key={a.tab} className={`axf-apps__row ${isOn ? 'is-on' : ''}`} data-axf-app={a.tab}>
              <Icon name={a.icon} size={16} />
              <div className="axf-apps__text">
                <div className="axf-apps__name">{a.label}{a.label !== a.name && <span className="axf-apps__sub"> · {a.name}</span>}</div>
                <div className="axf-apps__meta">{a.origin.replace(/^https?:\/\//, '')}{a.path !== '/' ? a.path : ''}{a.from === 'custom' ? ' · added by you' : ''}{a.embed === 'none' ? ' · not an AXF app' : ''}</div>
              </div>
              {cfg.reorder && isOn && (
                <span className="axf-apps__move">
                  <IconButton icon="chevron-up" label={`Move ${a.label} up`} disabled={i <= 0} onClick={() => onPicked(moveApp(on, a.tab, -1))} />
                  <IconButton icon="chevron-down" label={`Move ${a.label} down`} disabled={i >= on.length - 1} onClick={() => onPicked(moveApp(on, a.tab, 1))} />
                </span>
              )}
              {a.from === 'custom' && onCustom && custom && (
                <IconButton icon="trash" label={`Remove ${a.label}`} onClick={() => { onCustom(custom.map(decodeCustomApp).filter((c): c is CustomApp => !!c && customTab(c) !== a.tab)); onPicked(toggleApp(on, a.tab, false)); }} />
              )}
              <Switch label={`${pickLabel}: ${a.label}`} hideLabel checked={isOn} disabled={!!lock} title={lock} onChange={(v) => onPicked(toggleApp(on, a.tab, v))} />
            </li>
          );
        })}
      </ul>
      {cfg.custom && custom && onCustom && <AddApp taken={new Set(apps.map((a) => a.tab))} onAdd={(c) => { onCustom([...custom.map(decodeCustomApp).filter((x): x is CustomApp => !!x), c]); onPicked(toggleApp(on, customTab(c), true)); }} />}
    </div>
  );
}

const customTab = (c: CustomApp) => { const e = customEntry(c); return 'error' in e ? c.tab : e.tab; };

function AddApp({ taken, onAdd }: { taken: ReadonlySet<string>; onAdd: (c: CustomApp) => void }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [embed, setEmbed] = useState<AppEmbed>('none');
  const [err, setErr] = useState('');
  const add = () => {
    const c: CustomApp = { tab: '', label, url, embed };
    const e = customEntry(c, taken);
    if ('error' in e) { setErr(e.error); return; }
    onAdd({ ...c, tab: e.tab });
    setLabel(''); setUrl(''); setEmbed('none'); setErr('');
  };
  return (
    <div className="axf-apps__add">
      <div className="axf-apps__add-fields">
        <TextField label="Name" value={label} onChange={setLabel} placeholder="My app" />
        <TextField label="Address" value={url} onChange={setUrl} placeholder="https://app.example.com" mono />
        <SelectField label="Kind" value={embed} onChange={(v) => setEmbed(v as AppEmbed)} options={[{ value: 'none', label: 'Any website' }, { value: 'axf', label: 'An AXF app' }]} />
      </div>
      {err && <Note tone="warning">{err}</Note>}
      <Button size="sm" icon="plus" onClick={add} disabled={!label.trim() || !url.trim()}>Add app</Button>
    </div>
  );
}

export const library: AxfWebLibrary = {
  id: APPS_LIBRARY_ID,
  label: 'App directory',
  version: '0.1.0',
  provides: ['axf.apps'],
  register(rt) { configureApps((rt.manifest as { libraries?: Record<string, { parts?: Record<string, unknown> }> }).libraries?.apps); },
};
