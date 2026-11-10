import type { AxfRuntime } from '../axf/core';
import CHOICES from '../../menus/choices.json';

/**
 * Molly's look choices as settings (flagship skin s8). The Molly menu's Appearance sub-menu shows each one as a
 * menu-item@2 choice row: the current value beside the label, a pick applies at once through `setting.set`. Skin, colour
 * theme, density, text size and motion are asset slots, not settings, so this bridge keeps one settings key per choice
 * in step with the live look both ways:
 *
 *   a write to the key (menu pick, Settings, control@1 `set console.settings`, REST, MCP, CLI, voice) → the look changes
 *   the look changes anywhere else (Settings → Appearance, a skin picked on axHub, another tab) → the key follows
 *
 * The key always reads what is on screen; a pick the app refuses (no permission, appearance locked) snaps back.
 */
export interface LookChoice {
  key: string;
  label: string;
  /** the values offered (menus/choices.json); the menu rows offer the same */
  values: readonly string[];
  read(rt: AxfRuntime): string;
  apply(rt: AxfRuntime, value: string): void;
}

interface ChoiceDef { id: string; key: string; label: string; kind: 'skin' | 'mode' | 'slot'; values: string[]; slot?: string; skins?: Record<string, string>; colors?: Record<string, string> }
const DEFS = (CHOICES as { choices: ChoiceDef[] }).choices;
const OWN = 'own';

const skinOn = (rt: AxfRuntime): string => {
  const s = rt.appLook()?.skin;
  return s?.use && s.id ? s.id : OWN;
};
const slot = (rt: AxfRuntime, type: string): string => String((rt.getState().active as Record<string, string | undefined>)[type] ?? '');
const swap = (rt: AxfRuntime, type: string, id: string) => { if (slot(rt, type) !== id) rt.swap(type as never, id); };

function choice(d: ChoiceDef): LookChoice {
  const base = { key: d.key, label: d.label, values: d.values };
  if (d.kind === 'skin') return { ...base, read: skinOn, apply: (rt, v) => { if (v === OWN) rt.useSkin(false); else rt.useSkin(true, v); } };
  if (d.kind === 'mode') {
    const skins = d.skins ?? {}; const colors = d.colors ?? {};
    const modeOf = (map: Record<string, string>, id: string) => Object.keys(map).find((m) => map[m] === id);
    return {
      ...base,
      read: (rt) => { const sk = skinOn(rt); return (sk !== OWN ? modeOf(skins, sk) : modeOf(colors, slot(rt, 'color-theme'))) ?? d.values[0]!; },
      // under one of the mode's skins the mode picks the other; otherwise the mode's colour theme
      apply: (rt, v) => { if (modeOf(skins, skinOn(rt)) && skins[v]) rt.useSkin(true, skins[v]); else if (colors[v]) swap(rt, 'color-theme', colors[v]!); },
    };
  }
  const type = d.slot ?? '';
  return { ...base, read: (rt) => slot(rt, type), apply: (rt, v) => swap(rt, type, v) };
}

export const LOOK_CHOICES: readonly LookChoice[] = DEFS.map(choice);

/** Keep every look choice's key and the live look in step. Returns a remover. */
export function installLookChoices(rt: AxfRuntime): () => void {
  let syncing = false;
  const follow = () => {
    if (syncing) return;
    syncing = true;
    try {
      for (const c of LOOK_CHOICES) {
        const cur = c.read(rt);
        if (cur && rt.settings.get(c.key) !== cur) rt.settings.set(c.key, cur);
      }
    } finally { syncing = false; }
  };
  const offs = LOOK_CHOICES.map((c) => rt.settings.onChange(c.key, (v) => {
    if (syncing || typeof v !== 'string' || !c.values.includes(v) || v === c.read(rt)) return;
    c.apply(rt, v);
    queueMicrotask(follow); // a refused pick snaps the key back to what is on screen
  }));
  const offState = rt.subscribe(follow);
  follow();
  return () => { offState(); for (const off of offs) off(); };
}
