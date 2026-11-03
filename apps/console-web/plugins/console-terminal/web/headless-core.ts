/*
 * Headless tabs — the pure parts (no React, no network), shared by the terminal's web files and its self-test
 * (framework/spec/check-headless-tabs.mts): tab tmux names and which headless sessions get a tab. The live meter's
 * display helpers and the context chain's reveal pacing moved to the framework's claude-session library (Nov 3 2026,
 * build gizmo-companion) so AmberX's companion reads the same copy; they are re-exported here unchanged.
 */
export {
  PACE, advance, modelName, money, statusOf, steps,
  type ChainItem, type ChainRule, type Meter, type MeterStatus, type Speed,
} from '../../../src/axf/libs/claude-session/core';

/** The bits of a tab's Open these helpers read. */
export interface OpenLike { kind: string; attach?: string; via?: string }
export interface Headless { name: string; createdAt: number; agent?: string; model?: string; kind?: string; attached?: number }
const HEADLESS_NAME = /^axf-[A-Za-z0-9._-]{1,64}$/;

/** Tabs that can live in a tmux session: shells and Claude Code on the VPS or in the console (not container TTYs). */
export const persistable = (o: OpenLike) => !o.attach && (o.kind === 'console' || o.kind === 'vps' || (o.kind === 'claude' && (o.via ?? 'console') !== 'container'));
/** A fresh tmux name for a tab: axt-<what>-<random>. Pure apart from the random part. */
export function tmuxName(o: OpenLike, rand = Math.random().toString(36).slice(2, 8)): string {
  const what = o.kind === 'claude' ? `claude-${o.via ?? 'console'}` : o.kind;
  return `axt-${what}-${rand}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
}

/** The sessions to open: running, not shown by any live tab, not closed by Brett. Oldest first. Pure. */
export function toOpen(items: Headless[], shown: Set<string>, closedSet: Set<string>): Headless[] {
  return items.filter((h) => HEADLESS_NAME.test(h.name) && !shown.has(h.name) && !closedSet.has(h.name)).sort((a, b) => a.createdAt - b.createdAt);
}
