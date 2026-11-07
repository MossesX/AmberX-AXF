/**
 * Panes and tab groups (Brett: "Packs: create icon packs by drag and drop between panes. Panes are collapsible and
 * floatable." … "open one or many selected icons into a floating tab group, a docked tab group, or a pane"):
 *
 *   - the pack composer pane: a drop zone that collects icons (from the library, a tab group, another pane), names the
 *     pack and saves it as an icon-pack asset (server: packs/<id>.json; runtime: registered at once). Its draft lives in
 *     a small store so the pane on the page and a floating copy show the same pack.
 *   - IconActions: Add to pack · Open in a tab group (docked or floating, the setting decides the default).
 *   - openIconGroup: selected icons become tabs of a new docked or floating tab group through the window engine
 *     (wm.openGroup / wm.openFloating); an empty group shows one "+" tab that takes drops. Tabs move between groups
 *     and windows with the engine's own tab drag; dropping icons from the tree onto a tab's body adds them there.
 */
import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Container, Icon, IconButton, Note, TextField, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core/runtime';
import type { TabSpec } from '@console/axf/core/engines/windows';
import { GlyphArt, IconBrowser, forgetPackData, usePackData } from './Browser';
import { loadPack, savePack, type IconPackAsset } from './api';
import { ICON_DROP_MIME, ICON_GROUP_TITLE, ICON_TAB_KIND, ID, addToDraft, dragPayload, glyphNameIn, parseDrag, slug, type Config, type IconRecord } from './model';

export const ADD_TAB_KIND = 'icon-browser.add';
export const COMPOSER_TAB_KIND = 'icon-browser.composer';
export const LIBRARY_TAB_KIND = 'icon-browser.library';

/* ---------------- the draft store (one pack draft per console tab, shared by the page pane and floating copies) */

let draft: IconRecord[] = [];
const draftListeners = new Set<() => void>();
export function setDraft(next: IconRecord[] | ((d: IconRecord[]) => IconRecord[])) {
  draft = typeof next === 'function' ? next(draft) : next;
  draftListeners.forEach((fn) => fn());
}
export function useDraft(): [IconRecord[], typeof setDraft] {
  const [, tick] = useState(0);
  useEffect(() => { const fn = () => tick((n) => n + 1); draftListeners.add(fn); return () => { draftListeners.delete(fn); }; }, []);
  return [draft, setDraft];
}

/* ---------------- drops */

export function useIconDrop(onIcons: (icons: IconRecord[]) => void) {
  const [over, setOver] = useState(false);
  const onDragOver = useCallback((e: DragEvent) => { if (e.dataTransfer.types.includes(ICON_DROP_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }, []);
  const onDragLeave = useCallback(() => setOver(false), []);
  const onDrop = useCallback((e: DragEvent) => { const icons = parseDrag(e.dataTransfer.getData(ICON_DROP_MIME)); setOver(false); if (icons.length) { e.preventDefault(); onIcons(icons); } }, [onIcons]);
  return { over, onDragOver, onDragLeave, onDrop };
}

/** The icon record behind a ref the server knows nothing about yet (an action's `refs…`, a dropped text ref). */
export function iconFromRef(ref: string): IconRecord | null {
  const m = /^pack:([a-z0-9][a-z0-9-]{0,63})\/([a-z][a-z0-9-]*)$/.exec(ref);
  return m ? { name: m[2]!, set: '', pack: m[1]!, category: '', tags: [], style: '', ref } : null;
}

/* ---------------- tab groups */

const tabOf = (i: { ref: string; name?: string; pack?: string }): TabSpec | null => {
  const rec = iconFromRef(i.ref);
  return rec ? { id: `icon:${i.ref}`, title: i.name ?? rec.name, kind: ICON_TAB_KIND, payload: i.ref, icon: 'grid', closable: true } : null;
};
const addTab = (): TabSpec => ({ id: `icon-add:${Date.now().toString(36)}`, title: 'Add icons', kind: ADD_TAB_KIND, payload: '', icon: 'plus', closable: true });
const hasTab = (rt: AxfRuntime, id: string) => Object.values(rt.windows.state.groups).some((g) => g.tabs.some((t) => t.id === id));
/** Add icons as tabs of a group (one tab per ref; a ref already open anywhere is not opened twice). */
function addIconsTo(rt: AxfRuntime, groupId: string, icons: IconRecord[]) {
  for (const i of icons) { const t = tabOf(i); if (t && !hasTab(rt, t.id)) rt.windows.addTab(groupId, t); }
}

/** Open icons as a new tab group: docked into the main window, or floating. Empty = a group with one "+" tab. */
export function openIconGroup(rt: AxfRuntime, icons: { ref: string; name?: string; pack?: string }[], where: 'docked' | 'floating' = 'docked'): string {
  const tabs = icons.map(tabOf).filter((t): t is TabSpec => !!t);
  const list = tabs.length ? tabs : [addTab()];
  const wm = rt.windows;
  if (where === 'floating') return wm.openFloating(list, ICON_GROUP_TITLE, 'floating', 420, 380);
  return wm.openGroup(list);
}

/** Open the pack composer or the whole library as a floating window (a "floatable pane"). */
export function floatPane(rt: AxfRuntime, kind: typeof COMPOSER_TAB_KIND | typeof LIBRARY_TAB_KIND): string {
  const tab: TabSpec = kind === COMPOSER_TAB_KIND
    ? { id: `icon-composer:${Date.now().toString(36)}`, title: 'Pack composer', kind, payload: '', icon: 'package', closable: true }
    : { id: `icon-library:${Date.now().toString(36)}`, title: 'Icon library', kind, payload: '', icon: 'grid', closable: true };
  return rt.windows.openFloating([tab], tab.title, 'floating', kind === LIBRARY_TAB_KIND ? 720 : 420, kind === LIBRARY_TAB_KIND ? 560 : 440);
}

function IconTab({ tab }: { tab: TabSpec }) {
  const rt = useRuntime();
  const rec = iconFromRef(tab.payload ?? '');
  const pack = usePackData(rec?.pack ?? '');
  const drop = useIconDrop((icons) => { const g = rt.windows.groupOf(tab.id); if (g) addIconsTo(rt, g, icons); });
  if (!rec) return <div className="axp-icon-browser__tab"><Icon name="alert" size={24} /><p className="fx-muted">Not an icon ref.</p></div>;
  return (
    <div className={`axp-icon-browser__tab ${drop.over ? 'is-over' : ''}`} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop} draggable onDragStart={(e) => { e.dataTransfer.setData(ICON_DROP_MIME, dragPayload([rec], 'group')); e.dataTransfer.effectAllowed = 'copy'; }}>
      <span className="axp-icon-browser__tab-art"><GlyphArt pack={rec.pack} name={rec.name} size={96} /></span>
      <strong>{rec.name}</strong>
      <span className="fx-small fx-muted">{pack?.name ?? rec.pack}{pack ? ` · ${pack.data.style} · ${pack.data.grid} grid` : ''}</span>
      <div className="axp-icon-browser__actions">
        <Button size="sm" icon="package" onClick={() => setDraft((d) => addToDraft(d, [rec]))}>Add to pack</Button>
        <Button size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(rec.ref)}>Copy ref</Button>
      </div>
      <p className="fx-small fx-muted">Drop icons here to add them to this group. Drag the tab header to another group or window.</p>
    </div>
  );
}

function AddTab({ tab }: { tab: TabSpec }) {
  const rt = useRuntime();
  const drop = useIconDrop((icons) => {
    const g = rt.windows.groupOf(tab.id); if (!g) return;
    addIconsTo(rt, g, icons);
    rt.windows.closeTab(tab.id);
  });
  return (
    <div className={`axp-icon-browser__tab-add ${drop.over ? 'is-over' : ''}`} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop}>
      <Icon name="plus" size={32} />
      <p>Drop icons here, or pick some in the Icon browser and choose <em>Open in this group</em>.</p>
      <Button icon="grid" size="sm" onClick={() => rt.navigate('icon-browser')}>Open the icon browser</Button>
    </div>
  );
}

function FloatingComposer() { const [config] = useFloatingConfig(); return <div className="fx-stack" style={{ padding: 'var(--fx-dens-gap-md)' }}><ComposerPane config={config} floating /></div>; }
function FloatingLibrary() {
  const [config, setConfig] = useFloatingConfig();
  const [selection, setSelection] = useState<IconRecord[]>([]);
  const [active, setActive] = useState<IconRecord | null>(null);
  return <div style={{ padding: 'var(--fx-dens-gap-md)', height: '100%', overflow: 'auto' }}><IconBrowser config={config} onConfig={(p) => setConfig((c) => ({ ...c, ...p }))} selection={selection} onSelection={setSelection} active={active} onActive={setActive} actions={(icons) => <IconActions icons={icons} config={config} />} /></div>;
}
/** A floating pane keeps its own view settings (the page's saved ones are the start). */
function useFloatingConfig(): [Config, (f: (c: Config) => Config) => void] {
  const [c, setC] = useState<Config>({ view: 'grid', tile: 'sm', names: false, treeThumbs: true, sort: 'name', set: '', category: '', style: '', panes: { library: true, composer: false, details: true }, openNewGroup: 'docked', sections: {} });
  return [c, setC];
}

/** The tab renderers this plugin contributes (AxfWebLibrary.tabs): icons, the "+" tab, the floating composer and library. */
export function iconTabRenderers(kind = ICON_TAB_KIND): Record<string, (t: TabSpec) => ReactNode> {
  return {
    [kind]: (t) => <IconTab tab={t} />,
    [ADD_TAB_KIND]: (t) => <AddTab tab={t} />,
    [COMPOSER_TAB_KIND]: () => <FloatingComposer />,
    [LIBRARY_TAB_KIND]: () => <FloatingLibrary />,
  };
}

/* ---------------- actions on a selection */

export function IconActions({ icons, config, onAdd }: { icons: IconRecord[]; config: Config; onAdd?: (icons: IconRecord[]) => void }) {
  const rt = useRuntime();
  const many = icons.length > 1;
  const add = () => { setDraft((d) => addToDraft(d, icons)); onAdd?.(icons); rt.toast(`${icons.length} icon(s) in the pack draft.`, 'success', 'Pack composer'); };
  return (
    <>
      <Button size="sm" icon="package" onClick={add}>{many ? `Add ${icons.length} to pack` : 'Add to pack'}</Button>
      <Button size="sm" icon={config.openNewGroup === 'floating' ? 'external' : 'layout'} onClick={() => openIconGroup(rt, icons, config.openNewGroup)}>{`Open in a ${config.openNewGroup} tab group`}</Button>
      <IconButton icon={config.openNewGroup === 'floating' ? 'layout' : 'external'} label={`Open in a ${config.openNewGroup === 'floating' ? 'docked' : 'floating'} tab group`} onClick={() => openIconGroup(rt, icons, config.openNewGroup === 'floating' ? 'docked' : 'floating')} />
    </>
  );
}

/* ---------------- the pack composer */

export function ComposerPane({ config, floating = false }: { config: Config; floating?: boolean }) {
  const rt = useRuntime();
  const [items, set] = useDraft();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const drop = useIconDrop((icons) => set((d) => addToDraft(d, icons)));
  const id = slug(name) || (items.length ? `pack-${slug(items[0]!.name)}` : '');

  const save = async () => {
    if (!items.length || !id) return;
    setBusy(true);
    try {
      const packs = new Map<string, IconPackAsset>();
      for (const p of new Set(items.map((i) => i.pack))) packs.set(p, await loadPack(p));
      const grids = new Set([...packs.values()].map((p) => p.data.grid));
      if (grids.size > 1) { rt.toast(`These icons come from packs on different grids (${[...grids].join(', ')}); keep one grid per pack.`, 'warning', 'Pack composer'); return; }
      const first = packs.get(items[0]!.pack)!;
      const styles = items.map((i) => packs.get(i.pack)!.data.style);
      const style = styles.filter((s) => s === 'filled').length > styles.length / 2 ? 'filled' : first.data.style;
      const glyphs: Record<string, unknown> = {};
      for (const i of items) { const g = packs.get(i.pack)!.data.glyphs[i.name]; if (g !== undefined) glyphs[glyphNameIn(items, i)] = g; }
      const asset: IconPackAsset = { $axf: 'asset@1', type: 'icon-pack', id, name: name.trim() || id, version: '1.0.0', description: `Composed in the Icon browser from ${packs.size} pack(s): ${Object.keys(glyphs).length} glyph(s).`, author: 'Icon browser', tags: ['icon-browser', 'composed', style], data: { style, grid: first.data.grid, stroke: first.data.stroke ?? 1.75, linecap: first.data.linecap ?? 'round', fallback: 'framework', glyphs } };
      await savePack(asset);
      forgetPackData(id);
      const r = rt.importAsset(asset, false, ID);
      if (!r.ok) rt.toast(`Saved, but the app refused it: ${r.errors?.[0] ?? ''}`, 'warning', 'Pack composer');
      else rt.toast(`Pack ${id} saved (${Object.keys(glyphs).length} glyphs). It is in the library under My packs and in the Icon Manager.`, 'success', 'Pack composer');
      set([]); setName('');
    } catch (e) { rt.toast((e as Error).message || 'Could not save the pack.', 'danger', 'Pack composer'); }
    finally { setBusy(false); }
  };

  return (
    <Container title="Pack composer" icon="package" collapsible defaultOpen actions={!floating ? <IconButton icon="external" label="Float this pane" onClick={() => floatPane(rt, COMPOSER_TAB_KIND)} /> : undefined}>
      <div className={`axp-icon-browser__drop ${drop.over ? 'is-over' : ''}`} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop} aria-label="Pack draft (drop icons here)" role="list">
        {items.length === 0 && <p className="axp-icon-browser__drop-hint">Drop icons here (from the library, a tab group or another pane) to compose a pack.</p>}
        {items.map((i) => (
          <span key={i.ref} role="listitem" className="axp-icon-browser__chip" draggable onDragStart={(e) => { e.dataTransfer.setData(ICON_DROP_MIME, dragPayload([i], 'composer')); e.dataTransfer.effectAllowed = 'copy'; }} title={i.ref}>
            <GlyphArt pack={i.pack} name={i.name} size={16} /> {glyphNameIn(items, i)}
            <IconButton icon="x" label={`Remove ${i.name}`} onClick={() => set((d) => d.filter((x) => x.ref !== i.ref))} />
          </span>
        ))}
      </div>
      <TextField label="Pack name" value={name} onChange={setName} placeholder="My pack" />
      {id && <p className="fx-small fx-muted">Asset id <span className="fx-mono">{id}</span> · {items.length} glyph(s)</p>}
      {items.length > 0 && new Set(items.map((i) => i.style)).size > 1 && <Note tone="info">Outline and filled icons mixed: the pack takes the majority style; each glyph keeps its own fill.</Note>}
      <div className="axp-icon-browser__actions">
        <Button tone="primary" icon="save" disabled={!items.length || !id || busy} onClick={() => void save()}>Save as icon pack</Button>
        <Button icon={config.openNewGroup === 'floating' ? 'external' : 'layout'} disabled={!items.length} onClick={() => openIconGroup(rt, items, config.openNewGroup)}>Open in a tab group</Button>
        <Button tone="danger" icon="trash" disabled={!items.length} confirm="Empty the pack draft?" onClick={() => set([])}>Clear</Button>
      </div>
    </Container>
  );
}
