/**
 * The action toolbar: one-tap Use skin, Back to skin, Restore to Default (tap to confirm, undoable) and Undo, wired to
 * the plugin's REST routes. After each change a snackbar says what happened and offers Undo for the undo window
 * (Settings → Plugins → Skins).
 */
import { useEffect, useState } from 'react';
import { Button } from '@console/axf/react';
import { backAt, restoreAt, scopeLabel, undoLast, useSkinAt, type ScopeView } from './api';
import { settings } from './settings';

const LABEL: Record<string, string> = { use: 'Use skin', 'back-to-skin': 'Back to skin', 'restore-default': 'Restore to Default', undo: 'Undo', scope: 'Scope switch' };

interface Props { scope: string; picked: string; view: ScopeView | null; onDone: (v: ScopeView) => void; snack?: { text: string; seq: number } | null }

export function SkinActions({ scope, picked, view, onDone, snack: outside }: Props) {
  const [busy, setBusy] = useState('');
  const [snack, setSnack] = useState<{ text: string; undo: boolean; seq: number } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (outside) setSnack({ text: outside.text, undo: true, seq: outside.seq }); }, [outside]);
  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(() => setSnack(null), settings().undoSeconds * 1000);
    return () => clearTimeout(t);
  }, [snack]);

  const act = async (name: string, fn: () => Promise<ScopeView>) => {
    setBusy(name); setErr('');
    try {
      const v = await fn();
      onDone(v);
      setSnack({ text: `${LABEL[name]} done for ${scopeLabel(v.scope)}.`, undo: name !== 'undo' && v.canUndo, seq: Date.now() });
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  };
  const same = !!view && picked === view.state.id && view.state.use === 'on';

  return (
    <>
      <div className="axp-skin-gallery__actions" role="toolbar" aria-label="Skin actions">
        <Button tone="primary" icon="check" busy={busy === 'use'} disabled={!scope || !picked || same} data-help="skin-gallery.use" onClick={() => void act('use', () => useSkinAt(picked, scope))}>Use skin</Button>
        <Button tone="neutral" icon="arrow-left" busy={busy === 'back-to-skin'} disabled={!scope || !view?.overridden.length} data-help="skin-gallery.back" onClick={() => void act('back-to-skin', () => backAt(scope))}>Back to skin</Button>
        <Button tone="quiet" icon="refresh" busy={busy === 'restore-default'} disabled={!scope} undoable confirm={`Restore ${scope ? scopeLabel(scope) : ''} to its default look? You can undo it once.`} data-help="skin-gallery.restore" onClick={() => void act('restore-default', () => restoreAt(scope))}>Restore to Default</Button>
        <Button tone="quiet" icon="undo" busy={busy === 'undo'} disabled={!view?.canUndo} title={view?.undo ? `Undo ${LABEL[view.undo.action] ?? view.undo.action} at ${scopeLabel(view.undo.scope)}` : 'Nothing to undo'} data-help="skin-gallery.undo" onClick={() => void act('undo', undoLast)}>Undo</Button>
      </div>
      {err && <p role="alert" className="axp-skin-gallery__msg fx-muted">{err}</p>}
      {snack && (
        <div className="axp-skin-gallery__snack" role="status" aria-live="polite">
          <span>{snack.text}</span>
          {snack.undo && <Button size="sm" tone="ghost" icon="undo" busy={busy === 'undo'} onClick={() => void act('undo', undoLast)}>Undo</Button>}
        </div>
      )}
    </>
  );
}
