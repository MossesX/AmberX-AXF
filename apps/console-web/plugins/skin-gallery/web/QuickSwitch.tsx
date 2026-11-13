/** The banner's quick skin switcher: the skin in force in this app, one-tap Use for another, Undo. */
import { useEffect, useState } from 'react';
import { Button, SelectField, useRuntime } from '@console/axf/react';
import { listSkins, readState, undoLast, useSkinAt, type ScopeView, type SkinRow } from './api';

export function QuickSwitch() {
  const rt = useRuntime();
  const [skins, setSkins] = useState<SkinRow[]>([]);
  const [view, setView] = useState<ScopeView | null>(null);
  useEffect(() => { void Promise.all([listSkins(), readState('app')]).then(([s, v]) => { setSkins(s); setView(v); }, () => undefined); }, []);
  if (!skins.length) return null;
  const pick = (id: string) => { if (id) void useSkinAt(id, 'app').then(setView, () => undefined); };
  return (
    <div className="axp-skin-gallery-quick" role="toolbar" aria-label="Quick skin switcher">
      <SelectField label="Skin" value={view?.inForce.id ?? ''} empty="No skin" options={skins.map((s) => ({ value: s.id, label: s.name }))} onChange={pick} />
      <Button size="sm" tone="quiet" icon="undo" disabled={!view?.canUndo} onClick={() => void undoLast().then(setView, () => undefined)}>Undo</Button>
      <Button size="sm" tone="ghost" icon="palette" onClick={() => rt.navigate('skin-gallery')}>Skins</Button>
    </div>
  );
}
