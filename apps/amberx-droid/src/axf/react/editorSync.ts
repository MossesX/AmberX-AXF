/*
 * UI-editor sync (Brett's rule, Oct 18 2026).
 *
 * Theme, style, layout, manager and builder plugins/libraries edit the same saved values (hot-swap choices,
 * settings, tokens). Two rules keep them honest:
 *   1. Last save wins. Saves are per key (`SettingsRegistry.set` merges into what storage holds now), so a save
 *      never reverts keys it didn't touch, and when two editors save the same key the later one stands.
 *   2. Fresh on focus. Whenever an editor opens, loads or comes back into focus (window focus, tab visible again,
 *      another tab saved), it reloads the current values with `rt.refreshFromSaved()` before showing them.
 *
 * Use it in every UI-editing view:  useEditorSync({ onRefresh: () => setDraft(readFromSettings()) })
 * Android: `AxfRuntime.refreshFromSaved()` (call it from the editor's ON_RESUME / first composition).
 */
import { useEffect, useRef } from 'react';
import { useRuntime } from './AxfProvider';

export interface EditorSyncOptions {
  /** Called after every refresh (also when nothing changed), so the editor re-reads its values. */
  onRefresh?: (changed: { slots: string[]; settings: string[]; role: boolean }) => void;
  /** Set false to pause (e.g. while a modal save is in flight). Default true. */
  enabled?: boolean;
}

export function useEditorSync(opts: EditorSyncOptions = {}): () => void {
  const rt = useRuntime();
  const cb = useRef(opts.onRefresh);
  cb.current = opts.onRefresh;
  const refresh = useRef<() => void>(() => undefined);
  refresh.current = () => {
    const changed = rt.refreshFromSaved();
    cb.current?.(changed);
  };
  const enabled = opts.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    const run = () => refresh.current();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    run(); // opened / loaded
    globalThis.addEventListener('focus', run);
    globalThis.addEventListener('storage', run); // another tab or window saved
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      globalThis.removeEventListener('focus', run);
      globalThis.removeEventListener('storage', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
  return () => refresh.current();
}
