/*
 * Search, sort and multi-filter for the UI Manager's lists (lib/query.mjs, the same function the CLI, REST and MCP
 * tools run). The element bar: words, sort key + direction, and a filter panel (kinds, categories, plugins with their
 * counts; only changed; only on screen). Active filters show as removable buttons. The property bar inside an opened
 * element: words, group, only changed.
 */
import { Button, Checkbox, SelectField, Switch, TextField } from '@console/axf/react';
import { CATEGORIES, type PropRow } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import type { Facet, Facets } from '../lib/query.mjs';
import { setUi, toggleIn, type SortKey, type UiState } from './state';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'label', label: 'Name' }, { value: 'kind', label: 'Kind' }, { value: 'category', label: 'Category' }, { value: 'plugin', label: 'Plugin' }, { value: 'overrides', label: 'Changes' },
];
const CAT_LABEL = new Map(CATEGORIES.map((c) => [c.id, c.label]));
type ListKey = 'kinds' | 'categories' | 'plugins';
const GROUPS: { key: ListKey; label: string; name: (v: string) => string }[] = [
  { key: 'kinds', label: 'Kind', name: (v) => v },
  { key: 'categories', label: 'Category', name: (v) => CAT_LABEL.get(v) ?? v },
  { key: 'plugins', label: 'Plugin', name: (v) => v.split('.').pop() ?? v },
];

export const activeFilterCount = (ui: UiState) => ui.kinds.length + ui.categories.length + ui.plugins.length + Number(ui.overriddenOnly) + Number(ui.onScreenOnly);

export function clearFilters(): void {
  setUi({ q: '', kinds: [], categories: [], plugins: [], overriddenOnly: false, onScreenOnly: false });
}

function FacetList({ label, items, selected, name, onToggle }: { label: string; items: Facet[]; selected: string[]; name: (v: string) => string; onToggle: (v: string) => void }) {
  if (!items.length) return null;
  return (
    <fieldset className="axp-uim__facet">
      <legend className="fx-small fx-muted">{label}</legend>
      {items.map((f) => <Checkbox key={f.value} label={`${name(f.value)} (${f.count})`} checked={selected.includes(f.value)} onChange={() => onToggle(f.value)} />)}
    </fieldset>
  );
}

export function ElementFilters({ ui, facets, shown, total }: { ui: UiState; facets: Facets; shown: number; total: number }) {
  const n = activeFilterCount(ui);
  return (
    <div className="axp-uim__filterbox" data-help="ui-manager.filters">
      <div className="axp-uim__filters" role="toolbar" aria-label="Search and sort elements">
        <TextField className="axp-uim__grow" label="Search elements" value={ui.q} placeholder="Name, id, kind, plugin…" onChange={(v) => setUi({ q: v })} />
        <SelectField label="Sort by" value={ui.sort} options={SORTS} onChange={(v) => setUi({ sort: v as SortKey })} />
        <Button size="sm" icon={ui.desc ? 'chevron-down' : 'chevron-up'} aria-label={ui.desc ? 'Descending' : 'Ascending'} onClick={() => setUi((s) => ({ desc: !s.desc }))}>{ui.desc ? 'Desc' : 'Asc'}</Button>
        <Button size="sm" icon="sliders" tone={n ? 'primary' : 'neutral'} aria-expanded={ui.filtersOpen} onClick={() => setUi((s) => ({ filtersOpen: !s.filtersOpen }))}>{n ? `Filters (${n})` : 'Filters'}</Button>
      </div>
      {(n > 0 || ui.q) && (
        <div className="axp-uim__filters" role="toolbar" aria-label="Active filters">
          <span className="fx-small fx-muted">{shown} of {total}</span>
          {GROUPS.flatMap((g) => ui[g.key].map((v) => (
            <Button key={`${g.key}:${v}`} size="sm" tone="ghost" icon="x" onClick={() => setUi((s) => ({ [g.key]: s[g.key].filter((x) => x !== v) }))}>{g.label}: {g.name(v)}</Button>
          )))}
          {ui.overriddenOnly && <Button size="sm" tone="ghost" icon="x" onClick={() => setUi({ overriddenOnly: false })}>Changed only</Button>}
          {ui.onScreenOnly && <Button size="sm" tone="ghost" icon="x" onClick={() => setUi({ onScreenOnly: false })}>On screen only</Button>}
          <Button size="sm" tone="ghost" onClick={clearFilters}>Clear all</Button>
        </div>
      )}
      {ui.filtersOpen && (
        <div className="axp-uim__facets">
          <div className="axp-uim__switches">
            <Switch label={`Only changed (${facets.overridden})`} checked={ui.overriddenOnly} onChange={(v) => setUi({ overriddenOnly: v })} />
            <Switch label="Only on screen now" checked={ui.onScreenOnly} onChange={(v) => setUi({ onScreenOnly: v })} />
          </div>
          {GROUPS.map((g) => <FacetList key={g.key} label={g.label} items={facets[g.key]} selected={ui[g.key]} name={g.name} onToggle={(v) => setUi((s) => ({ [g.key]: toggleIn(s[g.key], v) }))} />)}
        </div>
      )}
    </div>
  );
}

const PROP_GROUPS: PropRow['group'][] = ['Element', 'Asset', 'Properties', 'Tokens'];

export function PropFilters({ ui }: { ui: UiState }) {
  return (
    <div className="axp-uim__filters" role="toolbar" aria-label="Search properties">
      <TextField className="axp-uim__grow" label="Search properties" value={ui.propQ} placeholder="Name, token, value…" onChange={(v) => setUi({ propQ: v })} />
      <SelectField label="Group" value={ui.propGroups[0] ?? ''} empty="All groups" options={PROP_GROUPS.map((g) => ({ value: g, label: g }))} onChange={(v) => setUi({ propGroups: v ? [v] : [] })} />
      <Switch label="Only changed" checked={ui.propChanged} onChange={(v) => setUi({ propChanged: v })} />
    </div>
  );
}
