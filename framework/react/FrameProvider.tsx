import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { AssetType, FrameRuntime, MenuItem } from '../core';

const FrameContext = createContext<FrameRuntime | null>(null);

export function useRuntime(): FrameRuntime {
  const rt = useContext(FrameContext);
  if (!rt) throw new Error('Frame hooks must be used inside <FrameProvider>.');
  return rt;
}

/** Subscribes the component to runtime changes and returns the current state. */
export function useFrameState() {
  const rt = useRuntime();
  return useSyncExternalStore(rt.subscribe, rt.getState, rt.getState);
}

/** The currently active asset of a slot — re-renders on hot-swap. */
export function useAsset<K extends AssetType>(type: K) {
  const rt = useRuntime();
  useFrameState();
  return rt.asset(type);
}

export function useGate(requires?: string) {
  const rt = useRuntime();
  useFrameState();
  return rt.gate(requires);
}

/* ---------- keyboard shortcuts ---------- */

function collectShortcuts(items: MenuItem[], out: Map<string, string>) {
  for (const i of items) {
    if (i.shortcut && i.action) out.set(normalizeCombo(i.shortcut), i.action);
    if (i.items) collectShortcuts(i.items, out);
  }
  return out;
}

export function normalizeCombo(s: string) {
  const parts = s.split('+').map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? '';
  const mods = ['ctrl', 'alt', 'shift'].filter((m) => parts.includes(m) || (m === 'ctrl' && parts.includes('cmd')));
  return [...mods, key].join('+');
}

function comboFromEvent(e: KeyboardEvent) {
  let key = e.key.toLowerCase();
  if (e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase();
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : ''].filter(Boolean);
  return [...mods, key].join('+');
}

export function useShortcutMap() {
  const rt = useRuntime();
  useFrameState();
  const map = new Map<string, string>();
  collectShortcuts(rt.asset('app-menu').data.menus.flatMap((m) => m.items), map);
  for (const items of Object.values(rt.asset('context-menu').data.targets)) collectShortcuts(items, map);
  return map;
}

/* ---------- provider ---------- */

export function FrameProvider({ runtime, children }: { runtime: FrameRuntime; children: ReactNode }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);

  // Compile active assets -> CSS on the document root (this is the hot-swap).
  useLayoutEffect(() => {
    runtime.applyTo(document.documentElement);
  }, [runtime, state.active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (runtime.getState().context) return runtime.closeContext();
        if (runtime.getState().dialog) return runtime.closeDialog();
      }
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
      if (typing && !e.ctrlKey && !e.metaKey && !e.altKey) return;
      const map = new Map<string, string>();
      collectShortcuts(runtime.asset('app-menu').data.menus.flatMap((m) => m.items), map);
      for (const items of Object.values(runtime.asset('context-menu').data.targets)) collectShortcuts(items, map);
      const action = map.get(comboFromEvent(e));
      if (action) {
        e.preventDefault();
        runtime.dispatch(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runtime]);

  return <FrameContext.Provider value={runtime}>{children}</FrameContext.Provider>;
}
