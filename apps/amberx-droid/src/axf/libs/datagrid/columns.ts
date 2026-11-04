/**
 * Column visibility for every DataGrid (grid-columns@1, Brett Nov 4 2026: "Every grid needs to be able to hide columns.
 * If you right-click on the column, you can select which ones to hide. And every grid, framework wide.").
 *
 * Pure (no React, no DOM). A grid's columns say which can't be hidden (`fixed`) and which start hidden (`hidden`); the
 * user's choice is saved as a list of changes from those defaults, `-<col>` (hidden though shown by default) and
 * `+<col>` (shown though hidden by default), under settings key `axf.grid.<grid id>.columns`. Saving changes instead of
 * the full list means a column added later still starts the way its grid declares it, and Reset is just "no changes".
 * Values live in the app's settings store (localStorage): per app, per device and browser profile, never in the shared
 * axHub look.
 */

export interface ColumnDef { id: string; label: string; fixed?: boolean; hidden?: boolean }

export const GRID_COLUMNS_FRAME = 'grid-columns@1';
export const gridColumnsKey = (grid: string) => `axf.grid.${grid}.columns`;

/** Clean a saved value: only `-id` / `+id` strings, no repeats, last change per column wins. */
export function normalizeColumnChanges(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  const by = new Map<string, string>();
  for (const v of saved) if (typeof v === 'string' && /^[+-]./.test(v)) by.set(v.slice(1), v);
  return [...by.values()];
}

/** The columns hidden now: the grid's defaults (plus `extraHidden`), with the saved changes on top. Fixed columns never hide. */
export function hiddenColumns(cols: readonly ColumnDef[], saved: unknown, extraHidden: readonly string[] = []): string[] {
  const ch = new Map(normalizeColumnChanges(saved).map((v) => [v.slice(1), v[0]]));
  return cols.filter((c) => {
    if (c.fixed) return false;
    const def = !!c.hidden || extraHidden.includes(c.id);
    const d = ch.get(c.id);
    return d === '-' ? true : d === '+' ? false : def;
  }).map((c) => c.id);
}

/** The saved changes after showing / hiding one column (`show` omitted = toggle). Unknown or fixed columns change nothing. */
export function setColumn(cols: readonly ColumnDef[], saved: unknown, col: string, show?: boolean, extraHidden: readonly string[] = []): string[] {
  const c = cols.find((x) => x.id === col);
  const now = normalizeColumnChanges(saved);
  if (!c || c.fixed) return now;
  const isHidden = hiddenColumns(cols, now, extraHidden).includes(col);
  const want = show ?? isHidden; // toggle: hidden → show
  const def = !(!!c.hidden || extraHidden.includes(col)); // shown by default?
  const rest = now.filter((v) => v.slice(1) !== col);
  return want === def ? rest : [...rest, `${want ? '+' : '-'}${col}`];
}

/** Every column shown (the changes that show each default-hidden one, none that hide). */
export function showAllColumns(cols: readonly ColumnDef[], extraHidden: readonly string[] = []): string[] {
  return cols.filter((c) => !c.fixed && (c.hidden || extraHidden.includes(c.id))).map((c) => `+${c.id}`);
}

/** Has the user changed anything from the grid's defaults? */
export const columnsChanged = (saved: unknown) => normalizeColumnChanges(saved).length > 0;

/** Fold words for matching a grid or column a person names ("the cost column in Build manager"). */
const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const FILLER = new Set(['the', 'a', 'an', 'column', 'columns', 'grid', 'table', 'in', 'on', 'of', 'my']);
const words = (s: string) => fold(s).split(' ').filter((w) => w && !FILLER.has(w));

/** The one item a name points at: exact id, exact label, then the only (or clearly best) word match. */
export function matchByName<T extends { id: string; label: string }>(items: readonly T[], name: string): T | null {
  const q = String(name ?? '').trim();
  if (!q) return null;
  const low = q.toLowerCase();
  const exact = items.find((i) => i.id.toLowerCase() === low) ?? items.find((i) => fold(i.label) === fold(q));
  if (exact) return exact;
  const ws = words(q);
  if (!ws.length) return null;
  const score = (i: T) => {
    const hay = ` ${fold(`${i.label} ${i.id}`)} `;
    let s = 0;
    for (const w of ws) { if (hay.includes(` ${w} `)) s += 2; else if (hay.includes(w)) s += 1; else return 0; }
    return s;
  };
  const hits = items.map((i) => [i, score(i)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const [best, next] = hits;
  return best && (!next || best[1] > next[1]) ? best[0] : null;
}
