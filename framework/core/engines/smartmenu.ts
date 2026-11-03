/**
 * Smart menus (smart-menu@1, build smart-menus, Brett Nov 3 2026): dynamic SECTIONS on top of a menu's fixed items, for
 * every context menu and every application-menu dropdown in every app. The fixed items keep their order (muscle
 * memory); the engine only adds sections above them and drops conditional items that don't apply:
 *
 *   talking    "Talking about": actions on what Brett and Amber are discussing right now (console_context topics)
 *   pinned     items the person pinned to this menu
 *   suggested  the items most likely wanted next, learned from past picks in the same context
 *   context    contributed items whose `when` matches this target / state / screen / device
 *   static     the menu's own items, in their own order (never reordered)
 *
 * Learning is plain arithmetic, zero tokens: frecency (pick count with a half-life decay) in the same context key,
 * a smaller share of the item's picks in other contexts, a time-of-day boost (picks in the same 4-hour bucket) and a
 * sequence boost (first-order Markov counts: what was picked after the last pick). Destructive items (delete, remove,
 * reset, stop…) are never promoted into Talking about, Pinned or Suggested by the engine; they stay where the menu has them.
 *
 * Pure: no IO, no DOM, no clock (callers pass `now`), no model calls (the fixture check fails if this file imports an
 * LLM client). The Menus plugin (apps/console-web/plugins/menus) owns the settings, the pick log and the topics, and
 * plugs this in through `rt.setMenuSections`; without it every menu is the plain static menu (with `when` filtering).
 * Fixture spec/fixtures/smart-menu.json; Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import type { MenuItem } from '../types';

export const SMART_MENU_FRAME = 'smart-menu@1';

/** What a menu shows, in this order by default (Addendum 2: Talking about on top of every menu). */
export const MENU_SECTION_KINDS = ['talking', 'pinned', 'suggested', 'context', 'static'] as const;
export type MenuSectionKind = (typeof MENU_SECTION_KINDS)[number];
export const MENU_TOPIC_KINDS = ['build', 'plugin', 'screen', 'pr', 'agent', 'setting', 'profile', 'note'] as const;
export type MenuTopicKind = (typeof MENU_TOPIC_KINDS)[number];

/** Where and how a menu was opened. `menu` is the per-menu key: `ctx:<target>` or `app:<menu id>`. */
export interface MenuOpen {
  kind: 'context' | 'app';
  menu: string;
  /** context target (`data-fx-ctx-target`) or the app menu id */
  target?: string;
  payload?: string;
  /** the target's state words (`data-fx-ctx-state`: selected running failed waiting has-pr …) */
  state?: string[];
  /** the current screen (view id) */
  screen?: string;
  device?: 'phone' | 'desktop';
}

/** A condition on a contributed item: every field given must match (arrays = any of). */
export interface MenuWhen {
  target?: string | string[];
  menu?: string | string[];
  /** every one of these state words is on the target */
  state?: string | string[];
  /** at least one of these */
  anyState?: string[];
  /** none of these */
  notState?: string | string[];
  screen?: string | string[];
  device?: 'phone' | 'desktop';
  /** a topic of this kind is being talked about */
  topic?: string | string[];
}

export interface MenuPick { key: string; item: string; at: number }
export interface MenuTopic { kind: string; id: string; label?: string; at: number; ttlMin?: number }

/** A section of a menu (menu asset `sections`, the Menus plugin's settings, per-menu overrides). */
export interface MenuSectionSpec {
  kind: MenuSectionKind;
  on?: boolean;
  /** most items it shows (dynamic sections) */
  max?: number;
  label?: string;
  icon?: string;
  /** shown folded (heading only) until tapped */
  collapsed?: boolean;
}

/** Items a topic kind brings into Talking about; `{id}` / `{label}` are filled from the topic. */
export interface MenuTopicTemplate {
  kind: string;
  /** menus it shows in (`app:builds`, `ctx:*`, `*`); absent = every menu */
  menus?: string[];
  items: MenuItem[];
}

export interface SmartMenuOptions {
  learning: boolean;
  /** how many Suggested items (3-5 by default 4) */
  suggestions: number;
  halfLifeDays: number;
  /** share of an item's picks in other contexts that still counts here */
  elsewhere: number;
  timeOfDay: number;
  sequence: number;
  /** below this score nothing is suggested (a cold menu shows no Suggested section) */
  minScore: number;
  showWhy: boolean;
  topicTtlMin: number;
  /** most topics kept */
  maxTopics: number;
}

export const SMART_MENU_DEFAULTS: SmartMenuOptions = {
  learning: true, suggestions: 4, halfLifeDays: 7, elsewhere: 0.25, timeOfDay: 0.5, sequence: 1,
  minScore: 0.5, showWhy: true, topicTtlMin: 30, maxTopics: 5,
};
export const SMART_MENU_LIMITS = { suggestions: [0, 8], halfLifeDays: [0.5, 90], topicTtlMin: [1, 24 * 60], maxPicks: 4000, sectionMax: 12 } as const;

export const DEFAULT_MENU_SECTIONS: MenuSectionSpec[] = [
  { kind: 'talking', on: true, max: 4, label: 'Talking about', icon: 'mic' },
  { kind: 'pinned', on: true, max: 8, label: 'Pinned', icon: 'star' },
  { kind: 'suggested', on: true, max: 4, label: 'Suggested', icon: 'sparkles' },
  { kind: 'context', on: true, max: 8, label: 'For this', icon: 'eye' },
  { kind: 'static', on: true },
];

/** Words in an action or id that mean it deletes, stops or throws away something (never promoted). */
export const DESTRUCTIVE_WORDS = /(^|[.:_\-\s])(delete|remove|reset|restore|clear|wipe|purge|uninstall|discard|drop|kill|destroy|stop|cancel|deny|reject|abort|revoke|close-all)([.:_\-\s]|$)/i;

const HOUR = 3_600_000;
const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/* ================================================================== context */

/** The learning key: menu + target + state words (sorted) + screen. Payload ids are left out so one build's menu teaches every build's. */
export function contextKey(open: MenuOpen): string {
  const state = [...new Set(open.state ?? [])].filter(Boolean).sort().join(',');
  return [open.menu, open.target ?? '', state, open.screen ?? ''].join('|');
}

/** State words from a `data-fx-ctx-state` attribute ("running has-pr" or "running,has-pr"). */
export function parseMenuState(attr: string | null | undefined): string[] {
  return [...new Set(String(attr ?? '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** Does a `when` condition hold here? No condition = always. */
export function whenMatches(when: MenuWhen | undefined | null, open: MenuOpen, topics: MenuTopic[] = []): boolean {
  if (!when) return true;
  const state = new Set(open.state ?? []);
  const t = asList(when.target);
  if (t.length && !t.includes(open.target ?? '')) return false;
  const m = asList(when.menu);
  if (m.length && !m.includes(open.menu)) return false;
  if (asList(when.state).some((s) => !state.has(s))) return false;
  if (when.anyState?.length && !when.anyState.some((s) => state.has(s))) return false;
  if (asList(when.notState).some((s) => state.has(s))) return false;
  const sc = asList(when.screen);
  if (sc.length && !sc.includes(open.screen ?? '')) return false;
  if (when.device && when.device !== (open.device ?? 'desktop')) return false;
  const tk = asList(when.topic);
  if (tk.length && !topics.some((x) => tk.includes(x.kind))) return false;
  return true;
}

/** Drop conditional items that don't apply (nested lists too); used with or without the Menus plugin. */
export function filterWhen(items: MenuItem[], open: MenuOpen, topics: MenuTopic[] = []): MenuItem[] {
  return items
    .filter((i) => i.separator || whenMatches(i.when, open, topics))
    .map((i) => (i.items ? { ...i, items: filterWhen(i.items, open, topics) } : i));
}

export function isDestructive(item: Pick<MenuItem, 'id' | 'action' | 'destructive'>): boolean {
  if (typeof item.destructive === 'boolean') return item.destructive;
  return DESTRUCTIVE_WORDS.test(item.action ?? '') || DESTRUCTIVE_WORDS.test(item.id);
}

/** Items that can be suggested or pinned: a leaf with an action (nested leaves included), first one per id. */
export function menuCandidates(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = []; const seen = new Set<string>();
  const walk = (list: MenuItem[], depth: number) => {
    for (const i of list) {
      if (i.separator || i.heading) continue;
      if (i.items?.length && depth < 4) walk(i.items, depth + 1);
      if (!i.action || i.provider || i.buttons?.length || seen.has(i.id)) continue;
      seen.add(i.id); out.push(i);
    }
  };
  walk(items, 0);
  return out;
}

/* ================================================================== ranking */

export const decay = (ageMs: number, halfLifeDays: number): number => Math.pow(0.5, Math.max(0, ageMs) / (halfLifeDays * 24 * HOUR));
/** 4-hour bucket of the local day (0-5): night, early, morning, midday, afternoon, evening. */
export const hourBucket = (at: number, tzOffsetMin = 0): number => Math.floor((((new Date(at - tzOffsetMin * 60_000).getUTCHours()) % 24) + 24) % 24 / 4);

export interface MenuScore { id: string; score: number; frecency: number; elsewhere: number; timeOfDay: number; sequence: number; why: string }

/**
 * Score every candidate for this context. `picks` is the person's pick log (any order); `now` and `tzOffsetMin` (minutes
 * the local clock is behind UTC, as Date.getTimezoneOffset) come from the caller. Highest first, ties by id.
 */
export function scoreMenuItems(candidates: MenuItem[], picks: MenuPick[], open: MenuOpen, now: number, opts: Partial<SmartMenuOptions> = {}, tzOffsetMin = 0): MenuScore[] {
  const o = { ...SMART_MENU_DEFAULTS, ...opts };
  const key = contextKey(open);
  const ids = new Set(candidates.map((c) => c.id));
  const here = new Map<string, number>(), away = new Map<string, number>(), tod = new Map<string, number>(), seq = new Map<string, number>();
  const bucket = hourBucket(now, tzOffsetMin);
  const sorted = [...picks].filter((p) => p.at <= now).sort((a, b) => a.at - b.at);
  // the last pick anywhere (within 30 min) drives the sequence boost
  const last = sorted.length && now - sorted[sorted.length - 1]!.at < 30 * 60_000 ? sorted[sorted.length - 1]!.item : '';
  let lastSeen = '';
  for (const p of sorted) {
    if (ids.has(p.item)) {
      const w = decay(now - p.at, o.halfLifeDays);
      if (p.key === key) {
        here.set(p.item, (here.get(p.item) ?? 0) + w);
        if (hourBucket(p.at, tzOffsetMin) === bucket) tod.set(p.item, (tod.get(p.item) ?? 0) + w);
      } else away.set(p.item, (away.get(p.item) ?? 0) + w);
      if (last && lastSeen === last) seq.set(p.item, (seq.get(p.item) ?? 0) + w);
    }
    lastSeen = p.item;
  }
  const seqTotal = [...seq.values()].reduce((a, b) => a + b, 0);
  return candidates.map((c) => {
    const f = here.get(c.id) ?? 0, e = (away.get(c.id) ?? 0) * o.elsewhere;
    const t = f > 0 ? ((tod.get(c.id) ?? 0) / f) * o.timeOfDay : 0;
    const s = seqTotal > 0 ? ((seq.get(c.id) ?? 0) / seqTotal) * o.sequence : 0;
    const score = round(f + e + t + s);
    const why = s >= Math.max(f, e, t) && s > 0 ? 'Often next' : t > 0.25 && f >= 1 ? 'You use it at this time' : f >= e ? 'Used often here' : 'Used often elsewhere';
    return { id: c.id, score, frecency: round(f), elsewhere: round(e), timeOfDay: round(t), sequence: round(s), why };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Keep a pick log bounded: newest `max` picks, and none older than 20 half-lives (they weigh nothing). */
export function prunePicks(picks: MenuPick[], now: number, halfLifeDays = SMART_MENU_DEFAULTS.halfLifeDays, max: number = SMART_MENU_LIMITS.maxPicks): MenuPick[] {
  const floor = now - 20 * halfLifeDays * 24 * HOUR;
  return picks.filter((p) => p.at >= floor && p.at <= now + 60_000).sort((a, b) => a.at - b.at).slice(-max);
}

/** Forget learning: everything, or one menu (`ctx:<target>` / `app:<id>`), or one exact context key. */
export function resetPicks(picks: MenuPick[], scope: { menu?: string; key?: string } = {}): MenuPick[] {
  if (scope.key) return picks.filter((p) => p.key !== scope.key);
  if (scope.menu) return picks.filter((p) => p.key.split('|')[0] !== scope.menu);
  return [];
}

/* ================================================================== topics */

/** Topics still live (not past their lifetime), newest first, at most `max`, one per kind+id. */
export function liveTopics(topics: MenuTopic[], now: number, ttlMin = SMART_MENU_DEFAULTS.topicTtlMin, max = SMART_MENU_DEFAULTS.maxTopics): MenuTopic[] {
  const seen = new Set<string>();
  return [...topics]
    .filter((t) => t && t.kind && t.id && now - t.at < (t.ttlMin ?? ttlMin) * 60_000)
    .sort((a, b) => b.at - a.at)
    .filter((t) => { const k = `${t.kind}:${t.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

/** Merge newly reported topics into the list (a repeat refreshes its time); `replace` drops the old ones first. */
export function mergeTopics(current: MenuTopic[], incoming: Omit<MenuTopic, 'at'>[], now: number, replace = false): MenuTopic[] {
  const fresh = incoming.filter((t) => t && typeof t.kind === 'string' && typeof t.id === 'string' && t.id.trim())
    .map((t) => ({ kind: t.kind, id: t.id.trim().slice(0, 200), ...(t.label ? { label: String(t.label).slice(0, 120) } : {}), ...(t.ttlMin ? { ttlMin: clamp(Number(t.ttlMin) || 0, SMART_MENU_LIMITS.topicTtlMin) } : {}), at: now }));
  const keys = new Set(fresh.map((t) => `${t.kind}:${t.id}`));
  return [...fresh, ...(replace ? [] : current.filter((t) => !keys.has(`${t.kind}:${t.id}`)))];
}

/** Contributed items with `when.topic` act as templates for that topic kind (their `{id}` / `{label}` get filled). */
const topicContributions = (candidates: MenuItem[]): MenuTopicTemplate[] =>
  candidates.filter((c) => c.when?.topic).flatMap((c) => asList(c.when!.topic).map((kind) => ({ kind, items: [{ ...c, when: { ...c.when, topic: undefined } }] })));

const fill = (s: string | undefined, t: MenuTopic) => s?.replace(/\{id\}/g, t.id).replace(/\{label\}/g, t.label || t.id);
const templateFits = (tpl: MenuTopicTemplate, menu: string) => !tpl.menus?.length || tpl.menus.some((m) => m === '*' || m === menu || (m === 'ctx:*' && menu.startsWith('ctx:')) || (m === 'app:*' && menu.startsWith('app:')));

/** Talking-about items for this menu: templates per topic kind, filled from each live topic, destructive ones left out. */
export function topicItems(topics: MenuTopic[], templates: MenuTopicTemplate[], open: MenuOpen): MenuItem[] {
  const out: MenuItem[] = [];
  for (const t of topics) {
    for (const tpl of templates.filter((x) => x.kind === t.kind && templateFits(x, open.menu))) {
      for (const i of tpl.items) {
        if (i.separator || isDestructive(i) || !whenMatches(i.when, open, topics)) continue;
        out.push({ ...i, id: `${i.id}@${t.kind}:${t.id}`, source: i.id, label: fill(i.label, t), action: fill(i.action, t), hint: t.label || t.id, when: undefined });
      }
    }
  }
  return out;
}

/* ================================================================== compose */

export interface MenuComposeInput {
  items: MenuItem[];
  open: MenuOpen;
  now: number;
  picks?: MenuPick[];
  /** pinned item ids for this menu, in pin order */
  pins?: string[];
  topics?: MenuTopic[];
  templates?: MenuTopicTemplate[];
  sections?: MenuSectionSpec[];
  options?: Partial<SmartMenuOptions>;
  tzOffsetMin?: number;
}

export interface ComposedMenu {
  items: MenuItem[];
  /** what each dynamic section holds (ids), for tests, the API and "why" */
  sections: { kind: MenuSectionKind; ids: string[] }[];
}

/** Normalise a section list: known kinds once each, static always present (on), limits clamped. */
export function normalizeSections(list: MenuSectionSpec[] | undefined | null): MenuSectionSpec[] {
  const src = Array.isArray(list) && list.length ? list : DEFAULT_MENU_SECTIONS;
  const seen = new Set<string>(); const out: MenuSectionSpec[] = [];
  for (const s of src) {
    if (!s || !MENU_SECTION_KINDS.includes(s.kind) || seen.has(s.kind)) continue;
    seen.add(s.kind);
    const d = DEFAULT_MENU_SECTIONS.find((x) => x.kind === s.kind)!;
    out.push({ ...d, ...s, on: s.kind === 'static' ? true : s.on !== false, ...(s.kind !== 'static' ? { max: clamp(Number(s.max ?? d.max) || 0, [0, SMART_MENU_LIMITS.sectionMax]) } : {}) });
  }
  if (!seen.has('static')) out.push({ kind: 'static', on: true });
  return out;
}

const heading = (s: MenuSectionSpec): MenuItem => ({ id: `smart:${s.kind}`, heading: true, label: s.label, icon: s.icon, section: s.kind, ...(s.collapsed ? { collapsed: true } : {}) });
const tag = (i: MenuItem, kind: MenuSectionKind, hint?: string): MenuItem => ({ ...i, id: `${kind}:${i.id}`, source: i.source ?? i.id, section: kind, ...(hint ? { hint } : {}), items: undefined });

/**
 * The menu to draw: dynamic sections (in the configured order) above the static items, which keep their order.
 * Conditional items (`when`) that match go to the context section (or stay in place when it is off); the rest are dropped.
 */
export function composeMenu(input: MenuComposeInput): ComposedMenu {
  const o = { ...SMART_MENU_DEFAULTS, ...input.options };
  const topics = liveTopics(input.topics ?? [], input.now, o.topicTtlMin, o.maxTopics);
  const sections = normalizeSections(input.sections);
  const on = (k: MenuSectionKind) => sections.find((s) => s.kind === k)?.on !== false && sections.some((s) => s.kind === k);
  // items tied to a topic (`when.topic`) only ever show in Talking about, filled from the topic
  const filtered = filterWhen(input.items, input.open, topics);
  const plain = filtered.filter((i) => !i.when?.topic);
  // conditional items are pulled out into the context section when it is on
  // destructive conditional items stay where the menu has them (never moved up into a section)
  const lifted = (i: MenuItem) => !i.separator && !!i.when && !isDestructive(i);
  const conditional = on('context') ? plain.filter(lifted) : [];
  const staticItems = tidy(on('context') ? plain.filter((i) => !lifted(i)) : plain);
  const candidates = menuCandidates(filtered);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const used = new Set<string>();
  const blocks = new Map<MenuSectionKind, MenuItem[]>();
  for (const s of sections) {
    if (s.kind === 'static' || s.on === false) continue;
    const max = s.max ?? 4;
    let list: MenuItem[] = [];
    if (s.kind === 'talking') list = topicItems(topics, [...(input.templates ?? []), ...topicContributions(candidates)], input.open).map((i) => ({ ...tag(i, 'talking', i.hint), id: `talking:${i.id}` }));
    else if (s.kind === 'pinned') list = (input.pins ?? []).map((id) => byId.get(id)).filter((i): i is MenuItem => !!i && !i.when?.topic && !isDestructive(i)).map((i) => tag(i, 'pinned'));
    else if (s.kind === 'suggested' && o.learning && o.suggestions > 0) {
      const pool = candidates.filter((c) => !c.when?.topic && !isDestructive(c) && !used.has(c.id));
      const scores = scoreMenuItems(pool, input.picks ?? [], input.open, input.now, o, input.tzOffsetMin ?? 0).filter((x) => x.score >= o.minScore);
      list = scores.slice(0, Math.min(max, o.suggestions)).map((x) => tag(byId.get(x.id)!, 'suggested', o.showWhy ? x.why : undefined));
    } else if (s.kind === 'context') list = conditional.filter((i) => !i.items?.length || i.action).map((i) => ({ ...i, section: 'context' as const }));
    list = list.filter((i) => !used.has(i.source ?? i.id)).slice(0, max);
    list.forEach((i) => used.add(i.source ?? i.id));
    if (list.length) blocks.set(s.kind, list);
  }
  const items: MenuItem[] = [];
  for (const s of sections) {
    const part = s.kind === 'static' ? staticItems : blocks.get(s.kind);
    if (!part?.length) continue;
    if (items.length) items.push({ id: `smart-sep:${s.kind}`, separator: true });
    if (s.kind !== 'static') items.push(heading(s));
    items.push(...part);
  }
  return { items, sections: [...blocks.entries()].map(([kind, list]) => ({ kind, ids: list.map((i) => i.source ?? i.id) })) };
}

/** No separator at either end or twice in a row (after dropping conditional items). */
function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const i of items) {
    if (i.separator && (!out.length || out[out.length - 1]!.separator)) continue;
    out.push(i);
  }
  while (out.length && out[out.length - 1]!.separator) out.pop();
  return out;
}

/** The id a pick is recorded under (a Suggested / Pinned copy records its source item). */
export const pickId = (item: Pick<MenuItem, 'id' | 'source'>): string => item.source ?? item.id;

/* ================================================================== look */

/**
 * The menus' look (setting `axf.menus.look`, a look setting: it rides the axHub appearance document, so a change applies
 * in every app). Colours are theme-token NAMES (never hex), sizes are multipliers of the theme's own tokens, so swapping
 * any theme still restyles every menu. Compiled into `--fx-menu-*` vars (axf.css reads only those); `perMenu`
 * overrides one menu (`ctx:<target>` / `app:<id>`), applied on that menu's box.
 */
export const MENU_LOOK_COLORS = ['bg', 'surface', 'surface-2', 'surface-3', 'text', 'muted', 'border', 'accent', 'accent-soft', 'accent-text', 'success', 'warning', 'danger', 'info', 'focus'] as const;
export const MENU_ANIMATIONS = ['fade', 'scale', 'slide', 'drop', 'none'] as const;
export const MENU_EASINGS = { standard: 'cubic-bezier(.2,0,0,1)', out: 'cubic-bezier(0,0,.2,1)', in: 'cubic-bezier(.4,0,1,1)', linear: 'linear', spring: 'cubic-bezier(.34,1.56,.64,1)' } as const;
export const MENU_FONTS = ['body', 'display', 'mono'] as const;
export const MENU_HOVERS = ['tint', 'outline', 'lift', 'none'] as const;

export interface MenuLook {
  colors?: Partial<Record<'background' | 'text' | 'hover' | 'heading' | 'separator' | 'icon' | 'hint' | 'border' | 'badge' | 'talking' | 'pinned' | 'suggested' | 'context', string>>;
  /** 0-1: the box's opacity over what is behind (1 = solid) */
  opacity?: number;
  /** × the theme's blur (glass); 0 = none */
  blur?: number;
  /** 0-3: shadow depth (none, sm, md, lg) */
  shadow?: number;
  font?: (typeof MENU_FONTS)[number];
  /** × the theme font size */
  fontScale?: number;
  weight?: number;
  /** em */
  tracking?: number;
  headingScale?: number;
  headingCase?: 'upper' | 'none';
  iconScale?: number;
  /** × the theme's row padding */
  density?: number;
  /** × the theme's medium radius */
  radius?: number;
  /** × the theme's space unit (min / max width of a menu box) */
  minWidth?: number;
  maxWidth?: number;
  animation?: (typeof MENU_ANIMATIONS)[number];
  /** × the theme's motion duration */
  speed?: number;
  easing?: keyof typeof MENU_EASINGS;
  /** ms between rows appearing; 0 = all at once */
  stagger?: number;
  hover?: (typeof MENU_HOVERS)[number];
  /** a soft pulse on Talking-about rows when the menu opens */
  pulseTalking?: boolean;
  perMenu?: Record<string, Omit<MenuLook, 'perMenu'>>;
}

export const MENU_LOOK_DEFAULT: Required<Omit<MenuLook, 'perMenu' | 'colors'>> & { colors: Required<NonNullable<MenuLook['colors']>> } = {
  colors: { background: 'surface', text: 'text', hover: 'accent-soft', heading: 'muted', separator: 'border', icon: 'muted', hint: 'muted', border: 'border', badge: 'accent', talking: 'info', pinned: 'warning', suggested: 'accent', context: 'success' },
  opacity: 1, blur: 0, shadow: 3, font: 'body', fontScale: 1, weight: 400, tracking: 0, headingScale: 0.78, headingCase: 'upper', iconScale: 1,
  density: 1, radius: 1, minWidth: 25, maxWidth: 60, animation: 'fade', speed: 1, easing: 'standard', stagger: 0, hover: 'tint', pulseTalking: true,
};

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const colorRef = (v: unknown, d: string) => `var(--fx-${MENU_LOOK_COLORS.includes(v as never) ? v : d})`;

/** Clamp and fill a look (unknown values fall back to the default). */
export function normalizeMenuLook(look: MenuLook | null | undefined): typeof MENU_LOOK_DEFAULT {
  const d = MENU_LOOK_DEFAULT, l = look ?? {};
  const colors = { ...d.colors };
  for (const k of Object.keys(colors) as (keyof typeof colors)[]) if (MENU_LOOK_COLORS.includes(l.colors?.[k] as never)) colors[k] = l.colors![k]!;
  return {
    colors, opacity: num(l.opacity, d.opacity, 0.3, 1), blur: num(l.blur, d.blur, 0, 3), shadow: Math.round(num(l.shadow, d.shadow, 0, 3)),
    font: oneOf(l.font, MENU_FONTS, d.font), fontScale: num(l.fontScale, d.fontScale, 0.7, 1.6), weight: Math.round(num(l.weight, d.weight, 300, 800) / 100) * 100,
    tracking: num(l.tracking, d.tracking, -0.05, 0.2), headingScale: num(l.headingScale, d.headingScale, 0.6, 1.2), headingCase: l.headingCase === 'none' ? 'none' : 'upper',
    iconScale: num(l.iconScale, d.iconScale, 0.6, 1.8), density: num(l.density, d.density, 0.5, 2), radius: num(l.radius, d.radius, 0, 3),
    minWidth: num(l.minWidth, d.minWidth, 10, 60), maxWidth: num(l.maxWidth, d.maxWidth, 20, 120), animation: oneOf(l.animation, MENU_ANIMATIONS, d.animation),
    speed: num(l.speed, d.speed, 0, 4), easing: (Object.keys(MENU_EASINGS) as (keyof typeof MENU_EASINGS)[]).includes(l.easing as never) ? l.easing! : d.easing,
    stagger: Math.round(num(l.stagger, d.stagger, 0, 80)), hover: oneOf(l.hover, MENU_HOVERS, d.hover), pulseTalking: typeof l.pulseTalking === 'boolean' ? l.pulseTalking : d.pulseTalking,
  };
}

const SHADOWS = ['none', 'var(--fx-shadow-sm)', 'var(--fx-shadow-md)', 'var(--fx-shadow-lg)'];

/** `--fx-menu-*` vars for a look (every value references a theme token) + attributes the stylesheet selects on. */
export function menuLookStyle(look: MenuLook | null | undefined, reducedMotion = false): { vars: Record<string, string>; attrs: Record<string, string> } {
  const n = normalizeMenuLook(look), c = n.colors;
  const motion = reducedMotion ? 'none' : n.animation;
  const vars: Record<string, string> = {
    '--fx-menu-bg': n.opacity < 1 ? `color-mix(in srgb, ${colorRef(c.background, 'surface')} ${Math.round(n.opacity * 100)}%, transparent)` : colorRef(c.background, 'surface'),
    '--fx-menu-text': colorRef(c.text, 'text'), '--fx-menu-hover': colorRef(c.hover, 'accent-soft'), '--fx-menu-heading': colorRef(c.heading, 'muted'),
    '--fx-menu-sep': colorRef(c.separator, 'border'), '--fx-menu-icon': colorRef(c.icon, 'muted'), '--fx-menu-hint': colorRef(c.hint, 'muted'),
    '--fx-menu-border': colorRef(c.border, 'border'), '--fx-menu-badge': colorRef(c.badge, 'accent'),
    '--fx-menu-talking': colorRef(c.talking, 'info'), '--fx-menu-pinned': colorRef(c.pinned, 'warning'), '--fx-menu-suggested': colorRef(c.suggested, 'accent'), '--fx-menu-context': colorRef(c.context, 'success'),
    '--fx-menu-blur': `calc(var(--fx-blur) * ${n.blur})`, '--fx-menu-shadow': SHADOWS[n.shadow]!,
    '--fx-font-menu': n.font === 'body' ? 'var(--fx-font)' : `var(--fx-font-${n.font})`, '--fx-menu-font-size': `calc(var(--fx-font-size) * ${n.fontScale})`,
    '--fx-menu-weight': String(n.weight), '--fx-menu-tracking': `${n.tracking}em`, '--fx-menu-heading-size': `calc(var(--fx-font-size) * ${n.fontScale * n.headingScale})`,
    '--fx-menu-heading-case': n.headingCase === 'upper' ? 'uppercase' : 'none', '--fx-menu-icon-k': String(n.iconScale), '--fx-menu-density': String(n.density),
    '--fx-menu-radius': `calc(var(--fx-radius-md) * ${n.radius})`, '--fx-menu-min-w': `calc(var(--fx-space) * ${n.minWidth})`, '--fx-menu-max-w': `calc(var(--fx-space) * ${n.maxWidth})`,
    '--fx-menu-duration': `calc(var(--fx-motion) * ${motion === 'none' ? 0 : n.speed})`, '--fx-menu-ease': MENU_EASINGS[n.easing], '--fx-menu-stagger': `${reducedMotion ? 0 : n.stagger}ms`,
  };
  return { vars, attrs: { 'data-fx-menu-anim': motion, 'data-fx-menu-hover': n.hover, 'data-fx-menu-pulse': n.pulseTalking && !reducedMotion ? 'on' : 'off' } };
}

/** The vars one menu overrides (`perMenu[menu]` on top of the app-wide look), only those that differ; empty = none. */
export function menuLookOverride(look: MenuLook | null | undefined, menu: string, reducedMotion = false): Record<string, string> {
  const own = look?.perMenu?.[menu];
  if (!own) return {};
  const base = menuLookStyle(look, reducedMotion).vars;
  const mine = menuLookStyle({ ...look, ...own, colors: { ...look?.colors, ...own.colors } }, reducedMotion).vars;
  return Object.fromEntries(Object.entries(mine).filter(([k, v]) => base[k] !== v));
}

/** Ready-made looks (the Menus plugin's presets); each is a partial look laid over the default. */
export const MENU_LOOK_PRESETS: Record<string, { label: string; look: MenuLook }> = {
  standard: { label: 'Standard', look: {} },
  compact: { label: 'Compact', look: { fontScale: 0.9, density: 0.7, radius: 0.7, minWidth: 20, animation: 'none' } },
  roomy: { label: 'Roomy (phone)', look: { fontScale: 1.1, density: 1.5, iconScale: 1.2, minWidth: 30 } },
  glass: { label: 'Glass', look: { opacity: 0.8, blur: 1, shadow: 3, animation: 'scale' } },
  bold: { label: 'Bold sections', look: { weight: 500, headingScale: 0.9, colors: { heading: 'accent', suggested: 'accent', talking: 'warning' }, pulseTalking: true } },
  calm: { label: 'Calm', look: { animation: 'fade', speed: 1.5, hover: 'outline', pulseTalking: false, colors: { talking: 'muted', pinned: 'muted', suggested: 'muted', context: 'muted' } } },
};
