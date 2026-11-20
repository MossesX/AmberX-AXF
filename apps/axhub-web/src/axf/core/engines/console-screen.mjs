/**
 * Console screen (console-screen@1; build voice-console-control, Nov 20 2026): what a voice call needs to see and drive
 * Brett's open console by words. On voice the image of a console screenshot never reaches Amber, so a screenshot answer
 * also carries a numbered map of every interactive element on the screen (and a written description the console server
 * adds), and a set of pointer actions act on a target named by words, by its number in the last map, by a
 * console-control@1 address or by x,y coordinates.
 *
 * Pure (no IO, no DOM): the console client collects raw elements from its DOM and runs what `screenResolveTarget`
 * picks; the server and the MCP tools only pass the command through. Rides on console-command@1 as op `drive`
 * (console-commands.mjs): message.command = a console-screen@1 command.
 *
 *   element  { n, label, kind, group?, state?, address?, box: { x, y, w, h }, visible }
 *            n = its number (reading order: visible ones top to bottom, left to right, then the ones to scroll to);
 *            box = image pixels of the console screenshot (CSS px × the screenshot's scale); visible false = "scroll to see".
 *   command  { $axf: 'console-screen@1', action, target?, item?, path?, text?, keys?, dir?, to?, submit?, confirm? }
 *   answer   { $axf: 'console-screen@1', ok, action, did?, target?, elements, viewport, code?, message?, candidates? }
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { CONSOLE_CONTROL_ADDRESS_PATTERN } from './console-control-rules.mjs';

export const CONSOLE_SCREEN_FRAME = 'console-screen@1';
/** The MCP tools that drive the screen (names are a contract: voice sessions call them through axHub). */
export const CONSOLE_SCREEN_TOOLS = ['console_click', 'console_right_click', 'console_double_click', 'console_menu', 'console_context_menu', 'console_expand', 'console_collapse',
  'console_jump', 'console_scroll', 'console_type', 'console_key'];
/** What a console runs for op `drive`. `map` only reads. */
export const CONSOLE_SCREEN_ACTIONS = ['map', 'click', 'right_click', 'double_click', 'menu', 'context_menu', 'expand', 'collapse', 'scroll', 'type', 'key'];
export const CONSOLE_SCREEN_KINDS = ['row', 'expander', 'menuitem', 'menu', 'tab', 'button', 'link', 'input', 'checkbox', 'switch', 'select', 'option', 'item'];
export const CONSOLE_SCREEN_SCROLL_DIRS = ['up', 'down', 'page-up', 'page-down', 'top', 'bottom'];
/** The most elements one map lists (visible ones first). */
export const CONSOLE_SCREEN_MAP_MAX = 400;
export const CONSOLE_SCREEN_LABEL_MAX = 200;
/** A screen description: how long the model gets, and how long one is kept for the same image. */
export const CONSOLE_DESCRIBE_TIMEOUT_MS = 30_000;
export const CONSOLE_DESCRIBE_CACHE_MS = 120_000;

/** Words on a control that mean pressing it deletes, stops or lands something: confirm first. */
const DESTRUCTIVE = /\b(delete|remove|stop|merge|kill|reset|discard|wipe|purge|uninstall|revoke|destroy|erase|drop|clear|abort|terminate|cancel build|force[ -]?push|land now|restore defaults?)\b/i;
/** Words that mean a decision only Brett makes with his own tap. */
const DECIDING = /\b(approve|deny|reject|veto|sign[ -]?off|shelve)\b/i;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v, max = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ADDRESS_RE = new RegExp(CONSOLE_CONTROL_ADDRESS_PATTERN);

/* ================================================================== the element map */

/**
 * Raw elements (as the console collected them: label, kind, group, state, address, box, visible) → the numbered map.
 * Visible ones come first in reading order (rows of the screen top to bottom, left to right inside a row), then the
 * ones that need a scroll, top to bottom. Unknown kinds become `item`; elements without a label or a box are dropped.
 */
export function screenElementMap(raw, max = CONSOLE_SCREEN_MAP_MAX) {
  const list = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || !isObj(r.box)) continue;
    const label = text(r.label, CONSOLE_SCREEN_LABEL_MAX);
    const box = Object.fromEntries(['x', 'y', 'w', 'h'].map((k) => [k, Math.round(Number(r.box[k]) || 0)]));
    if (!label || box.w <= 0 || box.h <= 0) continue;
    const el = { label, kind: CONSOLE_SCREEN_KINDS.includes(r.kind) ? r.kind : 'item' };
    const group = text(r.group, 80);
    if (group) el.group = group;
    if (isObj(r.state)) {
      const state = {};
      for (const k of ['expanded', 'selected', 'disabled', 'checked', 'pressed', 'danger']) if (typeof r.state[k] === 'boolean') state[k] = r.state[k];
      const value = text(r.state.value, 120);
      if (value) state.value = value;
      if (Object.keys(state).length) el.state = state;
    }
    const address = text(r.address, 400);
    if (address) el.address = address;
    el.box = box;
    el.visible = r.visible !== false;
    list.push(el);
  }
  // one line of the screen = elements whose vertical centres are within half the shorter one's height
  const mid = (e) => e.box.y + e.box.h / 2;
  const reading = (a, b) => (Math.abs(mid(a) - mid(b)) <= Math.min(a.box.h, b.box.h) / 2 ? a.box.x - b.box.x : mid(a) - mid(b)) || a.box.x - b.box.x;
  const seen = list.filter((e) => e.visible).sort((a, b) => mid(a) - mid(b) || a.box.x - b.box.x);
  // a stable reading order: group into lines first (a pairwise comparator alone is not transitive)
  const lines = [];
  for (const e of seen) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(mid(line[0]) - mid(e)) <= Math.min(line[0].box.h, e.box.h) / 2) line.push(e);
    else lines.push([e]);
  }
  const ordered = lines.flatMap((l) => l.sort((a, b) => a.box.x - b.box.x));
  const away = list.filter((e) => !e.visible).sort(reading);
  return [...ordered, ...away].slice(0, Math.max(1, max)).map((e, i) => ({ n: i + 1, ...e }));
}

/** One element as a line of text: `12. [button] Retry (disabled) at 640,300 80×28 → button:retry`. */
export function screenElementLine(e) {
  const s = isObj(e.state) ? e.state : {};
  const flags = [s.expanded === true ? 'expanded' : s.expanded === false ? 'collapsed' : '', s.selected ? 'selected' : '', s.checked === true ? 'on' : s.checked === false ? 'off' : '',
    s.pressed ? 'pressed' : '', s.disabled ? 'disabled' : '', s.danger ? 'destructive' : '', s.value ? `value "${s.value}"` : ''].filter(Boolean);
  const where = e.visible === false ? 'scroll to see' : `at ${e.box.x},${e.box.y} ${e.box.w}×${e.box.h}`;
  return `${e.n}. [${e.kind}] ${e.label}${flags.length ? ` (${flags.join(', ')})` : ''}${e.group ? ` · in ${e.group}` : ''} · ${where}${e.address ? ` → ${e.address}` : ''}`;
}

/** The whole map as text (what a voice session reads instead of the image). */
export function screenMapText(elements, limit = CONSOLE_SCREEN_MAP_MAX) {
  const list = (Array.isArray(elements) ? elements : []).slice(0, limit);
  if (!list.length) return 'No interactive element is on the screen.';
  const more = (Array.isArray(elements) ? elements.length : 0) - list.length;
  return list.map(screenElementLine).join('\n') + (more > 0 ? `\n… and ${more} more` : '');
}

/* ================================================================== naming a target */

const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** Words that name a kind of element ("the retry button", "row 3"). */
const KIND_WORDS = {
  row: ['row'], rows: ['row'], line: ['row'], build: ['row'], tab: ['tab'], tabs: ['tab'], button: ['button', 'expander', 'menu'], link: ['link'],
  menu: ['menu', 'menuitem'], item: ['menuitem', 'option', 'item', 'row'], option: ['option', 'menuitem'], field: ['input', 'select'], input: ['input'], box: ['input', 'checkbox'],
  checkbox: ['checkbox'], switch: ['switch'], toggle: ['switch', 'checkbox'], dropdown: ['select', 'menu'], expander: ['expander'], arrow: ['expander'], chevron: ['expander'],
};
/** Words a person adds that name nothing. */
const FILLER = new Set(['the', 'a', 'an', 'that', 'this', 'on', 'in', 'of', 'at', 'to', 'please', 'click', 'press', 'tap', 'hit', 'open', 'select', 'choose', 'pick', 'called', 'named', 'labelled', 'labeled', 'one', 'it', 'says', 'saying', 'with']);
const POSITION = { top: [0, -1], upper: [0, -1], bottom: [0, 1], lower: [0, 1], left: [-1, 0], right: [1, 0] };

/** Edit distance, stopping early once it passes `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** How well one said word matches a label (0 = not at all). A transcription slip (one letter in a short word, two in a long one) still matches. */
function wordScore(word, labelWords, label) {
  if (labelWords.includes(word)) return 1;
  if (labelWords.some((w) => w.startsWith(word) && word.length >= 2)) return 0.85;
  if (word.length >= 3 && label.includes(word)) return 0.7;
  const slack = word.length >= 6 ? 2 : word.length >= 4 ? 1 : 0;
  if (slack && labelWords.some((w) => distance(word, w, slack) <= slack)) return 0.6;
  return 0;
}

/**
 * The element a target names. `target` = a number from the map ("3", "#3", "number 3"), a kind and a position
 * ("row 3", "the third tab", "last row"), a console-control@1 address, x,y coordinates ("640,300": anywhere on the
 * screenshot), or words (case-insensitive; every word must match the label, a small transcription slip allowed).
 * `prefer` = kinds that win a tie (rows for expand, menu items inside an open menu).
 * → { point: { x, y } } | { element } | { candidates, ambiguous: true } (several match: ask, never guess)
 *   | { candidates } (nothing matched: the nearest ones, possibly none).
 */
export function screenResolveTarget(elements, target, { prefer = [] } = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const raw = text(String(target ?? ''), 400);
  if (!raw) return { candidates: [] };
  const xy = /^\(?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s|x)\s*(-?\d+(?:\.\d+)?)\s*\)?$/i.exec(raw);
  if (xy) return { point: { x: Number(xy[1]), y: Number(xy[2]) } };
  const num = /^(?:#|no\.?\s*|number\s+|item\s+|element\s+)?(\d{1,4})$/i.exec(raw);
  if (num) { const hit = list.find((e) => e.n === Number(num[1])); return hit ? { element: hit } : { candidates: [] }; }
  if (ADDRESS_RE.test(raw)) {
    const low = raw.toLowerCase();
    const hits = list.filter((e) => e.address && (e.address.toLowerCase() === low || e.address.toLowerCase().endsWith(`/${low}`)));
    if (hits.length === 1) return { element: hits[0] };
    if (hits.length > 1) return { candidates: hits, ambiguous: true };
    return { candidates: [] };
  }
  let words = fold(raw).split(' ').filter(Boolean);
  // "row 3", "third row", "the last tab": a kind and where it stands among the visible ones of that kind
  const kindWord = words.find((w) => KIND_WORDS[w]);
  const kinds = kindWord ? KIND_WORDS[kindWord] : [];
  const rest = words.filter((w) => w !== kindWord && !FILLER.has(w));
  if (kindWord && rest.length === 1 && (/^\d{1,3}$/.test(rest[0]) || ORDINALS[rest[0]] || rest[0] === 'last')) {
    const of = list.filter((e) => e.visible !== false && e.kind === kinds[0]);
    const i = rest[0] === 'last' ? of.length : Number(rest[0]) || ORDINALS[rest[0]];
    return of[i - 1] ? { element: of[i - 1] } : { candidates: of.slice(0, 8) };
  }
  // where on the screen ("top right") only breaks a tie; the other words name the element
  const position = words.filter((w) => POSITION[w]);
  const named = words.filter((w) => !FILLER.has(w) && !POSITION[w]);
  words = named.filter((w) => !KIND_WORDS[w]);
  if (!words.length) words = named; // "the menu", "row": the kind word is the name
  if (!words.length) return { candidates: [] };
  const phrase = words.join(' ');
  const wanted = new Set([...prefer, ...(words === named ? [] : kinds)]);
  const scored = [];
  const partial = [];
  for (const e of list) {
    const label = fold(e.label);
    const lw = label.split(' ');
    const hits = words.map((w) => wordScore(w, lw, label));
    const matched = hits.filter((s) => s > 0).length;
    if (!matched) continue;
    if (matched < words.length) { partial.push([e, matched]); continue; }
    let score = hits.reduce((a, b) => a + b, 0) / words.length;
    if (label === phrase) score += 1;
    else if (label.startsWith(phrase)) score += 0.3;
    score += 0.3 * Math.min(1, words.length / lw.length); // a label that is mostly these words beats a long one that mentions them
    if (wanted.has(e.kind)) score += 0.25;
    if (e.visible !== false) score += 0.1;
    if (e.state?.disabled) score -= 0.05;
    scored.push([e, score]);
  }
  scored.sort((a, b) => b[1] - a[1] || a[0].n - b[0].n);
  if (!scored.length) return { candidates: partial.sort((a, b) => b[1] - a[1] || a[0].n - b[0].n).slice(0, 6).map(([e]) => e) };
  if (scored.length === 1 || scored[0][1] - scored[1][1] >= 0.15) return { element: scored[0][0] };
  const tied = scored.filter(([, s]) => scored[0][1] - s < 0.15).map(([e]) => e);
  if (position.length) {
    const [dx, dy] = position.reduce(([x, y], w) => [x + POSITION[w][0], y + POSITION[w][1]], [0, 0]);
    const rank = (e) => dx * (e.box.x + e.box.w / 2) + dy * (e.box.y + e.box.h / 2);
    const by = [...tied].sort((a, b) => rank(b) - rank(a));
    if (rank(by[0]) !== rank(by[1])) return { element: by[0] };
  }
  return { candidates: tied.slice(0, 8), ambiguous: true };
}

/**
 * Does pressing this element need more than a command? `person` = a decision only Brett makes with his own tap
 * (approve, deny): never pressed. `destructive` = it deletes, stops or merges something: pressed only when the command
 * carries confirm. Else null.
 */
export function screenTargetGuard(element) {
  const label = String(element?.label ?? '');
  const leaf = String(element?.address ?? '').split('/').pop() ?? '';
  const words = `${label} ${leaf.replace(/[.:_-]+/g, ' ')}`;
  if (DECIDING.test(words)) return 'person';
  if (element?.state?.danger === true || DESTRUCTIVE.test(words)) return 'destructive';
  return null;
}

/** "Settings > Plugins > Agent cap" → ['Settings', 'Plugins', 'Agent cap'] (also ›, →, /, |, " then "). */
export function screenMenuPath(path) {
  if (Array.isArray(path)) return path.map((p) => text(String(p), 120)).filter(Boolean).slice(0, 8);
  return String(path ?? '').split(/\s*(?:>|›|→|»|\/|\||,?\s+then\s+)\s*/i).map((p) => text(p, 120)).filter(Boolean).slice(0, 8);
}

const KEY_NAMES = {
  esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab', space: ' ', spacebar: ' ', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert',
};
const MODIFIERS = { ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta' };

/**
 * "ctrl+s", "Escape", "down down enter", "shift+tab" → [{ key, ctrl, shift, alt, meta }] (keys separated by spaces or
 * commas, a chord joined by + or -). → { keys } or { error }.
 */
export function screenKeys(keys) {
  const out = [];
  for (const chord of String(keys ?? '').trim().split(/[\s,]+/).filter(Boolean).slice(0, 40)) {
    const parts = chord.length > 1 ? chord.split(/[+-]/).filter(Boolean) : [chord];
    const k = { key: '', ctrl: false, shift: false, alt: false, meta: false };
    for (const [i, p] of parts.entries()) {
      const low = p.toLowerCase();
      if (i < parts.length - 1 && MODIFIERS[low]) { k[MODIFIERS[low]] = true; continue; }
      if (i < parts.length - 1) return { error: `"${chord}": ${p} is not a modifier (ctrl, shift, alt, meta)` };
      k.key = KEY_NAMES[low] ?? (/^f([1-9]|1[0-2])$/.test(low) ? low.toUpperCase() : p.length === 1 ? p : '');
      if (!k.key) return { error: `"${p}" is not a key (a letter, a digit, Enter, Escape, Tab, Space, arrows, Backspace, Delete, Home, End, PageUp, PageDown, F1-F12)` };
    }
    out.push(k);
  }
  return out.length ? { keys: out } : { error: 'no key named' };
}

/* ================================================================== the command */

/** What each action needs. */
const NEEDS = { click: ['target'], right_click: ['target'], double_click: ['target'], menu: ['path'], context_menu: ['target'], expand: ['target'], collapse: ['target'], type: ['text'], key: ['keys'] };

/**
 * A console-screen@1 command, cleaned. → { command } or { errors }. `scroll` takes dir (up, down, page-up, page-down,
 * top, bottom) or `to` (a target to bring into view); `type` types into `target` (or the focused field).
 */
export function normalizeScreenCommand(raw) {
  const r = isObj(raw) ? raw : {};
  const action = String(r.action ?? '');
  if (!CONSOLE_SCREEN_ACTIONS.includes(action)) return { errors: [`action must be one of ${CONSOLE_SCREEN_ACTIONS.join(', ')}`] };
  const c = { $axf: CONSOLE_SCREEN_FRAME, action };
  for (const k of ['target', 'item', 'to']) { const v = text(typeof r[k] === 'number' ? String(r[k]) : r[k], 400); if (v) c[k] = v; }
  if (r.path !== undefined) { const p = screenMenuPath(r.path); if (p.length) c.path = p; }
  if (typeof r.text === 'string') c.text = r.text.slice(0, 20_000);
  const errors = [];
  if (r.keys !== undefined) { const k = screenKeys(r.keys); if (k.error) errors.push(k.error); else c.keys = k.keys; }
  if (action === 'scroll') {
    const dir = String(r.dir ?? '').toLowerCase().replace(/\s+/g, '-');
    if (dir) { if (CONSOLE_SCREEN_SCROLL_DIRS.includes(dir)) c.dir = dir; else errors.push(`dir must be one of ${CONSOLE_SCREEN_SCROLL_DIRS.join(', ')}`); }
    if (!c.dir && !c.to) errors.push('scroll needs dir or to');
  }
  for (const k of NEEDS[action] ?? []) if (c[k] === undefined && !(k === 'keys' && errors.length)) errors.push(`${action} needs ${k}`);
  for (const k of ['submit', 'confirm']) if (r[k] === true) c[k] = true;
  if (Number.isFinite(r.scale) && r.scale > 0) c.scale = Number(r.scale);
  return errors.length ? { errors } : { command: c };
}

/** Does an action change what the console shows or holds (anything but reading the map)? */
export const screenActionWrites = (action) => action !== 'map';
