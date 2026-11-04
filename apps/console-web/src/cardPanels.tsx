/**
 * Card panels from plugins (card@1 view `panel` on a command source). The console's own panels are CONSOLE_READS in
 * views/HomeCards.tsx; a plugin that wants its read drawn by its own component registers it here under
 * `<plugin folder>/<read command>`, from its web library's register(). When the plugin is off or removed nothing is
 * registered, and Home draws the card from the read's data with the engine's views instead (nothing breaks).
 */
import { useSyncExternalStore, type ReactNode } from 'react';

export type CardPanel = () => ReactNode;

const panels = new Map<string, CardPanel>();
const subs = new Set<() => void>();
let rev = 0;

const key = (plugin: string, command: string) => `${plugin}/${command}`;

/** Draw `<plugin>/<command>` cards with `render` (returns the unregister). */
export function registerCardPanel(plugin: string, command: string, render: CardPanel): () => void {
  const k = key(plugin, command);
  panels.set(k, render);
  rev++; subs.forEach((f) => f());
  return () => { if (panels.get(k) === render) { panels.delete(k); rev++; subs.forEach((f) => f()); } };
}

export function cardPanel(plugin = '', command = ''): CardPanel | undefined {
  return panels.get(key(plugin, command));
}

/** Re-render when a plugin registers or drops a panel (plugins can load after Home). */
export function useCardPanels(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => rev);
}
