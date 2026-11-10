import { useState, useSyncExternalStore } from 'react';
import { assetTypeSpecs, type AssetType } from '@console/axf/core';
import { Button, Chip, SelectField, useRuntime } from '@console/axf/react';

/*
 * Settings → Appearance: every UI that has assets, and every asset made for it (Brett, Nov 2026: "Every UI in the
 * Appearance section will allow you to choose from any of the assets that have been made for it."). One row per asset
 * type with more than one asset: pick one, Preview applies it live with Keep / Undo, Reset goes back to the app's
 * default. Options a build shipped through UI Review are here too, picked or not. Everything reads the asset registry,
 * so a new asset or a new asset type joins by itself. Swaps go through `rt.swap`, the same as `swap:<type>:<id>`, which
 * is how REST, MCP, the CLI and voice do it (`console_action`).
 */

const optionTag = (tags: readonly string[] | undefined) => (tags?.includes('ui-choice-picked') ? ' (your pick)' : tags?.includes('ui-choice') ? ' (option, not picked)' : '');

function AssetRow({ type }: { type: AssetType }) {
  const rt = useRuntime();
  const active = useSyncExternalStore((f) => rt.subscribe(f), () => rt.getState().active[type] ?? '');
  const list = rt.registry.list(type);
  const [pick, setPick] = useState('');
  const [undo, setUndo] = useState('');
  const chosen = pick || active;
  const asset = list.find((a) => a.id === chosen);
  const fallback = rt.manifest.defaults?.[type];
  const preview = () => { const was = active; if (rt.swap(type, chosen)) setUndo(was); };
  return (
    <div className="fx-stack">
      <SelectField label={assetTypeSpecs[type].label} value={chosen} options={list.map((a) => ({ value: a.id, label: `${a.name}${optionTag(a.tags)}` }))} onChange={setPick} hint={asset?.description} />
      <div className="fx-row fx-row--wrap">
        {undo
          ? <>
            <Button size="sm" tone="primary" icon="check" onClick={() => setUndo('')}>Keep</Button>
            <Button size="sm" icon="undo" onClick={() => { rt.swap(type, undo); setUndo(''); setPick(''); }}>Undo</Button>
          </>
          : <Button size="sm" tone="primary" icon="eye" disabled={chosen === active} onClick={preview}>Preview</Button>}
        {fallback && <Button size="sm" tone="ghost" icon="refresh" disabled={active === fallback} onClick={() => { rt.swap(type, fallback); setPick(''); setUndo(''); }}>Reset to default</Button>}
        {chosen === active && <Chip>In use</Chip>}
      </div>
    </div>
  );
}

export function AssetPickerPanel() {
  const rt = useRuntime();
  const types = (Object.keys(assetTypeSpecs) as AssetType[]).filter((t) => t !== 'help' && t !== 'uac-policy' && rt.registry.list(t).length > 1);
  return <div className="fx-stack">{types.map((t) => <AssetRow key={t} type={t} />)}</div>;
}
