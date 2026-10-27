import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { AssetType, AxfRuntime, MenuItem } from '../core';

const AxfContext = createContext<AxfRuntime | null>(null);

export function useRuntime(): AxfRuntime {
  const rt = useContext(AxfContext);
  if (!rt) throw new Error('AmberX AXF hooks must be used inside <AxfProvider>.');
  return rt;
}

/** Subscribes the component to runtime changes and returns the current state. */
export function useAxfState() {
  const rt = useRuntime();
  return useSyncExternalStore(rt.subscribe, rt.getState, rt.getState);
}

/** The currently active asset of a slot — re-renders on hot-swap. */
export function useAsset<K extends AssetType>(type: K) {
  const rt = useRuntime();
  useAxfState();
  return rt.asset(type);
}

export function useGate(requires?: string) {
  const rt = useRuntime();
  useAxfState();
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
  useAxfState();
  const map = new Map<string, string>();
  collectShortcuts(rt.asset('app-menu').data.menus.flatMap((m) => m.items), map);
  for (const items of Object.values(rt.asset('context-menu').data.targets)) collectShortcuts(items, map);
  return map;
}

/* ---------- provider ---------- */

export function AxfProvider({ runtime, children }: { runtime: AxfRuntime; children: ReactNode }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);

  // Compile active assets -> CSS on the document root (this is the hot-swap).
  // Hidden slots change the layout grid too, so they re-apply it.
  const hidden = runtime.hiddenSlots().join(',');
  // The Spacing choice scales the style theme (core/engines/spacing.ts), so it re-applies too.
  const spacing = runtime.spacing();
  useLayoutEffect(() => {
    runtime.applyTo(document.documentElement);
  }, [runtime, state.active, hidden, spacing]);

  // Extra tokens per asset (Settings → Appearance → Assets; core/engines/customize.ts) as one sheet.
  const customSheet = runtime.customSheet();
  useLayoutEffect(() => {
    let el = document.getElementById('axf-custom') as HTMLStyleElement | null;
    if (!customSheet) return void el?.remove();
    if (!el) {
      el = document.createElement('style');
      el.id = 'axf-custom';
      document.head.appendChild(el);
    }
    if (el.textContent !== customSheet) el.textContent = customSheet;
  }, [customSheet]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (runtime.getState().context) return runtime.closeContext();
        if (runtime.getState().dialog && runtime.behavior().windows.closeOnEscape) return runtime.closeDialog(); // behaviour theme
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

  return <AxfContext.Provider value={runtime}>{children}</AxfContext.Provider>;
}
