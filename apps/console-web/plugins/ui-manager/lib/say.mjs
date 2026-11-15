/**
 * What a person says to the UI Manager, as steps: "select the main toolbar, set its transparency to 80" →
 * [{ op: 'select', what: 'main toolbar' }, { op: 'set', prop: 'transparency', value: '80' }]. Voice (AmberX), the CLI,
 * REST and MCP all hand the words to core.say(), which runs these steps with the same set / reset as everything else.
 * Pure: no IO. Element and property words are matched by score, never guessed when nothing matches.
 */

const FILLER = new Set(['the', 'a', 'an', 'its', 'it', 'this', 'that', 'of', 'please', 'my', 'element', 'ui', 'manager', 'in', 'on', 'for']);
/** Words that mark the primary instance of something ("the main toolbar"): they rank, they do not have to match. */
const SOFT = new Set(['main', 'primary', 'top', 'console', 'app']);
export const VIEW_WORDS = { row: 'row', rows: 'row', expanding: 'row', panel: 'panel', side: 'panel', grid: 'grid', cards: 'grid' };

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9%@.#-]+/g, ' ').split(' ').filter((w) => w && !FILLER.has(w));

/** Split into clauses and read each one. Unknown clauses are returned as { op: 'unknown', text } so callers can say so. */
export function parseSay(text) {
  const clauses = String(text ?? '').slice(0, 500).split(/\s*(?:[,;.]|\band then\b|\bthen\b|\band\b(?=\s+(?:set|select|open|reset|show|pick|make|change|use)\b))\s*/i).map((c) => c.trim()).filter(Boolean);
  const out = [];
  for (const c of clauses) {
    let m;
    if ((m = c.match(/^(?:switch|change)?\s*(?:to\s+)?(?:the\s+)?(row|rows|expanding|panel|side|grid|cards)\s+view$/i) || c.match(/^(?:use|show)\s+(?:the\s+)?(row|panel|grid|cards|side)\s*(?:view)?$/i))) out.push({ op: 'view', view: VIEW_WORDS[m[1].toLowerCase()] });
    else if ((m = c.match(/^(?:reset|undo changes (?:to|on))\s+(?:(.+?)\s+(?:of|on)\s+)?(.+)$/i))) out.push(m[1] ? { op: 'reset', prop: m[1], what: m[2] } : { op: 'reset', what: m[2] });
    else if ((m = c.match(/^(?:set|make|change|put)\s+(.+?)\s+(?:to|=|at)\s+(.+)$/i))) {
      const [, raw, value] = m;
      const lhs = raw.replace(/^(?:its|the|their)\s+/i, '');
      const of = lhs.match(/^(.+?)\s+(?:of|on|for)\s+(.+)$/i);
      out.push(of ? { op: 'set', prop: of[1], what: of[2], value: value.trim() } : { op: 'set', prop: lhs, value: value.trim() });
    } else if ((m = c.match(/^(?:select|open|show|pick|find|go to|inspect)\s+(.+)$/i))) out.push({ op: 'select', what: m[1] });
    else out.push({ op: 'unknown', text: c });
  }
  return out;
}

/**
 * The element words name, best first: every hard word must appear in the label, kind, id, category or plugin; the label
 * scores higher than the id; an exact label wins; framework slots (asset:) before live targets at a tie.
 */
export function rankElements(elements, what) {
  const ws = words(what);
  const hard = ws.filter((w) => !SOFT.has(w));
  if (!ws.length) return [];
  const scored = [];
  for (const e of elements) {
    const label = String(e.label ?? '').toLowerCase();
    const hay = [label, e.kind, e.id, e.category, e.plugin ?? ''].join(' ').toLowerCase();
    if (!(hard.length ? hard : ws).every((w) => hay.includes(w.replace(/s$/, '')))) continue;
    let s = 0;
    for (const w of ws) s += label.split(/\s+/).includes(w) ? 4 : label.includes(w) ? 3 : String(e.kind).toLowerCase() === w ? 2 : hay.includes(w) ? 1 : 0;
    if (label === ws.join(' ') || label === hard.join(' ')) s += 6;
    if (String(e.id).startsWith('asset:')) s += 1;
    scored.push({ e, s: s - label.length / 1000 });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.e);
}

/** The property words name: exact id / label, then every word in the label / id / token. */
export function rankProps(props, what) {
  const q = String(what ?? '').toLowerCase().trim();
  const ws = words(q);
  if (!ws.length) return [];
  const exact = props.filter((p) => p.id.toLowerCase() === q || p.label.toLowerCase() === q);
  if (exact.length) return exact;
  return props
    .map((p) => ({ p, hay: `${p.label} ${p.id} ${p.token ?? ''} ${p.group}`.toLowerCase() }))
    .filter((x) => ws.every((w) => x.hay.includes(w)))
    .sort((a, b) => Number(b.p.label.toLowerCase().startsWith(ws[0])) - Number(a.p.label.toLowerCase().startsWith(ws[0])) || a.p.label.length - b.p.label.length)
    .map((x) => x.p);
}

/** The choice a spoken value means: a number for ranges ("80", "80%"), else the option whose value or label matches. */
export function pickValue(prop, said) {
  const s = String(said ?? '').trim().toLowerCase().replace(/\s*(?:percent|%)$/, '');
  if (prop.kind === 'bool') return /^(on|yes|true|show|visible|shown|enabled?)$/.test(s) ? true : /^(off|no|false|hide|hidden|disabled?)$/.test(s) ? false : said;
  if (prop.kind === 'range' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const o = prop.options.find((x) => String(x.value).toLowerCase() === s || String(x.value).toLowerCase() === `@${s.replace(/\s+/g, '')}` || x.label.toLowerCase() === s)
    ?? prop.options.find((x) => x.label.toLowerCase().includes(s));
  return o ? o.value : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : said;
}
