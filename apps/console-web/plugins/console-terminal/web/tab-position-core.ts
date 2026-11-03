/*
 * Tab position (Nov 3 2026, Brett: "a setting in terminal to put all the tabs on the left side in a stack instead of
 * across the top"). Pure rules, no React, so the test runs them in Node:
 *   - top (the Windows strip, as before) · left / right (a vertical stack) · bottom (a strip under the panes)
 *   - each device keeps its own choice (the browser's settings, keys below); a device that hasn't picked follows the
 *     server default (Settings → Terminal, GET/PUT tab-position, MCP + CLI)
 *   - the stack's width is in steps of the theme's text size (--fx-type-root-md), so it follows the scale
 */
export const TAB_POSITIONS = ['top', 'left', 'right', 'bottom'] as const;
export type TabPosition = (typeof TAB_POSITIONS)[number];
export const TAB_POSITION_LABELS: Record<TabPosition, string> = { top: 'Top', left: 'Left stack', right: 'Right stack', bottom: 'Bottom' };

/** Per-device keys in the app's settings registry (browser storage). */
export const DEVICE_KEYS = { position: 'terminal.tabs.position', width: 'terminal.tabs.width', collapsed: 'terminal.tabs.collapsed' } as const;

/** The stack's width, in text-size steps (--fx-type-root-md). */
export const STACK_WIDTH = { min: 8, max: 32, default: 15 } as const;

export const isPosition = (v: unknown): v is TabPosition => typeof v === 'string' && (TAB_POSITIONS as readonly string[]).includes(v);
export const isStack = (p: TabPosition): p is 'left' | 'right' => p === 'left' || p === 'right';

/** What this device shows: its own pick, else the server default, else the top. */
export function effectivePosition(device: unknown, fallback: unknown): TabPosition {
  if (isPosition(device)) return device;
  return isPosition(fallback) ? fallback : 'top';
}

/** A stored width (any value) as a width in text-size steps, within bounds. */
export function clampWidth(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return STACK_WIDTH.default;
  return Math.round(Math.max(STACK_WIDTH.min, Math.min(n, STACK_WIDTH.max)) * 2) / 2;
}

/** Dragging the stack's edge: the new width after the pointer moved dx pixels, one step = stepPx (a right stack grows to the left). */
export function dragWidth(start: number, dx: number, stepPx: number, side: 'left' | 'right'): number {
  const step = stepPx > 0 ? stepPx : 13;
  return clampWidth(start + (side === 'left' ? dx : -dx) / step);
}

/** Keyboard on the resize handle: arrows widen / narrow by one step (towards the panes = wider). */
export function keyWidth(start: number, key: string, side: 'left' | 'right'): number | null {
  const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
  const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
  if (key === grow) return clampWidth(start + 1);
  if (key === shrink) return clampWidth(start - 1);
  if (key === 'Home') return STACK_WIDTH.min;
  if (key === 'End') return STACK_WIDTH.max;
  return null;
}

/** Initials for an agent's stand-in avatar ("Janitor Joey" → "JJ"). */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}
