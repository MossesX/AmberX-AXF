/**
 * Banner widgets: the one table of every widget this plugin draws on the banner. Pure (no React, no runtime), so the tests
 * run it directly.
 *
 * Two kinds of row:
 *  - `own`: the five status badges whose readings this plugin takes itself (Claude, VPS, axHub, AmberX, usage; model.ts);
 *  - `supplied`: widgets whose numbers another plugin hands over through the banner data service (axf.banner-data@1,
 *    @console/bannerData). This plugin builds the asset, decides whether it is on the banner and where, and owns its
 *    settings; the other plugin only supplies data.
 *
 * Every row keeps the asset type and id it had before the move, so saved positions, sizes and hides (keyed `type:id`)
 * carry over untouched. Every setting key it had is kept too (`show`, `when`, `side`), with its old name. `aliases` keeps
 * the old owners' plugin ids and folder words, so API and voice calls that used them still find the widget.
 */
import { BADGES, KINDS, type BadgeKind } from './model';

export type WidgetType = 'status' | 'counter' | 'badge' | 'action-button';
export type Side = 'left' | 'right';

export interface WidgetHint {
  label: string;
  icon?: string;
  size?: 'icon' | 'compact' | 'normal' | 'wide';
  priority?: number;
  overflow?: boolean;
  aliases: string[];
}

export interface WidgetDef {
  /** stable widget id (the banner data id for supplied rows) */
  id: string;
  type: WidgetType;
  /** the asset id drawn (unchanged from before the move) */
  asset: string;
  source: 'own' | 'supplied';
  /** short words for the settings screen */
  title: string;
  about: string;
  at: Side;
  order: number;
  hint: WidgetHint;
  /** a boolean setting: false = off the banner (kept from the plugin that used to own it) */
  showKey?: string;
  /** a choice setting: `always` | its lit word (on while its counter is above zero) | its off word */
  when?: { key: string; default: string; lit: string; off: string; options: { value: string; label: string }[] };
  /** a choice setting for the side (left | right) */
  sideKey?: string;
  /** the plugin that used to own the widget (an alias; the console no longer needs it) */
  formerly?: string;
  /** what the settings screen says when nothing is supplied */
  idle?: string;
}

const P = 'ai.amberx.axf.console.';
const supplied = (d: Omit<WidgetDef, 'source'>): WidgetDef => ({ ...d, source: 'supplied' });

/** Every supplied widget, in banner order. */
export const SUPPLIED: WidgetDef[] = [
  supplied({ id: 'project', type: 'status', asset: 'project', title: 'Project', about: 'The project the console works on. Tap to switch.', at: 'left', order: 19,
    hint: { label: 'Project', size: 'compact', priority: 7, aliases: ['project', 'workspace', 'project switcher', 'projects'] }, showKey: 'projects.show', formerly: `${P}project-switcher`, idle: 'Waiting for the project list.' }),
  supplied({ id: 'build-profile', type: 'status', asset: 'build-profile', title: 'Build profile', about: 'The build profile the console works on. Tap to switch.', at: 'left', order: 20,
    hint: { label: 'Build profile', size: 'compact', priority: 6, aliases: ['profile', 'build profiles'] }, showKey: 'build-profiles.show', formerly: `${P}build-profiles`, idle: 'Waiting for the build profiles.' }),
  supplied({ id: 'claude-account', type: 'status', asset: 'claude-account', title: 'Claude account', about: 'The Claude account on the VPS. Tap to pick it.', at: 'left', order: 21,
    hint: { label: 'Claude account', size: 'compact', priority: 5, aliases: ['claude account', 'account', 'claude accounts'] }, showKey: 'banner-widgets.claude-account.show', formerly: `${P}claude-accounts`, idle: 'Shows once an account is active.' }),
  supplied({ id: 'follow-amber', type: 'status', asset: 'follow-amber', title: 'Following Amber', about: 'On while Follow Amber is on. Tap to turn it off.', at: 'left', order: 22, // axf-not-plugin:follow-amber (the asset id it has always had)
    hint: { label: 'Following Amber', size: 'compact', priority: 4, aliases: ['follow amber', 'following'] }, showKey: 'follow-amber.chip', formerly: `${P}follow-amber`, idle: 'Shows while Follow Amber is on.' }),
  supplied({ id: 'shipped', type: 'status', asset: 'shipped', title: "What's new ticker", about: 'The newest features merged to main, with the unread count.', at: 'right', order: 22,
    hint: { label: "What's new ticker", icon: 'sparkles', size: 'compact', priority: 2, aliases: ['ticker', 'whats new', 'new changes', 'whats shipped'] }, showKey: 'whats-shipped.show', formerly: `${P}whats-shipped`, idle: 'Waiting for the feed.' }),
  supplied({ id: 'agent-voice', type: 'status', asset: 'agent-voice', title: 'Agent voice', about: 'Lit while the selected agent is a voice agent.', at: 'right', order: 22, // axf-not-plugin:agent-voice (the asset id it has always had)
    hint: { label: 'Agent voice', size: 'compact', priority: 4, aliases: ['voice', 'voice light'] }, formerly: `${P}agent-voice`, idle: 'Shows once a voice agent is set up.',
    when: { key: 'agent-voice.banner', default: 'lit', lit: 'lit', off: 'off', options: [{ value: 'lit', label: 'Only while a voice agent is selected' }, { value: 'always', label: 'Always (grey when off)' }, { value: 'off', label: 'Never' }] } }),
  supplied({ id: 'wake-listener', type: 'status', asset: 'wake-listener', title: 'Wake listener', about: 'The mic-on light. When it shows is the listener\'s own setting (Mic light on the banner).', at: 'right', order: 23, // axf-not-plugin:wake-listener (the asset id it has always had)
    hint: { label: 'Wake listener', size: 'compact', priority: 4, aliases: ['mic', 'listener', 'mic light'] }, showKey: 'banner-widgets.wake-listener.show', formerly: `${P}wake-listener`, idle: 'Shows as the listener\'s Mic light setting says.' }),
  supplied({ id: 'builds-progress', type: 'counter', asset: 'builds-progress', title: 'Builds progress', about: 'The active build profile\'s progress in percent.', at: 'right', order: 24,
    hint: { label: '% building', icon: 'hammer', size: 'compact', priority: 3, aliases: ['building', 'builds', 'build progress'] }, showKey: 'builds.banner', formerly: `${P}builds-page`, idle: 'Shows once the progress is read.' }),
  supplied({ id: 'main-build', type: 'status', asset: 'main-build', title: 'Main build status', about: 'The last CI result of the watched branch.', at: 'right', order: 25,
    hint: { label: 'Main build status', size: 'compact', priority: 4, aliases: ['main build', 'ci', 'build status'] }, showKey: 'main-build-status.show', formerly: `${P}main-build-status`, idle: 'Waiting for the first CI read.' }),
  supplied({ id: 'alerts-bell', type: 'action-button', asset: 'alerts-bell', title: 'Alerts bell', about: 'Opens the developer alerts.', at: 'right', order: 30, // axf-not-plugin:alerts-bell (the asset id it has always had)
    hint: { label: 'Alerts bell', icon: 'bell', priority: 9, overflow: false, aliases: ['bell', 'alerts'] }, showKey: 'alerts-bell.show', sideKey: 'alerts-bell.side', formerly: `${P}alerts-bell` }),
  supplied({ id: 'alerts-count', type: 'counter', asset: 'alerts-bell', title: 'Alerts count', about: 'Unread developer alerts, next to the bell; hidden at zero.', at: 'right', order: 31, // axf-not-plugin:alerts-bell (the asset id it has always had)
    hint: { label: 'Alerts count', icon: 'bell', priority: 9, aliases: ['alert count', 'unread alerts'] }, showKey: 'alerts-bell.show', sideKey: 'alerts-bell.side', formerly: `${P}alerts-bell` }),
  supplied({ id: 'plan-capture', type: 'action-button', asset: 'plan-studio-capture', title: '+ Plan', about: 'Quick capture: a new plan in two taps.', at: 'right', order: 31,
    hint: { label: 'Plan', icon: 'map', size: 'compact', priority: 3, aliases: ['plan studio', 'new plan', 'plan'] }, showKey: 'plan-studio.banner', formerly: `${P}plan-studio` }),
];

/** The five badges this plugin reads itself, as rows of the same table (their settings live in model.ts). */
export const OWN: WidgetDef[] = KINDS.map((k: BadgeKind) => {
  const d = BADGES[k];
  return { id: d.id, type: 'badge', asset: d.id, source: 'own', title: d.title, about: d.about, at: d.side, order: d.order,
    hint: { label: d.title, priority: 8, aliases: [...d.aliases, `${P}claude-badge`, 'badges'], ...(k === 'usage' ? { size: 'wide' as const } : {}) },
    showKey: `claude-badge.${k}.show`, formerly: `${P}claude-badge` };
});

export const WIDGETS: WidgetDef[] = [...OWN, ...SUPPLIED];

/** The framework's widget key (`type:id`): what saved positions, sizes and hides are keyed by. */
export const widgetKey = (w: Pick<WidgetDef, 'type' | 'asset'>) => `${w.type}:${w.asset}`;

/** Find a widget by its id, key, asset, a former owner's id or folder, a title or an alias. */
export function findWidget(query: string, list: readonly WidgetDef[] = WIDGETS): WidgetDef | null {
  const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = norm(query);
  if (!q) return null;
  const words = (w: WidgetDef) => [w.id, widgetKey(w), w.asset, w.title, w.hint.label, ...w.hint.aliases, ...(w.formerly ? [w.formerly, w.formerly.slice(P.length)] : [])];
  return list.find((w) => words(w).some((x) => x === query || norm(x) === q))
    ?? list.find((w) => words(w).some((x) => norm(x).includes(q)))
    ?? null;
}

export type Read = (key: string) => unknown;

/** Is the widget switched on in its own setting? (Missing or unreadable = on.) */
export function switchedOn(read: Read, w: WidgetDef): boolean {
  if (w.showKey && read(w.showKey) === false) return false;
  if (w.when && read(w.when.key) === w.when.off) return false;
  return true;
}

/**
 * Should a supplied widget be on the banner right now? Its switch, then its `when` choice against its counter.
 * `count` reads a runtime counter (rt.badge).
 */
export function wanted(read: Read, w: WidgetDef, data: Record<string, unknown> | null, count: (name: string) => number): boolean {
  if (!data || !switchedOn(read, w)) return false;
  if (!w.when) return true;
  const v = read(w.when.key);
  const mode = typeof v === 'string' && w.when.options.some((o) => o.value === v) ? v : w.when.default;
  if (mode === 'always') return true;
  const c = typeof data.counter === 'string' ? count(data.counter) : 0;
  return c > 0;
}

/** The side a widget sits on: its side setting, else its default. */
export function sideOf(read: Read, w: WidgetDef): Side {
  const v = w.sideKey ? read(w.sideKey) : undefined;
  return v === 'left' || v === 'right' ? v : w.at;
}

/** Asset types whose data carries an icon the person may swap. */
export const ICON_TYPES: readonly WidgetType[] = ['counter', 'action-button'];
/** A supplied widget's icon setting (empty = the supplier's own icon). */
export const iconKeyOf = (w: Pick<WidgetDef, 'id'>) => `banner-widgets.${w.id}.icon`;

/** A supplied widget's icon choice, if valid. */
export function iconChoice(read: Read, w: WidgetDef, allowed: readonly string[]): string | null {
  if (!ICON_TYPES.includes(w.type)) return null;
  const v = read(iconKeyOf(w));
  return typeof v === 'string' && allowed.includes(v) ? v : null;
}

/** The asset this plugin registers for a supplied widget: the supplier's data, this plugin's envelope and icon choice. */
export function suppliedAsset(w: WidgetDef, s: { data: Record<string, unknown>; name?: string; description?: string; tags?: string[] }, icon: string | null) {
  return {
    $axf: 'asset@1', type: w.type, id: w.asset, name: s.name || w.title, version: '0.1.0', author: 'Banner widgets plugin',
    description: s.description || w.about, tags: s.tags?.length ? s.tags : ['banner-widget'],
    data: { ...s.data, ...(icon ? { icon } : {}) },
  };
}
