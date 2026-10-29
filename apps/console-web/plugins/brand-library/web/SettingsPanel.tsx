/** Settings → Plugins → Brand library: how the library opens, and the brand it last applied (with a reset). */
import { useEffect, useState } from 'react';
import { Button, Note, Segmented, SelectField, Switch, useRuntime } from '@console/axf/react';
import { loadConfig, saveConfig } from './api';
import { resetBrand } from './apply';
import { DEFAULT_CONFIG, TABS, VIEW, type Config, type TabId, type TileSize } from './model';

export function SettingsPanel() {
  const rt = useRuntime();
  const [c, setC] = useState<Config | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => { loadConfig().then(setC, () => { setOffline(true); setC(DEFAULT_CONFIG); }); }, []);
  if (!c) return <p className="fx-muted">Loading…</p>;

  const save = (patch: Partial<Config>) => { setC({ ...c, ...patch }); void saveConfig(patch).then(setC, () => rt.toast('Could not save the brand library settings.', 'danger', 'Brand library')); };
  const reset = async () => {
    try { setC(await resetBrand(rt)); rt.toast('Back to the app\'s own brand.', 'success', 'Brand library'); }
    catch { rt.toast('Could not reset the brand.', 'danger', 'Brand library'); }
  };

  return (
    <div className="fx-stack">
      {offline && <Note tone="warning">The console server isn't reachable, so these settings are read-only.</Note>}
      <SelectField label="Opens on" value={c.tab} onChange={(v) => save({ tab: v as TabId })} options={TABS.map((t) => ({ value: t.id, label: t.label }))} disabled={offline} />
      <SelectField label="Brand filter" value={c.brand} onChange={(v) => save({ brand: v })} empty="Every brand" options={[{ value: 'AmberX', label: 'AmberX' }, { value: 'GizmoX', label: 'GizmoX' }]} disabled={offline} />
      <div className="fx-field">
        <span className="fx-field__label">Tile size</span>
        <Segmented label="Tile size" value={c.tile} onChange={(v: TileSize) => save({ tile: v })} disabled={offline}
          options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} />
      </div>
      <Switch label="Show names under tiles" checked={c.names} onChange={(v) => save({ names: v })} disabled={offline} />
      <Switch label="Play animations" checked={c.motion} onChange={(v) => save({ motion: v })} disabled={offline} />
      <div className="fx-field">
        <span className="fx-field__label">Applied brand</span>
        <p className="fx-muted" style={{ margin: 0 }}>{c.applied ? <>{c.applied.asset?.name ?? c.applied.id} <span className="fx-mono">({c.applied.id})</span></> : 'None — the app shows its own branding package.'}</p>
      </div>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="star" onClick={() => rt.navigate(VIEW)}>Open the brand library</Button>
        <Button tone="danger" icon="undo" disabled={!c.applied || offline} confirm="Go back to the app's own brand?" undoable onClick={() => void reset()}>Reset the brand</Button>
      </div>
    </div>
  );
}
