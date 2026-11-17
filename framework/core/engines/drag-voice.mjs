/**
 * Voice → drag-move@1 (spec/DRAG-MOVE.md → Voice). Pure: a spoken phrase becomes a drag intent (what to move, by name,
 * and where it goes); the console resolves the names to ids through drag.list (apps/console-web/src/actions/drag.ts →
 * runDragVoice) and runs drag.move / drag.add / drag.remove. The console-control voice intents run first; this one
 * takes the phrases they leave.
 *
 *   "move the clock widget to the left of the banner"   → move  {what: clock, kind: banner-widget} side left of the banner
 *   "drag the Logs tab first"                            → move  {what: logs, kind: tab} first
 *   "put the search bar after the clock"                 → move  after "clock"
 *   "move the model column to the end"                   → move  last
 *   "remove the CPU widget" / "hide the CPU widget"      → remove {what: cpu, kind: banner-widget}
 *   "add the clock widget to the right of the banner"    → add   side right
 *
 * The answer's `where`: { at: 'first' | 'last' } | { at: 'before' | 'after', ref } | { at: 'side', side, host? }.
 */
import { cleanPhrase } from './console-control-voice.mjs';

/** Nouns that say which kind the thing is (the last word of the thing, or after its name). */
export const DRAG_VOICE_KINDS = {
  widget: 'banner-widget', badge: 'banner-widget', chip: 'banner-widget',
  tab: 'tab', pane: 'dock-pane', panel: 'dock-pane',
  column: 'grid-column', row: 'grid-row',
  slot: 'layout-slot', region: 'layout-slot',
  item: null, card: 'list-item', step: 'list-item', button: 'toolbar-item', command: 'toolbar-item',
};
/** Hosts a phrase can name ("of the banner", "on the toolbar"). */
export const DRAG_VOICE_HOSTS = { banner: 'banner-widget', toolbar: 'toolbar-item', 'tool bar': 'toolbar-item' };
const SIDES = { left: 'left', right: 'right', center: 'center', centre: 'center', middle: 'center', start: 'start', end: 'end', top: 'top', bottom: 'bottom' };

const MOVE = '(?:move|drag|put|shift|place|slide)';
const REMOVE = '(?:remove|hide|take off|take away|drop|get rid of)';
const ADD = '(?:add|show|bring back|put back|restore)';

/** Does the phrase look like a drag command at all (its lead verb)? The server uses this to hand a phrase to the console. */
export function looksLikeDrag(text) {
  return new RegExp(`^(?:${MOVE}|${REMOVE}|${ADD}|reorder)\\b`).test(cleanPhrase(text));
}

/** "the clock widget" → { words: 'clock', kind: 'banner-widget' }; kind null when no noun says it. */
export function dragVoiceThing(phrase) {
  let words = String(phrase ?? '').trim().replace(/^(?:the|a|an|my|this|that)\s+/, '');
  let kind = null;
  const m = /^(.*?)\s+(widget|badge|chip|tab|pane|panel|column|row|slot|region|item|card|step|button|command)s?$/.exec(words);
  if (m && m[1]) { words = m[1]; kind = DRAG_VOICE_KINDS[m[2]] ?? null; }
  return { words: words.trim(), kind };
}

/** Where it goes, from the tail of the phrase (after the thing). null when the tail says nothing a drag can use. */
export function dragVoiceWhere(tail) {
  const t = String(tail ?? '').trim();
  let m;
  if (!t || /^(?:to the |at the )?(?:end|back|bottom of the list)$|^last$/.test(t)) return t ? { at: 'last' } : null;
  if (/^(?:first|to the (?:front|start|beginning|top of the list)|at the (?:front|start|beginning))$/.test(t)) return { at: 'first' };
  // "to the left of the banner" / "on the right of the toolbar" / "to the left side"
  if ((m = /^(?:to|on|onto|into|over to|at) the (left|right|center|centre|middle|start|end|top|bottom)(?: side| part| end)?(?: of the (banner|toolbar|tool bar))?$/.exec(t))) return { at: 'side', side: SIDES[m[1]], ...(m[2] ? { host: DRAG_VOICE_HOSTS[m[2]] } : {}) };
  // "to the left of the clock" (left = before, right = after, on a row read left to right)
  if ((m = /^(?:to|on) the (left|right) of (?:the )?(.+)$/.exec(t))) return { at: m[1] === 'left' ? 'before' : 'after', ref: dragVoiceThing(m[2]).words };
  if ((m = /^(?:before|ahead of|in front of|above) (?:the )?(.+)$/.exec(t))) return { at: 'before', ref: dragVoiceThing(m[1]).words };
  if ((m = /^(?:after|behind|below|next to) (?:the )?(.+)$/.exec(t))) return { at: 'after', ref: dragVoiceThing(m[1]).words };
  if ((m = /^(?:to|on|onto) (?:the )?(banner|toolbar|tool bar)$/.exec(t))) return { at: 'last', host: DRAG_VOICE_HOSTS[m[1]] };
  return null;
}

/**
 * A phrase → { op, what, kind, where } or null. `kind` from the noun ("tab", "widget", "column") or the host the phrase
 * names; null = any kind (the console picks the best match across every host).
 */
export function dragVoiceIntent(text) {
  const p = cleanPhrase(text);
  if (!p) return null;
  let m;
  const ends = '(?:first|last|to the .+|on the .+|onto the .+|into the .+|over to the .+|at the .+|before .+|after .+|ahead of .+|in front of .+|behind .+|below .+|above .+|next to .+)';
  if ((m = new RegExp(`^${REMOVE} (?:the )?(.+?)(?: from the (banner|toolbar|tool bar))?$`).exec(p))) {
    const thing = dragVoiceThing(m[1]);
    return { op: 'remove', what: thing.words, kind: thing.kind ?? (m[2] ? DRAG_VOICE_HOSTS[m[2]] : null), where: null };
  }
  if ((m = new RegExp(`^${ADD} (?:the )?(.+?)(?: (${ends}))?$`).exec(p))) {
    const thing = dragVoiceThing(m[1]);
    // "show" alone is a console-control word ("show step 3 of …"); only a named kind makes it an add
    if (/^show\b/.test(p) && !thing.kind) return null;
    const where = m[2] ? dragVoiceWhere(m[2]) : { at: 'last' };
    if (!where) return null;
    return { op: 'add', what: thing.words, kind: thing.kind ?? where.host ?? 'banner-widget', where };
  }
  if ((m = new RegExp(`^(?:${MOVE}|reorder) (?:the )?(.+?) (${ends})$`).exec(p))) {
    const thing = dragVoiceThing(m[1]);
    const where = dragVoiceWhere(m[2]);
    if (!where || !thing.words) return null;
    return { op: 'move', what: thing.words, kind: thing.kind ?? where.host ?? null, where };
  }
  return null;
}

/** Normalized words for matching a label or an id ("Clock", "clock:main", "badge:cpu-load" → "clock main", …). */
export function dragVoiceWords(s) {
  return String(s ?? '').toLowerCase().replace(/[:._\-/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** How well an item answers to the words: 3 exact label, 2 label / id starts with or holds them as words, 1 a substring; 0 none. */
export function dragVoiceScore(words, item) {
  const w = dragVoiceWords(words);
  if (!w) return 0;
  const label = dragVoiceWords(item.label ?? '');
  const id = dragVoiceWords(item.id);
  if (label === w || id === w) return 3;
  const re = new RegExp(`(?:^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`);
  if (re.test(label) || re.test(id)) return 2;
  return label.includes(w) || id.includes(w) ? 1 : 0;
}
