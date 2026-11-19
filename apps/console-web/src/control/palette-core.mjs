/**
 * Command palette rules, the pure part (the palette: ./SearchPalette.tsx; tests: scripts/palette.test.mjs).
 *
 *   listable(hit, meta)   never list a decision (approve / deny / reject / veto …, Brett's own tap) or an owner-only
 *                         setting; meta = what the inventory knows about the address (personOnly, ownerRaise, locked)
 *   destructive(hit, meta) a press that deletes, resets or clears: the palette asks before it runs
 *   verbFor(hit)          what Enter does: press a function or button (with its argument), focus everything else
 *   pushRecent / withRecentFirst   the last picks (per browser), listed first and shown on an empty field
 *   paletteLook(id)       the palette's dialog asset (Settings → Console → Command palette; three options)
 */

export const DECIDING_RE = /(^|[.:_-])(approve|deny|reject|veto|shelve|decide|sign-?off)([.:_-]|$)/i;
export const DESTRUCTIVE_RE = /(^|[.:_-])(delete|remove|purge|wipe|reset|uninstall|drop|clear|discard|revoke|destroy|erase|kill|force-?push|hard-?delete)([.:_-]|$)/i;
export const RECENT_MAX = 8;
export const PALETTE_LOOKS = ['command-palette', 'command-palette-sheet', 'command-palette-drawer'];
export const PALETTE_LOOK_KEY = 'console.palette.look';
export const PALETTE_RECENT_KEY = 'axf.palette.recent';

const leafOf = (address) => String(address ?? '').split('/').pop() ?? '';
const idOf = (address) => { const l = leafOf(address); const at = l.indexOf(':'); return at < 0 ? l : l.slice(at + 1); };

/** May the palette show it? */
export function listable(hit, meta = null) {
  if (!hit || !hit.address) return false;
  const word = `${idOf(hit.address)}${hit.value !== undefined ? `:${hit.value}` : ''}`;
  if ((hit.kind === 'function' || hit.kind === 'button') && (DECIDING_RE.test(word) || meta?.personOnly)) return false;
  if (hit.kind === 'setting' && (meta?.personOnly || meta?.ownerRaise || meta?.locked)) return false;
  return true;
}

/** Does Enter need a confirm first? */
export function destructive(hit, meta = null) {
  if (!hit || (hit.kind !== 'function' && hit.kind !== 'button')) return false;
  return !!(meta?.destructive || DESTRUCTIVE_RE.test(`${idOf(hit.address)}${hit.value !== undefined ? `:${hit.value}` : ''}`));
}

/** The console-control verb Enter sends. */
export const verbFor = (hit) => (hit.kind === 'function' || hit.kind === 'button' ? 'press' : 'focus');

const keyOf = (h) => `${h.address}\u0000${h.value ?? ''}`;

/** The recent list with this pick in front (newest first, no repeats, capped). */
export function pushRecent(list, hit) {
  const entry = { address: hit.address, kind: hit.kind, label: hit.label, ...(hit.detail ? { detail: hit.detail } : {}), ...(hit.icon ? { icon: hit.icon } : {}), ...(hit.value !== undefined ? { value: hit.value } : {}) };
  return [entry, ...(Array.isArray(list) ? list : []).filter((x) => x && keyOf(x) !== keyOf(entry))].slice(0, RECENT_MAX);
}

/** Hits with the recent ones first (in recent order), each marked `recent: true`; the rest keep their ranking. */
export function withRecentFirst(hits, recent) {
  const order = new Map((recent ?? []).map((r, i) => [keyOf(r), i]));
  const first = hits.filter((h) => order.has(keyOf(h))).sort((a, b) => order.get(keyOf(a)) - order.get(keyOf(b))).map((h) => ({ ...h, recent: true }));
  return [...first, ...hits.filter((h) => !order.has(keyOf(h)))];
}

/** A picked look id, else the default. */
export const paletteLook = (id) => (PALETTE_LOOKS.includes(id) ? id : PALETTE_LOOKS[0]);
