/**
 * Tab control (tab-control@1; build tabs-api-control, Brett Nov 8 2026: "Agents can open a screen but can't switch its
 * tabs … Fix in the framework so every tab and tab group in every app is API/voice/MCP controllable").
 *
 * Pure (no IO, no DOM): how a path like "build-orchestrator/pipeline" or "Settings › Appearance › Colours" is split, and
 * which registered tab group / section a part names. The React layer (framework/react/tabControl.ts) keeps the live
 * registry (every mounted TabGroup and titled Container registers itself) and runs it; console-commands@1 and the deep
 * link `?axf-open=<path>` call into it.
 *
 *   target  { kind: 'tab-group' | 'section', id, screen?, label, tabs?: [{ value, label }] }
 *   path    screen/tab[/sub-tab…]   — '/', ' > ' and '›' all separate; each part is an id or a label (case and
 *                                     punctuation folded); a part may also be `<group id>:<tab>` to name the row
 *   actions tab.open:<path>          (one, params) and tab.<group>.<tab> (one per tab the console has seen; navigate only)
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const TAB_CONTROL_FRAME = 'tab-control@1';
/** The action that opens any screen/tab path (params: the path). */
export const TAB_OPEN_ACTION = 'tab.open';
/** Per-tab action ids start with this. */
export const TAB_ACTION_PREFIX = 'tab.';
/** The deep-link query parameter: `?axf-open=build-orchestrator/pipeline`. */
export const TAB_DEEP_LINK_PARAM = 'axf-open';
/** How long an open waits for a tab row to mount after the screen (or the tab before it) changed. */
export const TAB_WAIT_MS = 4000;

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** "a/b", "a > b", "a › b", "a » b" → ['a', 'b'] (empty parts dropped). */
export function splitTabPath(path) {
  return String(path ?? '').split(/\s*(?:\/|›|»|\s>\s)\s*/).map((p) => p.trim()).filter(Boolean);
}

/** The per-tab action id: `tab.<group>.<value>`, with anything an action spec can't hold (':' and spaces) folded to '-'. */
export function tabActionId(groupId, value) {
  const clean = (s) => String(s ?? '').trim().replace(/[:\s]+/g, '-');
  return `${TAB_ACTION_PREFIX}${clean(groupId)}.${clean(value)}`;
}

/** The tab a word names in one row: exact value, folded value, folded label, then a label/value that starts with it. → value | null */
export function matchTab(tabs, want) {
  const list = Array.isArray(tabs) ? tabs.filter((t) => t && typeof t.value === 'string') : [];
  const raw = String(want ?? '').trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  const f = fold(raw);
  const hit = list.find((t) => t.value === raw) ?? list.find((t) => t.value.toLowerCase() === low)
    ?? list.find((t) => fold(t.value) === f) ?? list.find((t) => fold(t.label) === f)
    ?? (f ? list.find((t) => fold(t.label).startsWith(f) || fold(t.value).startsWith(f)) : undefined);
  return hit ? hit.value : null;
}

/** Does a target's own id or label name this word (for `group:tab` and sections)? */
const namesTarget = (t, word) => {
  const f = fold(word);
  return !!f && (t.id.toLowerCase() === String(word).trim().toLowerCase() || fold(t.id) === f || fold(t.label) === f || fold(t.id).endsWith(` ${f}`));
};

/**
 * Which registered target one path part names, preferring targets on `screen`, then the newest. Tab rows first (a tab
 * of a row), then sections (a titled Container by its title). `part` may be `<group id>:<tab>`.
 * → { target, value } (value = the tab for a row, null for a section) or null.
 */
export function pickTabTarget(targets, part, { screen } = {}) {
  const list = (Array.isArray(targets) ? targets : []).filter((t) => t && typeof t.id === 'string');
  const order = [...list].reverse().sort((a, b) => (screen && b.screen === screen ? 1 : 0) - (screen && a.screen === screen ? 1 : 0));
  const raw = String(part ?? '').trim();
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const g = raw.slice(0, colon), tab = raw.slice(colon + 1);
    for (const t of order) if (t.kind === 'tab-group' && namesTarget(t, g)) { const v = matchTab(t.tabs, tab); if (v !== null) return { target: t, value: v }; }
  }
  // exact (value / label) hits in any row beat a prefix hit in a nearer one
  for (const exact of [true, false]) {
    for (const t of order) {
      if (t.kind !== 'tab-group') continue;
      const v = matchTab(t.tabs, raw);
      if (v === null) continue;
      const tab = t.tabs.find((x) => x.value === v);
      if (!exact || fold(tab?.label) === fold(raw) || v.toLowerCase() === raw.toLowerCase() || fold(v) === fold(raw)) return { target: t, value: v };
    }
  }
  for (const t of order) if (t.kind === 'section' && namesTarget(t, raw)) return { target: t, value: null };
  return null;
}

/** A target as an action/catalog entry lists it (only rows with tabs give per-tab actions). */
export function tabActionsOf(target, screenLabel = '') {
  if (!target || target.kind !== 'tab-group' || !Array.isArray(target.tabs)) return [];
  const where = screenLabel || target.label || target.id;
  return target.tabs.map((t) => ({
    id: tabActionId(target.id, t.value),
    label: `${where} › ${t.label}`,
    path: `${target.screen ? `${target.screen}/` : ''}${target.id}:${t.value}`,
  }));
}

/** A clean target (unknown fields dropped), or null. */
export function normalizeTabTarget(raw) {
  if (!raw || typeof raw !== 'object' || !['tab-group', 'section'].includes(raw.kind)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 160) : '';
  if (!id) return null;
  const out = { kind: raw.kind, id, label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 160) : id };
  if (typeof raw.screen === 'string' && raw.screen) out.screen = raw.screen.slice(0, 120);
  if (raw.kind === 'tab-group') out.tabs = (Array.isArray(raw.tabs) ? raw.tabs : []).filter((t) => t && typeof t.value === 'string' && t.value).slice(0, 100).map((t) => ({ value: t.value.slice(0, 120), label: typeof t.label === 'string' && t.label ? t.label.slice(0, 120) : t.value }));
  return out;
}
