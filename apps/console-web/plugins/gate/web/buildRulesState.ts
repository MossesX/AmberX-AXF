/**
 * Which build rule the Build rules tab shows, and how (its History panel or the edit dialog): set by deep links and
 * console actions (gate.build-rules.open:<id>, console_show build-rule:<id>) before or after the tab mounts.
 */
export type BuildRulePanel = 'history' | 'edit';
type Want = { id: string; panel: BuildRulePanel };
type Listener = (w: Want) => void;
const listeners = new Set<Listener>();
let wanted: Want | null = null;

export function showBuildRule(id: string, panel: BuildRulePanel = 'history'): void { wanted = { id, panel }; for (const l of listeners) l(wanted); }
export function takeWantedRule(): Want | null { const w = wanted; wanted = null; return w; }
export function onShowBuildRule(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
