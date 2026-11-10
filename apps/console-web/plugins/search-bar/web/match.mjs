/**
 * Search bar matcher (pure, no DOM): the plugin's own logic, used whenever AI ranking is off.
 *
 *   options   { mode: 'words' | 'prefix' | 'exact' | 'regex', caseSensitive, details, perCategory, total }
 *   scope     'everything' (globe) | 'settings' (gear)
 *
 * matchEntries(entries, query, options, scope) → ranked hits; groupHits(hits) → categories with a tree each;
 * quickOptions(spec, value) → what a right-click offers for one setting; submenuSide(...) → where the sub-menu opens.
 */

/** Categories in the order the drop-down's left column lists them; `kinds` are SearchEntry kinds. */
export const CATEGORIES = [
  { id: 'settings', label: 'Settings', icon: 'settings', kinds: ['setting', 'settings-tab'] },
  { id: 'plugins', label: 'Plugins', icon: 'package', kinds: ['plugin'] },
  { id: 'pages', label: 'Pages', icon: 'layout', kinds: ['view'] },
  { id: 'actions', label: 'Actions & menus', icon: 'zap', kinds: ['action', 'menu'] },
  { id: 'windows', label: 'Windows & dialogs', icon: 'monitor', kinds: ['dialog', 'window'] },
  { id: 'looks', label: 'Looks & assets', icon: 'palette', kinds: ['asset'] },
  { id: 'plan', label: 'Plan & builds', icon: 'layers', kinds: ['feature', 'framework-feature', 'pending'] },
  { id: 'page-text', label: 'On the page', icon: 'type', kinds: ['text'] },
];
export const OTHER_CATEGORY = { id: 'other', label: 'Other', icon: 'search', kinds: [] };

export const SCOPES = ['everything', 'settings'];
export const MODES = ['words', 'prefix', 'exact', 'regex'];
export const DEFAULT_OPTIONS = Object.freeze({ mode: 'words', caseSensitive: false, details: true, perCategory: 25, total: 200 });

/** Normalized options (unknown values fall back to the defaults; numbers clamped). */
export function normOptions(o) {
  const n = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  return {
    mode: MODES.includes(o?.mode) ? o.mode : DEFAULT_OPTIONS.mode,
    caseSensitive: o?.caseSensitive === true,
    details: o?.details !== false,
    perCategory: n(o?.perCategory, 1, 100, DEFAULT_OPTIONS.perCategory),
    total: n(o?.total, 1, 1000, DEFAULT_OPTIONS.total),
  };
}

export function categoryOf(kind) {
  return CATEGORIES.find((c) => c.kinds.includes(kind)) ?? OTHER_CATEGORY;
}

/** Does an entry belong to a scope? The gear scope keeps settings only. */
export function inScope(entry, scope) {
  return scope === 'settings' ? entry.kind === 'setting' || entry.kind === 'settings-tab' : true;
}

const fold = (s, cs) => {
  const t = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return cs ? t : t.toLowerCase();
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compile a query into a tester: (label, rest) → score (0 = no match). A bad regular expression gives
 * `{ error }` and no tester, so the UI can say why nothing matches instead of throwing.
 */
export function compileQuery(query, options) {
  const o = normOptions(options);
  const q = String(query ?? '');
  if (!q.trim()) return { test: null, error: '' };
  if (o.mode === 'regex') {
    let re;
    try { re = new RegExp(q, o.caseSensitive ? 'u' : 'iu'); } catch (e) { return { test: null, error: String(e?.message ?? e) }; }
    return {
      error: '',
      test: (label, rest) => {
        const m = re.exec(label);
        if (m) return 70 + (m.index === 0 ? 20 : 0) - Math.min(label.length, 60) / 60;
        return o.details && re.test(rest) ? 10 : 0;
      },
    };
  }
  const full = fold(q.trim(), o.caseSensitive);
  if (o.mode === 'exact') {
    return { error: '', test: (label, rest) => {
      const l = fold(label, o.caseSensitive);
      if (l === full) return 100;
      if (l.includes(full)) return 50 - Math.min(l.length, 60) / 60;
      return o.details && fold(rest, o.caseSensitive).includes(full) ? 10 : 0;
    } };
  }
  const words = full.split(/\s+/).filter(Boolean);
  return {
    error: '',
    test: (label, rest) => {
      const l = fold(label, o.caseSensitive);
      const r = o.details ? fold(rest, o.caseSensitive) : '';
      let score = 0;
      for (const w of words) {
        let s = 0;
        const wordStart = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}`, 'u').test(l);
        if (l === w) s = 100;
        else if (l.startsWith(w)) s = 60;
        else if (wordStart) s = 40;
        else if (o.mode === 'words' && l.includes(w)) s = 25;
        else if (o.mode === 'words' ? r.includes(w) : new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}`, 'u').test(r)) s = 10;
        if (!s) return 0;
        score += s;
      }
      if (words.length > 1 && l.includes(full)) score += 30;
      return score - Math.min(l.length, 60) / 60;
    },
  };
}

/** Rank entries for a query in a scope. Returns { hits, error }. Hits keep the entry and add score + category. */
export function matchEntries(entries, query, options, scope = 'everything') {
  const o = normOptions(options);
  const { test, error } = compileQuery(query, o);
  if (!test) return { hits: [], error };
  const hits = [];
  for (const e of entries) {
    if (!inScope(e, scope)) continue;
    const rest = [e.detail ?? '', ...(e.keywords ?? [])].join(' ');
    const score = test(e.label ?? '', rest);
    if (score > 0) hits.push({ ...e, score, category: categoryOf(e.kind).id });
  }
  hits.sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label)));
  return { hits: hits.slice(0, o.total), error: '' };
}

/** Split a result's "where" (`Settings › Appearance › Fonts`) into tree steps; the category name itself is dropped. */
export function pathOf(hit, categoryLabel) {
  const parts = String(hit.detail ?? '').split(/\s*[›>]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length && (parts[0] === categoryLabel || /^settings$/i.test(parts[0]))) parts.shift();
  // a one-word kind label as the detail ("Page", "Action") adds nothing to the tree
  return parts.length === 1 && /^(page|action|dialog|window|plugin.*|setting)$/i.test(parts[0]) ? [] : parts.slice(0, 3);
}

/**
 * Group ranked hits by category, each with a tree: nodes { id, label, children, hits }. Categories keep the
 * CATEGORIES order (best first inside); each category holds at most `perCategory` hits.
 */
export function groupHits(hits, options) {
  const o = normOptions(options);
  const byCat = new Map();
  for (const h of hits) {
    const c = categoryOf(h.kind);
    if (!byCat.has(c.id)) byCat.set(c.id, { ...c, count: 0, root: { id: c.id, label: c.label, children: [], hits: [] } });
    const g = byCat.get(c.id);
    g.count += 1;
    if (g.count > o.perCategory) continue;
    let node = g.root;
    for (const step of pathOf(h, c.label)) {
      let next = node.children.find((n) => n.label === step);
      if (!next) { next = { id: `${node.id}/${step}`, label: step, children: [], hits: [] }; node.children.push(next); }
      node = next;
    }
    node.hits.push(h);
  }
  const order = [...CATEGORIES, OTHER_CATEGORY].map((c) => c.id);
  return [...byCat.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Hits of a tree in display order (keyboard moves through this list). */
export function flatten(node, out = []) {
  for (const h of node.hits) out.push(h);
  for (const c of node.children) flatten(c, out);
  return out;
}

/**
 * What right-click offers for one setting: [{ value, label, checked }] plus `multi` for multi-choice.
 * Toggle → On / Off; choice → its options; multi_choice → each option ticked or not. Anything else → null
 * (it has no quick options; the menu then offers Open only).
 */
export function quickOptions(spec, value) {
  if (!spec) return null;
  if (spec.kind === 'toggle') return { multi: false, items: [{ value: true, label: 'On', checked: value === true }, { value: false, label: 'Off', checked: value !== true }] };
  const opts = Array.isArray(spec.options) ? spec.options : [];
  if (spec.kind === 'choice' && opts.length) return { multi: false, items: opts.map((x) => ({ value: x.value, label: x.label ?? x.value, checked: value === x.value })) };
  if (spec.kind === 'multi_choice' && opts.length) {
    const cur = Array.isArray(value) ? value : [];
    return { multi: true, items: opts.map((x) => ({ value: x.value, label: x.label ?? x.value, checked: cur.includes(x.value) })) };
  }
  return null;
}

/** The new value after picking `item` from a quick menu (multi-choice toggles that option in the list). */
export function pickValue(spec, current, item) {
  if (spec?.kind !== 'multi_choice') return item.value;
  const cur = Array.isArray(current) ? current : [];
  return cur.includes(item.value) ? cur.filter((v) => v !== item.value) : [...cur, item.value];
}

/** Parse a CLI / voice value for a setting ("on", "off", "true", a choice value or label, "a,b" for multi). */
export function parseValue(spec, raw) {
  const s = String(raw ?? '').trim();
  if (!spec || spec.kind === 'toggle') {
    if (/^(on|true|yes|1|enable|enabled)$/i.test(s)) return true;
    if (/^(off|false|no|0|disable|disabled)$/i.test(s)) return false;
    return spec ? undefined : s;
  }
  const opts = Array.isArray(spec.options) ? spec.options : [];
  const one = (t) => opts.find((x) => x.value === t || String(x.label).toLowerCase() === t.toLowerCase())?.value;
  if (spec.kind === 'choice') return one(s);
  if (spec.kind === 'multi_choice') { const vs = s.split(',').map((t) => one(t.trim())); return vs.every((v) => v !== undefined) ? vs : undefined; }
  if (spec.kind === 'number' || spec.kind === 'slider') { const n = Number(s); return Number.isFinite(n) ? n : undefined; }
  return s;
}

/** Open a sub-menu on the right of the row when it fits, else on the left. */
export function submenuSide(rowRight, rowLeft, menuWidth, viewportWidth, margin = 8) {
  if (rowRight + menuWidth + margin <= viewportWidth) return 'right';
  if (rowLeft - menuWidth - margin >= 0) return 'left';
  return viewportWidth - rowRight >= rowLeft ? 'right' : 'left';
}

/** AI is used only when an Ollama connection exists AND AI assistance is on (plugin setting + the AI capability). */
export function aiActive({ ollama, capability, enabled }) {
  return !!(ollama && capability && enabled);
}

/** Reorder hits by the ids an AI ranker returned (unknown ids ignored, the rest keep their order after). */
export function applyRanking(hits, ids) {
  if (!Array.isArray(ids) || !ids.length) return hits;
  const pos = new Map(ids.map((id, i) => [id, i]));
  return [...hits].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
}
