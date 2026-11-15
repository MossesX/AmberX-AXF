/**
 * Shipped features table (shipped-table@1): the one projection behind the grid, the REST route (GET /table), the MCP
 * tool, the CLI (`ledger.mjs table`) and voice. Pure: a feature-ledger@1 document (+ manifest summaries) in, rows out.
 *
 *   toRows(ledger, manifests)          one row per feature, repeated rows folded (same area + name): { rows, folded }
 *   normTableView(v)                   the remembered view: group, multi-sort, columns (shown + order), search, chips
 *   filterRows / sortRows / groupRows  what the view does to the rows (same order on every surface)
 *   tableOf(ledger, manifests, view)   all of it: { view, rows, groups, count, total, folded, columns }
 *   toCsv(rows, columns)               the shown columns in the shown order
 *
 * Status is the shipped state Brett asked for: live, behind a switch, partial (landed, not deployed), in progress,
 * removed. "How to reach it" is read from the feature's tags (api, rest, mcp, cli, voice, deeplink) and, failing that,
 * from the files it touched (plugin.json commands = REST + MCP + voice, server/ = REST, cli/ = CLI, web/ = deep link).
 */
import * as L from '../../../../../framework/core/feature-ledger.mjs';

export const SCHEMA = 'shipped-table@1';
export const SHIP_STATUSES = ['live', 'switch', 'partial', 'pending', 'removed'];
export const SHIP_STATUS_LABEL = Object.freeze({ live: 'Live', switch: 'Behind a switch', partial: 'Partial', pending: 'In progress', removed: 'Removed' });
/** Tone of the shared status badge (the framework Chip tones the Pending tab uses). */
export const SHIP_STATUS_TONE = Object.freeze({ live: 'success', switch: 'accent', partial: 'warning', pending: undefined, removed: 'danger' });
export const REACH = ['deeplink', 'rest', 'mcp', 'cli', 'voice'];
export const REACH_LABEL = Object.freeze({ deeplink: 'Deep link', rest: 'REST', mcp: 'MCP', cli: 'CLI', voice: 'Voice' });
export const GROUP_BY = ['area', 'date', 'build', 'pr', 'status', 'none'];
export const GROUP_LABEL = Object.freeze({ area: 'Plugin / area', date: 'Date', build: 'Build', pr: 'PR', status: 'Status', none: 'No groups' });

/** Every column, in the default order. `sort` = sortable; `text` = the CSV / search value. */
export const COLUMNS = Object.freeze([
  { id: 'name', label: 'Feature', fixed: true }, { id: 'area', label: 'Plugin / area' }, { id: 'description', label: 'Description' },
  { id: 'status', label: 'Status' }, { id: 'build', label: 'Build' }, { id: 'pr', label: 'PR' }, { id: 'commit', label: 'Commit' },
  { id: 'shipped', label: 'Shipped' }, { id: 'onMain', label: 'On main' }, { id: 'deployed', label: 'Deployed' }, { id: 'reach', label: 'How to reach it' },
  { id: 'settings', label: 'Settings key' }, { id: 'help', label: 'Help' }, { id: 'version', label: 'Version' }, { id: 'asked', label: 'Who asked' }, { id: 'tests', label: 'Tests' },
]);
export const COLUMN_IDS = COLUMNS.map((c) => c.id);
/** Shown at first (the rest are one tap away in the column picker). */
export const DEFAULT_HIDDEN = ['description', 'commit', 'settings', 'help', 'version', 'asked'];
export const DEFAULT_VIEW = Object.freeze({ by: 'area', sorts: [{ col: 'shipped', dir: 'desc' }], hidden: DEFAULT_HIDDEN, order: COLUMN_IDS, search: '', plugins: [], statuses: [], from: '', to: '', hasApi: false, notDeployed: false, collapsed: [], expanded: [] });

const list = (v) => (Array.isArray(v) ? v : []);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const uniq = (a) => [...new Set(a)];
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? v.slice(0, 10) : '');

export function normTableView(v) {
  const o = v && typeof v === 'object' ? v : {};
  const sorts = list(o.sorts).map((s) => ({ col: str(s?.col, 40), dir: s?.dir === 'asc' ? 'asc' : 'desc' })).filter((s) => COLUMN_IDS.includes(s.col));
  const order = uniq([...list(o.order).filter((c) => COLUMN_IDS.includes(c)), ...COLUMN_IDS]);
  return {
    by: GROUP_BY.includes(o.by) ? o.by : DEFAULT_VIEW.by,
    sorts: uniq(sorts.map((s) => s.col)).map((c) => sorts.find((s) => s.col === c)).slice(0, 4),
    hidden: Array.isArray(o.hidden) ? uniq(o.hidden.filter((c) => COLUMN_IDS.includes(c) && c !== 'name')) : [...DEFAULT_HIDDEN],
    order: ['name', ...order.filter((c) => c !== 'name')],
    search: str(o.search), plugins: uniq(list(o.plugins).map((p) => str(p, 80)).filter(Boolean)),
    statuses: uniq(list(o.statuses).filter((s) => SHIP_STATUSES.includes(s))),
    from: isoDay(o.from), to: isoDay(o.to), hasApi: o.hasApi === true, notDeployed: o.notDeployed === true,
    collapsed: uniq(list(o.collapsed).map((c) => str(c, 200)).filter(Boolean)), expanded: uniq(list(o.expanded).map((c) => str(c, 200)).filter(Boolean)),
  };
}

const tagSet = (f) => new Set(list(f.tags));
export function reachOf(f) {
  const t = tagSet(f); const files = list(f.files);
  const has = (re) => files.some((x) => re.test(x));
  const commands = has(/plugin\.json$/) || has(/\/control\/inventory\.json$/);
  const r = {
    deeplink: t.has('deeplink') || t.has('deep-link') || has(/\/web\/.+\.tsx$/) || has(/\/src\/.+\.tsx$/),
    rest: t.has('rest') || t.has('api') || commands || has(/\/server\//),
    mcp: t.has('mcp') || t.has('api') || commands,
    cli: t.has('cli') || has(/(^|\/)cli\/.+\.mjs$/) || has(/\/ledger\/ledger\.mjs$/),
    voice: t.has('voice') || commands,
  };
  return REACH.filter((k) => r[k]);
}
export function shipStatus(f) {
  if (f.status === 'removed' || f.status === 'cancelled') return 'removed';
  const t = tagSet(f);
  if (t.has('behind-switch') || t.has('flag') || t.has('switch') || t.has('off-by-default')) return 'switch';
  if (f.firstLiveAt || f.status === 'live') return 'live';
  if (f.mergedAt || f.status === 'merged') return 'partial';
  return 'pending';
}
const areaOf = (f) => f.plugin || (f.app ? `${f.app} (app)` : 'framework');
const rank = (f) => [f.status === 'live' ? 3 : f.status === 'merged' ? 2 : 1, f.updatedAt || '', f.rev];
const better = (a, b) => { const x = rank(a); const y = rank(b); for (let i = 0; i < x.length; i++) { if (x[i] > y[i]) return a; if (x[i] < y[i]) return b; } return a; };

/** One row per feature; features with the same area and name (repeated imports, a build and its PR) fold into one. */
export function toRows(ledger, manifests = []) {
  const prompts = new Map(list(ledger?.prompts).map((p) => [p.id, p]));
  const tests = new Map(); for (const m of list(manifests)) { const b = m.build?.id ?? m.build; if (b && !tests.has(b)) tests.set(b, m.tests ?? { pass: 0, total: 0 }); }
  const byKey = new Map(); let folded = 0;
  for (const f of list(ledger?.features)) {
    const k = `${areaOf(f).toLowerCase()}/${L.slug(f.name)}`;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { main: f, dups: [] }); continue; }
    folded++; const keep = better(prev.main, f); prev.dups.push(keep === f ? prev.main : f); prev.main = keep;
  }
  const rows = [...byKey.values()].map(({ main: f, dups }) => {
    const all = [f, ...dups];
    const prs = uniq(all.flatMap((x) => list(x.prs).map((p) => `${p.repo}#${p.number}`))).map((k) => { const [repo, n] = k.split('#'); return { repo, number: Number(n), url: L.REPOS[repo] ? `https://github.com/${L.REPOS[repo].github}/pull/${n}` : '' }; });
    const builds = uniq(all.flatMap((x) => list(x.builds).map((b) => b.id)));
    const said = list(f.prompts).map((p) => prompts.get(p.id)).filter(Boolean).sort((a, b) => a.index - b.index)[0];
    const t = builds.map((b) => tests.get(b)).filter(Boolean).reduce((a, x) => ({ pass: a.pass + (x.pass || 0), total: a.total + (x.total || 0) }), { pass: 0, total: 0 });
    const reach = uniq(all.flatMap(reachOf));
    const status = shipStatus(f);
    return {
      id: f.id, name: f.name, area: areaOf(f), plugin: f.plugin, app: f.app, description: f.description, status, ledgerStatus: f.status,
      build: builds[0] || '', builds, pr: prs[0]?.number || 0, prUrl: prs[0]?.url || '', prs,
      commit: f.mergeCommit || list(f.commits)[0] || '', shipped: f.firstLiveAt || f.mergedAt || '', shippedGuessed: !!(f.firstLiveAt ? Object.values(f.liveAt || {}).every((x) => x.guessed) : f.mergedAtGuessed),
      onMain: !!(f.mergedAt || f.status === 'merged' || f.status === 'live'), deployed: !!f.firstLiveAt, liveAt: f.liveAt || {},
      reach, hasApi: reach.some((r) => r !== 'deeplink'),
      settings: f.plugin ? `plugins.${f.plugin}` : '', help: f.links?.help || f.links?.docs || '', version: `v${f.rev || 1}`,
      asked: said?.said || '', askedVerbatim: !!said?.verbatim, tests: t, type: f.type, editCount: f.editCount,
      deepLink: `?shipped=${encodeURIComponent(f.id)}`, duplicates: dups.map((d) => d.id),
    };
  });
  return { rows, folded };
}

const CSV_TEXT = {
  status: (r) => SHIP_STATUS_LABEL[r.status], build: (r) => r.builds.join(' '), pr: (r) => r.prs.map((p) => `${p.repo === 'amberx-axf' ? '' : p.repo}#${p.number}`).join(' '),
  shipped: (r) => (r.shipped ? `${r.shippedGuessed ? '~' : ''}${r.shipped.slice(0, 16).replace('T', ' ')}` : ''), onMain: (r) => (r.onMain ? 'yes' : 'no'), deployed: (r) => (r.deployed ? 'yes' : 'no'),
  reach: (r) => r.reach.map((x) => REACH_LABEL[x]).join(' '), tests: (r) => (r.tests.total ? `${r.tests.pass}/${r.tests.total}` : ''),
};
export const cellText = (r, c) => (CSV_TEXT[c] ? CSV_TEXT[c](r) : String(r[c] ?? ''));
/** The value a column sorts by (empty sorts last whichever way). */
export function sortValue(r, c) {
  switch (c) {
    case 'name': case 'area': case 'description': case 'build': case 'commit': case 'settings': case 'help': case 'asked': return String(r[c] || '').toLowerCase();
    case 'status': return SHIP_STATUSES.indexOf(r.status); case 'pr': return r.pr || ''; case 'shipped': return r.shipped;
    case 'onMain': case 'deployed': return r[c] ? 1 : 0; case 'reach': return r.reach.length; case 'version': return Number(r.version.slice(1)) || 0;
    case 'tests': return r.tests.total ? r.tests.pass / r.tests.total + r.tests.total / 1e6 : '';
    default: return '';
  }
}

export function filterRows(rows, view) {
  const v = normTableView(view); const q = v.search.trim().toLowerCase();
  return list(rows).filter((r) => {
    if (v.plugins.length && !v.plugins.includes(r.area)) return false;
    if (v.statuses.length && !v.statuses.includes(r.status)) return false;
    if (v.hasApi && !r.hasApi) return false;
    if (v.notDeployed && r.deployed) return false;
    const d = r.shipped.slice(0, 10); if (v.from && (!d || d < v.from)) return false; if (v.to && (!d || d > v.to)) return false;
    if (q) {
      const pr = q.replace(/^#/, '');
      if (/^\d+$/.test(pr) && r.prs.some((p) => String(p.number) === pr)) return true;
      return `${r.name}\n${r.area}\n${r.description}\n${r.builds.join(' ')}\n${r.commit}\n${r.asked}\n${r.id}`.toLowerCase().includes(q);
    }
    return true;
  });
}
/** Multi-key, stable; empty values last whichever way. */
export function sortRows(rows, sorts) {
  const ks = list(sorts).filter((s) => COLUMN_IDS.includes(s.col));
  if (!ks.length) return list(rows);
  return list(rows).map((r, i) => [r, i]).sort(([a, i], [b, j]) => {
    for (const s of ks) {
      const x = sortValue(a, s.col); const y = sortValue(b, s.col); const ex = x === ''; const ey = y === '';
      if (ex !== ey) return ex ? 1 : -1;
      const d = s.dir === 'asc' ? 1 : -1;
      if (x < y) return -d; if (x > y) return d;
    }
    return i - j;
  }).map(([r]) => r);
}
const groupKey = (r, by) => (by === 'area' ? r.area : by === 'date' ? r.shipped.slice(0, 10) || 'no-date' : by === 'build' ? r.build || 'no-build' : by === 'pr' ? (r.pr ? `#${r.pr}` : 'no-pr') : by === 'status' ? r.status : 'all');
const groupTitle = (k, by) => (k === 'no-date' ? 'No date yet' : k === 'no-build' ? 'No build' : k === 'no-pr' ? 'No pull request' : by === 'status' ? SHIP_STATUS_LABEL[k] : by === 'none' ? 'All features' : k);
/** Groups in the order of their first (sorted) row; date groups newest first unless sorted otherwise. */
export function groupRows(rows, by) {
  const m = new Map();
  for (const r of rows) { const k = groupKey(r, by); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  let gs = [...m.entries()].map(([key, rs]) => ({ key, title: groupTitle(key, by), rows: rs, count: rs.length, counts: Object.fromEntries(SHIP_STATUSES.map((s) => [s, rs.filter((r) => r.status === s).length])), notDeployed: rs.filter((r) => !r.deployed).length }));
  if (by === 'area' || by === 'build') gs = gs.sort((a, b) => a.title.localeCompare(b.title));
  if (by === 'status') gs = gs.sort((a, b) => SHIP_STATUSES.indexOf(a.key) - SHIP_STATUSES.indexOf(b.key));
  return gs;
}
export function tableOf(ledger, manifests, view) {
  const v = normTableView(view); const { rows, folded } = toRows(ledger, manifests);
  const shown = sortRows(filterRows(rows, v), v.sorts);
  return { $axf: SCHEMA, view: v, total: rows.length, count: shown.length, folded, columns: v.order.filter((c) => !v.hidden.includes(c)), plugins: uniq(rows.map((r) => r.area)).sort(), rows: shown, groups: groupRows(shown, v.by).map((g) => ({ ...g, rows: g.rows.map((r) => r.id) })) };
}
export function toCsv(rows, columns = COLUMN_IDS) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const label = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]));
  return [columns.map((c) => esc(label[c] || c)).join(','), ...list(rows).map((r) => columns.map((c) => esc(cellText(r, c))).join(','))].join('\n');
}
