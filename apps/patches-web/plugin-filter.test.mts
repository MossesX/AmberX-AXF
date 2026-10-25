// npx -y tsx apps/patches-web/plugin-filter.test.mts
import { arrange, changedFromDefault, DEFAULT_FILTER, readFilter, type FilterRow, type PluginFilter } from './src/pluginFilter.ts';
let n = 0, bad = 0;
const eq = (name: string, a: unknown, b: unknown) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.error('FAIL', name, a, b); } };
const cell = (installed: boolean | null, canChange = true) => ({ installed, canChange });
const rows: FilterRow[] = [
  { id: 'a.zeta', folder: 'zeta', name: 'Zeta', version: '1', model: 'opus', sources: ['installed:console'], cells: { patches: cell(false), console: cell(true), pilot: cell(false) } },
  { id: 'a.alpha', folder: 'alpha', name: 'Alpha', version: '1', model: 'fable', sources: ['catalog'], cells: { patches: cell(false), console: cell(false), pilot: cell(false) } },
  { id: 'a.beta', folder: 'beta', name: 'Beta', version: '2', model: '', sources: ['installed:console', 'installed:pilot'], banner: true, cells: { patches: cell(true), console: cell(true, false), pilot: cell(true) } },
  { id: 'a.gamma', folder: 'gamma', name: 'Gamma', version: '1', model: 'opus', sources: ['catalog'], cells: { patches: cell(false, false), console: cell(false, false), pilot: cell(null, false) } },
];
const F = (o: Partial<PluginFilter> = {}) => ({ ...DEFAULT_FILTER, ...o });
const ids = (r: FilterRow[]) => r.map((x) => x.folder);
eq('default: installed first, nowhere last', ids(arrange(rows, F())), ['beta', 'zeta', 'alpha', 'gamma']);
eq('nowhereLast off', ids(arrange(rows, F({ nowhereLast: false }))), ['alpha', 'beta', 'gamma', 'zeta']);
eq('sort by apps', ids(arrange(rows, F({ sort: 'apps' }))), ['beta', 'zeta', 'alpha', 'gamma']);
eq('desc', ids(arrange(rows, F({ desc: true }))), ['zeta', 'beta', 'gamma', 'alpha']);
eq('show nowhere', ids(arrange(rows, F({ show: 'nowhere' }))), ['alpha', 'gamma']);
eq('show installed', ids(arrange(rows, F({ show: 'installed' }))), ['beta', 'zeta']);
eq('text', ids(arrange(rows, F({ text: 'ALP' }))), ['alpha']);
eq('text id off', ids(arrange(rows, F({ text: 'a.beta', fields: { name: true, id: false, folder: false, version: false } }))), []);
eq('per app no', ids(arrange(rows, F({ apps: { console: 'no' } }))), ['alpha', 'gamma']);
eq('per app yes pilot', ids(arrange(rows, F({ apps: { pilot: 'yes' } }))), ['beta']);
eq('model unrecorded', ids(arrange(rows, F({ models: [''] }))), ['beta']);
eq('source catalog', ids(arrange(rows, F({ sources: ['catalog'] }))), ['alpha', 'gamma']);
eq('banners none', ids(arrange(rows, F({ banners: 'none' }))), ['zeta', 'alpha', 'gamma']);
eq('changeable', ids(arrange(rows, F({ changeableOnly: true }))), ['beta', 'zeta', 'alpha']);
eq('changed', ids(arrange(rows, F({ show: 'changed' }), (r) => r.id === 'a.gamma')), ['gamma']);
eq('badge default', changedFromDefault(F()), 0);
eq('badge 2', changedFromDefault(F({ show: 'nowhere', nowhereLast: false })), 2);
eq('read junk', readFilter({ show: 'x', sort: 'evil', apps: { c: 'maybe', d: 'no' }, sources: ['catalog', 'x'], nowhereLast: false }), { ...F({ apps: { d: 'no' }, sources: ['catalog'], nowhereLast: false }), fields: DEFAULT_FILTER.fields });
eq('read null', readFilter(null), F());
console.log(`${n - bad}/${n} passed`); if (bad) process.exit(1);
