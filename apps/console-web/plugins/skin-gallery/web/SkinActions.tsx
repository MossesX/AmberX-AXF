/**
 * The action toolbar: one-tap Use skin, Back to skin, Restore to Default (asks first, undoable) and Undo, wired to
 * the plugin's REST routes. Drawn by the shared framework toolbar (page-toolbar@1, assets/toolbar/skin-gallery.json). After each change a snackbar says what happened and offers Undo for the undo window
 * (Settings → Plugins → Skins).
 */
import { useEffect, useState } from 'react';
import { Button, PageToolbar, usePublishPageState, useToolbarHandlers } from '@console/axf/react';
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
  const idle = !busy;
  usePublishPageState('skin-gallery', { scope: idle && !!scope, canUse: idle && !!scope && !!picked && !same, overridden: idle && !!scope && !!view?.overridden.length, canUndo: idle && !!view?.canUndo });
  useToolbarHandlers('skin-gallery', {
    'skin-gallery.use': () => act('use', () => useSkinAt(picked, scope)),
    'skin-gallery.back': () => act('back-to-skin', () => backAt(scope)),
    'skin-gallery.restore': () => act('restore-default', () => restoreAt(scope)),
    'skin-gallery.undo': () => act('undo', undoLast),
  });

  return (
    <>
      <PageToolbar view="skin-gallery" className="axp-skin-gallery__actions" />
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
