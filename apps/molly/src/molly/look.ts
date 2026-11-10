import type { AxfRuntime } from '../axf/core';

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
  /** the values offered; must match the choices on the menu row (apps/molly/src/assets/app-menu/molly.json) */
  values: readonly string[];
  read(rt: AxfRuntime): string;
  apply(rt: AxfRuntime, value: string): void;
}

const FLAGSHIP_DAY = 'molly-flagship';
const FLAGSHIP_NIGHT = 'molly-flagship-night';
const OWN = 'own';

const skinOn = (rt: AxfRuntime): string => {
  const s = rt.appLook()?.skin;
  return s?.use && s.id ? s.id : OWN;
};
const slot = (rt: AxfRuntime, type: string): string => String((rt.getState().active as Record<string, string | undefined>)[type] ?? '');
const swap = (rt: AxfRuntime, type: string, id: string) => { if (slot(rt, type) !== id) rt.swap(type as never, id); };
const isNight = (rt: AxfRuntime): boolean => {
  const sk = skinOn(rt);
  if (sk !== OWN) return sk === FLAGSHIP_NIGHT;
  return slot(rt, 'color-theme') === 'molly-flagship-night';
};

export const LOOK_CHOICES: readonly LookChoice[] = [
  {
    key: 'molly.look.skin', label: 'Skin', values: [FLAGSHIP_DAY, FLAGSHIP_NIGHT, OWN],
    read: skinOn,
    apply: (rt, v) => { if (v === OWN) rt.useSkin(false); else rt.useSkin(true, v); },
  },
  {
    key: 'molly.look.mode', label: 'Day / night', values: ['day', 'night'],
    read: (rt) => (isNight(rt) ? 'night' : 'day'),
    apply: (rt, v) => {
      const sk = skinOn(rt);
      // under a flagship skin the mode picks its day or night skin; otherwise the flagship colour theme
      if (sk === FLAGSHIP_DAY || sk === FLAGSHIP_NIGHT) rt.useSkin(true, v === 'night' ? FLAGSHIP_NIGHT : FLAGSHIP_DAY);
      else swap(rt, 'color-theme', v === 'night' ? 'molly-flagship-night' : 'molly-flagship-day');
    },
  },
  {
    key: 'molly.look.density', label: 'Density', values: ['compact', 'standard', 'roomy'],
    read: (rt) => slot(rt, 'density'),
    apply: (rt, v) => swap(rt, 'density', v),
  },
  {
    key: 'molly.look.text', label: 'Text size', values: ['compact', 'molly-flagship', 'reader'],
    read: (rt) => slot(rt, 'typography'),
    apply: (rt, v) => swap(rt, 'typography', v),
  },
  {
    key: 'molly.look.motion', label: 'Motion', values: ['molly-flagship', 'minimal-motion'],
    read: (rt) => slot(rt, 'behavior-theme'),
    apply: (rt, v) => swap(rt, 'behavior-theme', v),
  },
];

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
