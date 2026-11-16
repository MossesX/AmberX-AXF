/**
 * Claude settings views (claude-settings-view@1, pure; web, CLI and tests share it).
 *
 * Two views of the same settings: `classic` (one page, collapsible sections) and `tabbed` (a tab-group@1 row). Tabbed
 * also picks where the row sits and what its tabs show. Saved per device, so the phone and the desktop differ.
 * Tabs come from the open registry (`tabs`, each listing its groups); a group no tab names lands in Other, so a new
 * group added as data is never lost.
 */
export const VIEW_FRAME = 'claude-settings-view@1';
export const MODES = ['classic', 'tabbed'];
export const POSITIONS = ['top', 'bottom', 'left', 'right'];
export const LABELS = ['both', 'words', 'icons'];
export const DEFAULT_VIEW = { mode: 'tabbed', position: 'top', labels: 'both', tab: '' };
/** The tab-group row's settings id: its position and display are that row's own overrides (chrome-settings@1). */
export const TAB_GROUP_ID = 'claude-settings.tabs';
/** Labels → tab-group@1 `display`, and back (the right-click settings write `display`). */
export const LABEL_DISPLAY = { both: 'both', words: 'text', icons: 'icons' };
export const displayLabel = (display) => Object.keys(LABEL_DISPLAY).find((k) => LABEL_DISPLAY[k] === display) ?? 'both';

/** Device ids are short and safe in a URL, a CLI flag and a JSON key. */
export const deviceOk = (d) => typeof d === 'string' && /^[A-Za-z0-9][\w.-]{0,63}$/.test(d);

/** Every field at a value the views know; anything else falls back to the default. */
export function normView(v) {
  const o = v && typeof v === 'object' ? v : {};
  const pick = (k, list) => (list.includes(o[k]) ? o[k] : DEFAULT_VIEW[k]);
  return { mode: pick('mode', MODES), position: pick('position', POSITIONS), labels: pick('labels', LABELS), tab: typeof o.tab === 'string' ? o.tab.slice(0, 40) : '' };
}

/** A patch's problem in plain words, or '' when it is fine. */
export function viewProblem(patch) {
  const lists = { mode: MODES, position: POSITIONS, labels: LABELS };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'tab') { if (typeof v !== 'string' || v.length > 40) return 'tab: a tab id'; continue; }
    if (!lists[k]) return `no view setting ${k} (mode, position, labels, tab)`;
    if (!lists[k].includes(v)) return `${k}: ${JSON.stringify(v)} is not one of ${lists[k].join(', ')}`;
  }
  return '';
}

/**
 * The tabs to draw: registry order, only tabs with something in them, each with its groups in registry order.
 * Groups no tab lists go in Other. → [{ id, label, icon, description, groups: [group…], count, always? }]
 */
export function tabsFor(groups, tabs, settings) {
  const count = (id) => settings.filter((s) => s.group === id).length;
  const named = new Set((tabs ?? []).flatMap((t) => t.groups ?? []));
  const out = (tabs ?? []).map((t) => {
    const gs = (t.groups ?? []).map((id) => groups.find((g) => g.id === id)).filter(Boolean);
    return { id: t.id, label: t.label, icon: t.icon, description: t.description ?? '', always: t.always === true, groups: gs, count: gs.reduce((n, g) => n + count(g.id), 0) };
  }).filter((t) => t.always || t.count > 0);
  const rest = groups.filter((g) => !named.has(g.id) && count(g.id) > 0);
  if (rest.length) out.push({ id: 'other', label: 'Other', icon: 'more', description: 'Settings no tab lists yet.', always: false, groups: rest, count: rest.reduce((n, g) => n + count(g.id), 0) });
  return out;
}

/** Does a setting match the find box (label, key or description, any case)? */
export function matches(s, q) {
  const t = String(q ?? '').trim().toLowerCase();
  return !t || `${s.label} ${s.key} ${s.description}`.toLowerCase().includes(t);
}
