/**
 * Which hub screen is open and what to bring forward on it, kept outside React so registered actions (`hub.open`,
 * `hub.focus`, `hub.<screen>`: menus, voice, control@1 console_open) can drive the page from anywhere.
 */
import { useSyncExternalStore } from 'react';

export interface HubFocus { screen: string; row?: string; action?: string; at: number }

let active = '';
let focus: HubFocus | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const activeScreen = (): string => active;
export function setActiveScreen(id: string): void { if (id && id !== active) { active = id; emit(); } }
export const useActiveScreen = (fallback: string): string => useSyncExternalStore(subscribe, () => active || fallback, () => active || fallback);

/** Ask the screen to bring a row (and maybe one of its buttons) forward once it has it. */
export function requestFocus(screen: string, row?: string, action?: string): void { focus = { screen, row, action, at: Date.now() }; setActiveScreen(screen); emit(); }
export const currentFocus = (): HubFocus | null => focus;
export function clearFocus(): void { if (focus) { focus = null; emit(); } }
export const useFocus = (): HubFocus | null => useSyncExternalStore(subscribe, () => focus, () => focus);
