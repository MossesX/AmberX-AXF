/**
 * Settings → Plugins → Skins (the settings page keeps its level toolbar above every tab). Each field is the same
 * setting the REST route (GET / POST settings), the MCP commands (settings, set-settings), the CLI
 * (skin-gallery.mjs settings <key> <value>) and voice (skin.setting <key> <value>) read and change.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Segmented, SelectField, Switch } from '@console/axf/react';
import { scopeLabel } from './api';
import { loadSettings, onSettings, saveSettings, settings, type SkinsSettings } from './settings';

const UNDO = [5, 10, 20, 30, 60, 120];

export function SkinsSettingsPanel() {
  const cur = useSyncExternalStore(onSettings, settings, settings);
  const [err, setErr] = useState('');
  useEffect(() => { void loadSettings(); }, []);
  const set = (patch: Partial<SkinsSettings>) => { setErr(''); void saveSettings(patch).catch((e: Error) => setErr(e.message)); };
  const scopes = ['hub', 'app'];
  if (!scopes.includes(cur.defaultScope)) scopes.push(cur.defaultScope);
  return (
    <div className="fx-stack" data-axf-anchor="skin-gallery-settings">
      <Switch label="Show the skin chip on the banner" checked={cur.bannerChip} onChange={(v) => set({ bannerChip: v })} hint="The quick skin switcher: the skin in force on the screen in front, one-tap Use, Back and Undo." />
      <SelectField label="Default scope" value={cur.defaultScope} options={scopes.map((s) => ({ value: s, label: scopeLabel(s) }))} onChange={(v) => set({ defaultScope: v })} hint="Where the banner chip, voice and the gallery switch when no scope is named." />
      <SelectField label="Undo window" value={String(cur.undoSeconds)} options={UNDO.map((n) => ({ value: String(n), label: `${n} seconds` }))} onChange={(v) => set({ undoSeconds: Number(v) })} hint="How long the snackbar offers Undo after a change. Undo on the toolbar stays until the next change." />
      <Segmented label="Preview viewport" value={cur.previewView} onChange={(v) => set({ previewView: v })} options={[{ value: 'desktop', label: 'Desktop and phone', icon: 'monitor' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]} />
      {err && <p role="alert" className="fx-muted">{err}</p>}
    </div>
  );
}
