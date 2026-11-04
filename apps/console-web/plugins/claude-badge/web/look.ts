/**
 * Claude badge — the pure part of its look (no React): the badge looks (looks.json, badge assets), the animations,
 * the style the console keeps (server style.json) and how one state of the badge becomes badge data (BadgeData's
 * look / tone2 / motion fields, drawn by the framework banner). Tested by ../test.mts.
 */
import LOOKS from '../looks.json';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'muted';
export type AnimState = 'follow' | 'opened' | 'connecting' | 'error';
export interface Animation { motion: string; speed: number; intensity: number; loop: boolean }
export interface Style { look: string; icon: string; tone2: Tone; color2: string; animations: Record<AnimState, Animation> }
export interface LookAsset { $axf: 'asset@1'; type: 'badge'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: Record<string, unknown> & { look: string; shape: 'pill' | 'icon' | 'dot' } }

export const LOOK_ASSETS = LOOKS.looks as unknown as LookAsset[];
export const MOTIONS = LOOKS.motions as { id: string; label: string; description: string }[];
export const ANIM_STATES = LOOKS.states as { id: AnimState; label: string; default: Animation }[];
export const TONES: Tone[] = ['accent', 'success', 'warning', 'danger', 'muted', 'neutral'];
export const TONE_LABEL: Record<Tone, string> = { accent: 'Accent', success: 'Success', warning: 'Warning', danger: 'Danger', muted: 'Muted', neutral: 'Text' };

export const DEFAULT_STYLE: Style = {
  look: 'pill', icon: '', tone2: 'accent', color2: '',
  animations: Object.fromEntries(ANIM_STATES.map((s) => [s.id, { ...s.default }])) as Record<AnimState, Animation>,
};

/** A saved / sent style, missing or bad fields filled from the defaults (never throws). */
export function normalizeStyle(raw: unknown): Style {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Style>;
  const animations = { ...DEFAULT_STYLE.animations };
  for (const s of ANIM_STATES) {
    const a = (r.animations as Record<string, Partial<Animation>> | undefined)?.[s.id];
    if (a && typeof a === 'object') {
      animations[s.id] = {
        motion: MOTIONS.some((m) => m.id === a.motion) ? String(a.motion) : s.default.motion,
        speed: typeof a.speed === 'number' ? a.speed : s.default.speed,
        intensity: typeof a.intensity === 'number' ? a.intensity : s.default.intensity,
        loop: typeof a.loop === 'boolean' ? a.loop : s.default.loop,
      };
    }
  }
  return {
    look: LOOK_ASSETS.some((l) => l.data.look === r.look) ? String(r.look) : DEFAULT_STYLE.look,
    icon: typeof r.icon === 'string' ? r.icon : '',
    tone2: TONES.includes(r.tone2 as Tone) ? (r.tone2 as Tone) : DEFAULT_STYLE.tone2,
    color2: typeof r.color2 === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(r.color2) ? r.color2 : '',
    animations,
  };
}

export const lookOf = (id: string): LookAsset => LOOK_ASSETS.find((l) => l.data.look === id) ?? LOOK_ASSETS[0]!;

/** What the badge is doing right now, in the order that decides its animation. */
export interface BadgeMoment { tone: Tone; checking: boolean; following: boolean; failed: boolean; pulse: number; stateIcon: string }

/**
 * One moment of the badge as badge data: the look's data, the picked icon (style.icon: icon:<name> | mark:<logo-mark> |
 * anim:<animated-logo> | glyph:<pack>/<glyph>, '' = the look's own or the state's icon), and the two tones + motion:
 * connecting while it checks, Follow Amber's while following, the error one when it failed (if it has a motion),
 * otherwise today's single colour. The pulse (Amber just opened something) plays the "opened" motion once.
 */
export function badgeData(style: Style, m: BadgeMoment): Record<string, unknown> {
  const look = lookOf(style.look);
  const d: Record<string, unknown> = { ...look.data, tone: m.tone };
  const [kind, val] = style.icon.includes(':') ? [style.icon.slice(0, style.icon.indexOf(':')), style.icon.slice(style.icon.indexOf(':') + 1)] : ['', ''];
  if (kind === 'icon' && val) { d.icon = val; delete d.mark; delete d.text; }
  else if ((kind === 'mark' || kind === 'anim' || kind === 'glyph') && val) { d.mark = kind === 'mark' ? val : `${kind}:${val}`; delete d.text; }
  else if (!d.mark && !d.text && look.data.icon === 'sparkles') d.icon = m.stateIcon;
  const which: AnimState | null = m.checking ? 'connecting' : m.following ? 'follow' : m.failed && style.animations.error.motion !== 'none' ? 'error' : null;
  if (which) {
    const a = style.animations[which];
    d.tone2 = style.tone2;
    if (style.color2) d.color2 = style.color2;
    d.motion = a.motion; d.speed = a.speed; d.intensity = a.intensity; d.once = !a.loop;
  }
  const opened = style.animations.opened.motion;
  if (m.pulse > 0 && opened !== 'none') { d.pulse = m.pulse; d.pulseMotion = opened; }
  return d;
}
