/**
 * Icon picks (web reference; pure, no DOM). A pick is one string any `icon` field can hold:
 *
 *   "cloud"              a static icon (any name of the built-in set)
 *   "cloud@pulse"        an animated icon: the icon + one of ICON_ANIMS
 *   "cloud@pulse:still"  the same animated icon marked static (drawn without its animation)
 *
 * The Icon component reads picks directly, so every asset field, widget and banner that takes an icon name takes a
 * pick too, with no schema change. ANIMATED_ICONS is the 50-entry catalog the icon picker dialog shows on its
 * Animated tab; the per-icon "static" switches are kept in the setting STILL_ICONS_KEY (ids of ANIMATED_ICONS).
 * Reduced motion always draws icons still. Android twin deferred (PORTING.md).
 */

export const ICON_ANIMS = ['spin', 'pulse', 'bounce', 'blink', 'wobble', 'shake', 'float', 'beat', 'swing', 'flip'] as const;
export type IconAnim = (typeof ICON_ANIMS)[number];

export const ICON_ANIM_LABEL: Record<IconAnim, string> = {
  spin: 'Spin', pulse: 'Pulse', bounce: 'Bounce', blink: 'Blink', wobble: 'Wobble',
  shake: 'Shake', float: 'Float', beat: 'Heartbeat', swing: 'Swing', flip: 'Flip',
};

/** Setting holding the animated-icon ids marked static in the picker (shared by every picker in the app). */
export const STILL_ICONS_KEY = 'axf.icons.still';

export interface IconPick { icon: string; anim: IconAnim | null; still: boolean }
export interface AnimatedIcon { id: string; label: string; icon: string; anim: IconAnim }

const isAnim = (a: string): a is IconAnim => (ICON_ANIMS as readonly string[]).includes(a);

/** Parse a pick. Unknown animations read as static; an empty value is an empty icon. */
export function parseIconPick(v: unknown): IconPick {
  const s = typeof v === 'string' ? v.trim() : '';
  const [icon = '', rest = ''] = s.split('@', 2);
  const [anim = '', flag = ''] = rest.split(':', 2);
  return isAnim(anim) ? { icon, anim, still: flag === 'still' } : { icon, anim: null, still: false };
}

/** Build a pick string. */
export function iconPickValue(icon: string, anim?: IconAnim | null, still = false): string {
  if (!icon) return '';
  if (!anim) return icon;
  return `${icon}@${anim}${still ? ':still' : ''}`;
}

/** The animation an icon pick draws with now (null = still). */
export function iconPickMotion(v: unknown, reducedMotion = false): IconAnim | null {
  const p = parseIconPick(v);
  return p.anim && !p.still && !reducedMotion ? p.anim : null;
}

const A = (icon: string, anim: IconAnim, label: string): AnimatedIcon => ({ id: `${icon}@${anim}`, label, icon, anim });

/** The 50 animated icons of the picker's Animated tab (icon × animation; ids are their animated pick). */
export const ANIMATED_ICONS: readonly AnimatedIcon[] = [
  A('claude', 'spin', 'Claude spinning'), A('claude', 'pulse', 'Claude pulsing'), A('claude', 'beat', 'Claude heartbeat'),
  A('claude', 'wobble', 'Claude wobble'), A('claude', 'flip', 'Claude flip'),
  A('cloud', 'float', 'Cloud floating'), A('cloud', 'pulse', 'Cloud pulsing'), A('cloud', 'bounce', 'Cloud bounce'),
  A('cloud', 'blink', 'Cloud blink'), A('cloud', 'swing', 'Cloud swing'),
  A('refresh', 'spin', 'Refreshing'), A('settings', 'spin', 'Gear turning'), A('shuffle', 'shake', 'Shuffle shake'),
  A('sparkles', 'pulse', 'Sparkles pulsing'), A('sparkles', 'blink', 'Sparkles twinkle'),
  A('zap', 'blink', 'Zap flashing'), A('zap', 'shake', 'Zap jolt'),
  A('bell', 'swing', 'Bell ringing'), A('bell', 'shake', 'Bell buzzing'),
  A('star', 'spin', 'Star spinning'), A('star', 'beat', 'Star heartbeat'),
  A('alert', 'blink', 'Alert flashing'), A('alert', 'shake', 'Alert shake'),
  A('check-circle', 'beat', 'Check heartbeat'), A('check-circle', 'bounce', 'Check bounce'),
  A('x-circle', 'shake', 'Cross shake'), A('x-circle', 'blink', 'Cross flashing'),
  A('shield', 'pulse', 'Shield pulsing'), A('lock', 'wobble', 'Lock wobble'), A('key', 'swing', 'Key swinging'),
  A('rocket', 'float', 'Rocket floating'), A('rocket', 'shake', 'Rocket launch'),
  A('upload', 'bounce', 'Uploading'), A('download', 'bounce', 'Downloading'),
  A('clock', 'spin', 'Clock running'), A('sun', 'spin', 'Sun turning'), A('moon', 'swing', 'Moon rocking'),
  A('mic', 'pulse', 'Mic listening'), A('eye', 'blink', 'Eye blinking'), A('monitor', 'pulse', 'Screen glow'),
  A('smartphone', 'shake', 'Phone vibrating'), A('terminal', 'blink', 'Terminal cursor'), A('code', 'wobble', 'Code wobble'),
  A('hammer', 'swing', 'Hammering'), A('package', 'bounce', 'Package bounce'), A('branch', 'swing', 'Branch swing'),
  A('github', 'flip', 'GitHub flip'), A('chart', 'float', 'Chart rising'), A('layers', 'float', 'Layers floating'),
  A('home', 'beat', 'Home heartbeat'),
];

/** The animated catalog entry for a pick (by icon + animation), if it is one. */
export function animatedIconOf(v: unknown): AnimatedIcon | null {
  const p = parseIconPick(v);
  return p.anim ? ANIMATED_ICONS.find((a) => a.icon === p.icon && a.anim === p.anim) ?? null : null;
}

/** Normalise the stored still list: known animated ids only, no repeats. */
export function stillIcons(v: unknown): string[] {
  const known = new Set(ANIMATED_ICONS.map((a) => a.id));
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))] : [];
}

/** The still list with one animated id switched on (static) or off. */
export function setStill(list: unknown, id: string, still: boolean): string[] {
  const cur = stillIcons(list).filter((x) => x !== id);
  return still && ANIMATED_ICONS.some((a) => a.id === id) ? [...cur, id] : cur;
}

/** The pick for an animated catalog entry, honouring its static switch. */
export function animatedPick(a: AnimatedIcon, still: boolean): string {
  return iconPickValue(a.icon, a.anim, still);
}
