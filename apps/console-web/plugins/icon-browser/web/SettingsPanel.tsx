/**
 * Settings → Plugins → Icon browser: categorized, collapsible sections (Brett: "Settings in categorized collapsible
 * sections"). Each section is a framework Container with its own fold state kept in the plugin's config.
 */
import { useEffect, useState } from 'react';
import { Button, Container, Note, Segmented, SelectField, Switch, useRuntime } from '@console/axf/react';
import { loadConfig, saveConfig } from './api';
import { DEFAULT_CONFIG, MANAGER_VIEW, SORTS, VIEW, VIEW_MODES, type Config, type SortKey, type TileSize, type ViewMode } from './model';

const SECTIONS = [
  { id: 'library', title: 'Library view', icon: 'grid', about: 'How the library opens: view mode, tile size, names and tree thumbnails.' },
  { id: 'filters', title: 'Default filters', icon: 'search', about: 'The set, category, style and sort order the browser starts with.' },
  { id: 'panes', title: 'Panes and tab groups', icon: 'layout', about: 'Which panes show beside the library and where a new tab group opens.' },
  { id: 'manager', title: 'Icon Manager', icon: 'layers', about: 'Icon maps per app, UI and plugin; Randomize and Generate.' },
] as const;

export function SettingsPanel() {
  const rt = useRuntime();
  const [c, setC] = useState<Config | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => { loadConfig().then(setC, () => { setOffline(true); setC(DEFAULT_CONFIG); }); }, []);
  if (!c) return <p className="fx-muted">Loading…</p>;

  const save = (patch: Partial<Config>) => { setC({ ...c, ...patch }); void saveConfig(patch).then(setC, () => rt.toast('Could not save the Icon browser settings.', 'danger', 'Icon browser')); };
  const section = (id: (typeof SECTIONS)[number]['id'], body: React.ReactNode) => {
    const s = SECTIONS.find((x) => x.id === id)!;
    return (
      <Container key={id} title={s.title} icon={s.icon} collapsible defaultOpen={c.sections[id] !== false} className="axp-icon-browser__section">
        <p className="fx-muted" style={{ marginTop: 0 }}>{s.about}</p>
        <div className="fx-stack">{body}</div>
      </Container>
    );
  };

  return (
    <div className="fx-stack">
      {offline && <Note tone="warning">The console server isn't reachable, so these settings are read-only.</Note>}
      {section('library', <>
        <div className="fx-field"><span className="fx-field__label">View</span><Segmented label="View" value={c.view} onChange={(v: ViewMode) => save({ view: v })} disabled={offline} options={VIEW_MODES.map((m) => ({ value: m.id, label: m.label, icon: m.icon }))} /></div>
        <div className="fx-field"><span className="fx-field__label">Tile size (grid)</span><Segmented label="Tile size" value={c.tile} onChange={(v: TileSize) => save({ tile: v })} disabled={offline} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} /></div>
        <Switch label="Show names under tiles" checked={c.names} onChange={(v) => save({ names: v })} disabled={offline} />
        <Switch label="Thumbnails in the tree" checked={c.treeThumbs} onChange={(v) => save({ treeThumbs: v })} disabled={offline} />
      </>)}
      {section('filters', <>
        <SelectField label="Sort by" value={c.sort} onChange={(v) => save({ sort: v as SortKey })} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} disabled={offline} />
        <SelectField label="Set" value={c.set} onChange={(v) => save({ set: v, category: '' })} empty="Every set" options={[{ value: 'lucide', label: 'Lucide' }, { value: 'tabler', label: 'Tabler Icons' }, { value: 'feather', label: 'Feather' }, { value: 'heroicons-outline', label: 'Heroicons (outline)' }, { value: 'heroicons-solid', label: 'Heroicons (solid)' }, { value: 'phosphor', label: 'Phosphor' }, { value: 'bootstrap', label: 'Bootstrap Icons' }, { value: 'mine', label: 'My packs' }]} disabled={offline} />
        <SelectField label="Style" value={c.style} onChange={(v) => save({ style: v })} empty="Any style" options={[{ value: 'outline', label: 'Outline' }, { value: 'filled', label: 'Filled' }]} disabled={offline} />
      </>)}
      {section('panes', <>
        <Switch label="Pack composer pane" checked={c.panes.composer} onChange={(v) => save({ panes: { ...c.panes, composer: v } })} disabled={offline} />
        <Switch label="Details pane" checked={c.panes.details} onChange={(v) => save({ panes: { ...c.panes, details: v } })} disabled={offline} />
        <SelectField label="New tab group opens" value={c.openNewGroup} onChange={(v) => save({ openNewGroup: v === 'floating' ? 'floating' : 'docked' })} options={[{ value: 'docked', label: 'Docked in the main window' }, { value: 'floating', label: 'As a floating window' }]} disabled={offline} />
      </>)}
      {section('manager', <>
        <p className="fx-muted" style={{ margin: 0 }}>Every app, screen and plugin has an icon map (icon-map@1). Picks are settings (<span className="fx-mono">axf.icons.*</span>) that the hub look carries to every app.</p>
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="grid" onClick={() => rt.navigate(VIEW)}>Open the icon browser</Button>
          <Button icon="layers" onClick={() => rt.navigate(MANAGER_VIEW)}>Open the icon manager</Button>
          <Button tone="danger" icon="undo" confirm="Forget every icon pick of this app (maps, packs and slots at the root)?" undoable disabled={offline} onClick={() => { rt.resetIcons('app'); rt.toast('Icons reset to the app\'s own.', 'success', 'Icon manager'); }}>Reset the app's icons</Button>
        </div>
      </>)}
    </div>
  );
}
