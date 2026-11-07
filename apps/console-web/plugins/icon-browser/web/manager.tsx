/**
 * Icon Manager (Brett: "Every UI and plugin gets an icon map … List/grid of every UI with an icon map, filterable by
 * app. Open a map, or open a live preview of the UI and drag icons onto the preview. Save / Apply makes it permanent
 * for that icon tag. … Inheritance: assign a pack to the whole app (root), or per UI, or per plugin. The child
 * overrides the parent. … Switch packs globally; a randomize button reshuffles the whole icon set; generate cohesive
 * packs that follow one theme/style."):
 *
 *   - the UI list: this app's scopes (root, every screen and plugin that has drawn icons) + every icon-map asset the
 *     server knows (the framework's, each app's shipped ones, saved ones), filterable by app and searchable;
 *   - the map editor for a scope: the pack applied, the map picked, every slot with what it draws now and where that
 *     comes from (plugin → UI → root → branding → framework), a drop target per slot (Apply = at once, a setting the
 *     hub look carries to every app), Clear, and Save as a map asset (root / global or this scope);
 *   - the live preview: the scope's icons drawn through the real resolution inside its IconScope; drop onto one;
 *   - Switch pack (global), Randomize, Generate from one pack, Reset;
 *   - the every-icon listing: every glyph of every pack this app has (the "global icon pack").
 */
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { Button, Container, Icon, IconButton, IconScope, Note, SelectField, Segmented, TextField, useRuntime } from '@console/axf/react';
import { ICON_MAP_KEY, ICON_PACK_KEY, ICON_SLOTS_KEY, allIcons, iconMapAsset, iconScopeKind, parseIconRef, type IconResolution } from '@console/axf/core/engines/iconmap';
import { GlyphArt, usePackData } from './Browser';
import { useIconDrop } from './panes';
import { listMaps, loadLibrary, loadPack, saveMap, type IconMapAsset } from './api';
import { ICON_DROP_MIME, ID, VIEW, dragPayload, parseDrag, slug, type Config, type IconRecord } from './model';

type ScopeKey = string;
const scopeOf = (key: ScopeKey) => (key.startsWith('ui:') ? { ui: key.slice(3) } : key.startsWith('plugin:') ? { plugin: key.slice(7) } : {});
const kindOf = (key: ScopeKey) => (key.startsWith('ui:') ? 'ui' : key.startsWith('plugin:') ? 'plugin' : 'app');
const labelOf = (key: ScopeKey) => (key === 'app' ? 'App root' : key.startsWith('ui:') ? `Screen ${key.slice(3)}` : `Plugin ${key.slice(7).replace(/^ai\.amberx\.axf\.console\./, '')}`);

interface UiCard { id: string; app: string; key: ScopeKey; kind: 'app' | 'ui' | 'plugin'; label: string; icons: number; map: string; pack: string; slots: number; live: boolean; shipped?: string }

export function IconManager({ config }: { config: Config; onConfig: (p: Partial<Config>) => void }) {
  const rt = useRuntime();
  const appId = rt.manifest.app.id;
  const [maps, setMaps] = useState<IconMapAsset[]>([]);
  const [q, setQ] = useState('');
  const [appFilter, setAppFilter] = useState('');
  const [picked, setPicked] = useState<ScopeKey>('app');
  const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; listMaps().then((m) => live && setMaps(m), () => {}); return () => { live = false; }; }, [tick]);
  useEffect(() => { const off = rt.subscribe(() => setTick((n) => n + 1)); return () => { off(); }; }, [rt]);

  // every UI with an icon map: this app's live scopes first, then maps of other apps the server knows
  const cards = useMemo<UiCard[]>(() => {
    const out: UiCard[] = [];
    const seen = new Set<string>();
    const scopes = rt.iconScopes();
    if (!scopes.some((s) => s.key === 'app')) scopes.unshift({ key: 'app', count: 0 });
    for (const s of scopes) {
      const slots = rt.settings.get(ICON_SLOTS_KEY(s.key));
      out.push({ id: `${appId}:${s.key}`, app: appId, key: s.key, kind: kindOf(s.key), label: labelOf(s.key), icons: s.count, map: String(rt.settings.get(ICON_MAP_KEY(s.key)) ?? ''), pack: String(rt.settings.get(ICON_PACK_KEY(s.key)) ?? ''), slots: slots && typeof slots === 'object' ? Object.keys(slots as object).length : 0, live: true });
      seen.add(`${appId}:${s.key}`);
    }
    for (const m of maps) {
      const d = m.data; const key = d.scope.plugin ? `plugin:${d.scope.plugin}` : d.scope.ui ? `ui:${d.scope.ui}` : 'app';
      const app = d.scope.app || '(any app)';
      if (seen.has(`${app}:${key}`)) continue;
      seen.add(`${app}:${key}`);
      out.push({ id: `${app}:${key}`, app, key, kind: iconScopeKind(d.scope), label: `${labelOf(key)} · ${m.id}`, icons: Object.keys(d.slots).length, map: m.id, pack: d.pack ?? '', slots: Object.keys(d.slots).length, live: false, shipped: m.shipped });
    }
    return out;
  }, [rt, appId, maps, tick]);
  const apps = useMemo(() => [...new Set(cards.map((c) => c.app))].sort(), [cards]);
  const shown = useMemo(() => cards.filter((c) => (!appFilter || c.app === appFilter) && (!q || `${c.label} ${c.key} ${c.map} ${c.pack}`.toLowerCase().includes(q.toLowerCase()))), [cards, appFilter, q]);
  const current = cards.find((c) => c.id === `${appId}:${picked}`) ?? cards.find((c) => c.live) ?? null;

  return (
    <div className="fx-stack fx-stack--lg">
      <div className="axp-icon-browser__bar" role="search">
        <input className="fx-input axp-icon-browser__search" type="search" aria-label="Search UIs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${cards.length} UIs with an icon map`} />
        {apps.length > 1 && <select className="fx-input axp-icon-browser__pick" aria-label="App" value={appFilter} onChange={(e) => setAppFilter(e.target.value)}><option value="">Every app</option>{apps.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
        <span className="axp-icon-browser__count">{shown.length} of {cards.length}</span>
      </div>
      <div className="axp-icon-browser__uis" role="list" aria-label="UIs with an icon map">
        {shown.map((c) => (
          <button key={c.id} type="button" role="listitem" data-fx-row className={`axp-icon-browser__ui ${current?.id === c.id ? 'is-active' : ''}`} onClick={() => { if (c.live) setPicked(c.key); else rt.toast(`${c.map} belongs to ${c.app}: its picks apply there. Open that app's Icon manager to drop icons on it, or import the map here.`, 'info', 'Icon manager'); }}>
            <span className="axp-icon-browser__ui-head"><Icon name={c.kind === 'app' ? 'home' : c.kind === 'ui' ? 'layout' : 'package'} size={16} /> {c.label}</span>
            <span className="axp-icon-browser__ui-meta">{c.app}{c.shipped ? ` · shipped by ${c.shipped}` : c.live ? ' · live here' : ' · saved'}</span>
            <span className="axp-icon-browser__ui-meta">{c.icons} icon(s){c.pack ? ` · pack ${c.pack}` : ''}{c.map ? ` · map ${c.map}` : ''}{c.slots ? ` · ${c.slots} pinned` : ''}</span>
          </button>
        ))}
        {shown.length === 0 && <div className="axp-icon-browser__empty" role="status"><Icon name="search" size={24} /><p>No UI matches.</p></div>}
      </div>
      {current && <ScopeEditor key={current.key} scopeKey={current.key} config={config} onSaved={() => setTick((n) => n + 1)} />}
      <EveryIcon />
    </div>
  );
}

/* ---------------- one scope */

function ScopeEditor({ scopeKey, config, onSaved }: { scopeKey: ScopeKey; config: Config; onSaved: () => void }) {
  const rt = useRuntime();
  const scope = scopeOf(scopeKey);
  const [, bump] = useState(0);
  useEffect(() => { const off = rt.subscribe(() => bump((n) => n + 1)); return () => { off(); }; }, [rt]);
  const packs = rt.registry.list('icon-pack').map((p) => ({ value: p.id, label: p.name }));
  const mapsHere = rt.registry.list('icon-map').filter((m) => iconScopeKind(m.data.scope) === kindOf(scopeKey)).map((m) => ({ value: m.id, label: m.name }));
  const mapPick = String(rt.settings.get(ICON_MAP_KEY(scopeKey)) ?? '');
  const packPick = String(rt.settings.get(ICON_PACK_KEY(scopeKey)) ?? '');
  const slotsRaw = rt.settings.get(ICON_SLOTS_KEY(scopeKey));
  const pinned: Record<string, string> = slotsRaw && typeof slotsRaw === 'object' && !Array.isArray(slotsRaw) ? (slotsRaw as Record<string, string>) : {};
  const names = useMemo(() => [...new Set([...rt.iconsUsed(scopeKey), ...Object.keys(pinned)])].sort(), [rt, scopeKey, pinned, mapPick, packPick]);
  const chain = rt.iconChainFor(scope);
  const [saveScope, setSaveScope] = useState<'root' | 'scope'>(scopeKey === 'app' ? 'root' : 'scope');
  const [mapName, setMapName] = useState('');
  const [genPack, setGenPack] = useState(packs[0]?.value ?? '');

  const applyDrop = useCallback((slot: string, icons: IconRecord[]) => {
    const i = icons[0]; if (!i) return;
    if (!rt.setIconSlot(scopeKey, slot, i.ref)) rt.toast('Your role may not change icons here.', 'warning', 'Icon manager');
    else rt.toast(`${slot} now draws ${i.name} from ${i.pack} in ${labelOf(scopeKey)}.`, 'success', 'Icon manager');
  }, [rt, scopeKey]);

  const save = async () => {
    const id = slug(mapName) || `${rt.manifest.app.id}-${scopeKey.replace(/[:.]/g, '-')}`.slice(0, 48);
    const data = { scope: { app: rt.manifest.app.id, ui: saveScope === 'root' ? '' : scope.ui ?? '', plugin: saveScope === 'root' ? '' : scope.plugin ?? '' }, pack: packPick, slots: pinned, extends: saveScope === 'root' ? '' : mapPick };
    const asset = iconMapAsset(id, mapName.trim() || `${labelOf(scopeKey)} icons`, data) as unknown as IconMapAsset;
    try {
      await saveMap(asset);
      const r = rt.importAsset(asset, false, ID);
      if (!r.ok) { rt.toast(`Saved, but the app refused it: ${r.errors?.[0] ?? ''}`, 'warning', 'Icon manager'); return; }
      const key = saveScope === 'root' ? 'app' : scopeKey;
      rt.setIconMap(key, id);
      if (key === scopeKey) { rt.settings.clear(ICON_SLOTS_KEY(scopeKey)); rt.settings.clear(ICON_PACK_KEY(scopeKey)); }
      rt.toast(`Map ${id} saved and picked for ${labelOf(key)}.`, 'success', 'Icon manager');
      setMapName(''); onSaved();
    } catch (e) { rt.toast((e as Error).message || 'Could not save the map.', 'danger', 'Icon manager'); }
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <Container title={`${labelOf(scopeKey)} · icon map`} icon="layers" collapsible defaultOpen actions={<span className="fx-small fx-muted">{names.length} icon(s)</span>}>
        <div className="axp-icon-browser__chain" aria-label="Inheritance">
          <span>Resolves through:</span>
          {chain.length === 0 && <span className="fx-mono">framework</span>}
          {chain.map((m, i) => <span key={m.id}><span className="fx-mono">{m.id}</span>{i < chain.length - 1 ? ' →' : ' → branding → framework'}</span>)}
          <span>(the child overrides its parent)</span>
        </div>
        <div className="fx-row fx-row--wrap">
          <SelectField label={`Pack applied to ${labelOf(scopeKey).toLowerCase()}`} value={packPick} onChange={(v) => rt.setIconPack(scopeKey, v)} empty="None (inherit)" options={packs} />
          <SelectField label="Map picked" value={mapPick} onChange={(v) => rt.setIconMap(scopeKey, v)} empty="None (shipped maps only)" options={mapsHere} />
          <ImportPack />
        </div>
        <div className="axp-icon-browser__actions">
          <Button icon="shuffle" onClick={() => { const r = rt.randomizeIcons(scopeKey); if (r) rt.toast(`${r.changed.length} icon(s) reshuffled, ${r.kept.length} kept (no other drawing of them).`, 'success', 'Icon manager'); }}>Randomize</Button>
          <SelectField label="Generate from" value={genPack} onChange={setGenPack} options={packs} />
          <Button icon="sparkles" disabled={!genPack} onClick={() => { const r = rt.generateIcons(scopeKey, genPack); if (r) rt.toast(`${r.covered.length} icon(s) now drawn from ${genPack}; ${r.missing.length} it has no drawing for stay as they are.`, 'success', 'Icon manager'); }}>Generate cohesive set</Button>
          <Button tone="danger" icon="undo" confirm={`Forget every icon pick of ${labelOf(scopeKey).toLowerCase()}?`} undoable onClick={() => rt.resetIcons(scopeKey)}>Reset</Button>
        </div>
      </Container>

      <Container title="Live preview" icon="eye" collapsible defaultOpen>
        <p className="fx-muted" style={{ marginTop: 0 }}>Every icon this {kindOf(scopeKey) === 'app' ? 'app' : kindOf(scopeKey) === 'ui' ? 'screen' : 'plugin'} has drawn, through its real resolution. Drop an icon from the browser onto one to pin that slot; Apply is immediate and the hub look carries it to every app.</p>
        <Preview scopeKey={scopeKey} names={names} onDrop={applyDrop} pinned={pinned} />
      </Container>

      <Container title="Slots" icon="list" collapsible defaultOpen={false}>
        <div className="axp-icon-browser__slots" role="list">
          {names.map((n) => <SlotRow key={n} slotName={n} res={rt.iconFor(n, scope)} pinned={pinned[n]} onDrop={(icons) => applyDrop(n, icons)} onClear={() => rt.setIconSlot(scopeKey, n, '')} onHide={() => rt.setIconSlot(scopeKey, n, 'none')} />)}
          {names.length === 0 && <p className="fx-muted">No icons drawn here yet: open the screen or plugin once, then come back.</p>}
        </div>
      </Container>

      <Container title="Save changes as a map" icon="save" collapsible defaultOpen={false}>
        <p className="fx-muted" style={{ marginTop: 0 }}>The pins and the pack above live in settings. Saving writes them as an icon-map asset, picks it for the scope, and clears the loose pins. Other apps pick the asset up when they ship it (framework/assets/icon-map or their own src/assets).</p>
        <div className="fx-row fx-row--wrap">
          <TextField label="Map name" value={mapName} onChange={setMapName} placeholder={`${labelOf(scopeKey)} icons`} />
          <div className="fx-field"><span className="fx-field__label">Scope</span><Segmented label="Scope" value={saveScope} onChange={setSaveScope} options={[{ value: 'root', label: 'Root / global', icon: 'home' }, ...(scopeKey !== 'app' ? [{ value: 'scope' as const, label: labelOf(scopeKey), icon: kindOf(scopeKey) === 'ui' ? 'layout' : 'package' }] : [])]} /></div>
          <Button tone="primary" icon="save" disabled={!Object.keys(pinned).length && !packPick} onClick={() => void save()}>Save map</Button>
          <Button icon="grid" onClick={() => rt.navigate(VIEW)}>Open the browser to drag icons</Button>
        </div>
        {config.openNewGroup && null}
      </Container>
    </div>
  );
}

function SlotRow({ slotName, res, pinned, onDrop, onClear, onHide }: { slotName: string; res: IconResolution; pinned?: string; onDrop: (icons: IconRecord[]) => void; onClear: () => void; onHide: () => void }) {
  const drop = useIconDrop(onDrop);
  const ref = parseIconRef(pinned ?? '');
  return (
    <div role="listitem" className={`axp-icon-browser__slot ${drop.over ? 'is-over' : ''} ${pinned ? 'is-changed' : ''}`} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop} title={`Drop an icon to pin ${slotName}`}>
      <span className="axp-icon-browser__thumb"><Icon name={slotName} size={18} /></span>
      <span className="axp-icon-browser__slot-name">{slotName}</span>
      <span className="axp-icon-browser__thumb">{res.via === 'none' ? <Icon name="x" size={14} /> : res.pack ? <GlyphArt pack={res.pack} name={res.glyph} size={18} /> : <Icon name={res.glyph} size={18} />}</span>
      <span className="axp-icon-browser__slot-via">{res.via === 'none' ? 'hidden' : res.via === 'framework' ? 'framework glyph' : `${res.glyph}${res.pack ? ` · ${res.pack}` : ''} (${res.via}${res.from ? ` · ${res.from}` : ''})`}{ref && ref.kind !== 'none' && res.via !== 'slot' ? ` · pinned ${pinned}` : ''}</span>
      <span className="fx-row">
        <IconButton icon="eye" label={`Hide ${slotName}`} onClick={onHide} />
        {pinned && <IconButton icon="undo" label={`Clear the pin on ${slotName}`} onClick={onClear} />}
      </span>
    </div>
  );
}

function Preview({ scopeKey, names, pinned, onDrop }: { scopeKey: ScopeKey; names: string[]; pinned: Record<string, string>; onDrop: (slot: string, icons: IconRecord[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState('');
  const onDragOver = (e: DragEvent, slot: string) => { if (e.dataTransfer.types.includes(ICON_DROP_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(slot); } };
  const onDropAt = (e: DragEvent, slot: string) => { const icons = parseDrag(e.dataTransfer.getData(ICON_DROP_MIME)); setOver(''); setDragging(false); if (icons.length) { e.preventDefault(); onDrop(slot, icons); } };
  const scope = scopeOf(scopeKey);
  return (
    <div className={`axp-icon-browser__preview ${dragging ? 'is-dragging' : ''}`} onDragEnter={() => setDragging(true)} onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) { setDragging(false); setOver(''); } }} aria-label="Live preview">
      <IconScope {...scope}>
        <div className="fx-row fx-row--wrap" style={{ gap: 'var(--fx-dens-gap-lg)' }}>
          {names.map((n) => (
            <span key={n} className={`axp-icon-browser__thumb ${over === n ? 'is-over' : ''} ${pinned[n] ? 'is-changed' : ''}`} style={{ width: 'auto', height: 'auto', padding: 'var(--fx-dens-gap-sm)', display: 'inline-grid', justifyItems: 'center', gap: 'var(--fx-dens-gap-xs)' }} title={`${n}${pinned[n] ? ` · pinned ${pinned[n]}` : ''} — drop an icon to change it`} onDragOver={(e) => onDragOver(e, n)} onDrop={(e) => onDropAt(e, n)} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', n); }}>
              <Icon name={n} size={24} className={over === n ? 'is-over' : ''} />
              <span className="fx-small fx-muted" style={{ fontFamily: 'var(--fx-font-mono)' }}>{n}</span>
            </span>
          ))}
          {names.length === 0 && <p className="fx-muted" style={{ margin: 0 }}>Nothing drawn in this scope yet.</p>}
        </div>
      </IconScope>
    </div>
  );
}

/** Bring a library pack into this app's registry (so the manager and Generate can use it). */
function ImportPack() {
  const rt = useRuntime();
  const [choices, setChoices] = useState<{ value: string; label: string }[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { let live = true; loadLibrary().then((l) => live && setChoices([...l.sets.flatMap((s) => s.packs.map((p) => ({ value: p.id, label: `${s.name}${p.category ? ` · ${p.category}` : ''} (${p.count})` }))), ...l.mine.map((m) => ({ value: m.id, label: `${m.name} (${m.count})` }))]), () => {}); return () => { live = false; }; }, []);
  const have = new Set(rt.registry.list('icon-pack').map((p) => p.id));
  const doImport = async () => {
    if (!pick) return;
    try { const a = await loadPack(pick); const r = rt.importAsset(a, false, ID); rt.toast(r.ok ? `${pick} is now a pack of this app.` : `Refused: ${r.errors?.[0] ?? ''}`, r.ok ? 'success' : 'warning', 'Icon manager'); setPick(''); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Icon manager'); }
  };
  return (
    <div className="fx-row" style={{ alignItems: 'flex-end' }}>
      <SelectField label="Import a library pack" value={pick} onChange={setPick} empty="Pick a pack…" options={choices.filter((c) => !have.has(c.value))} />
      <Button icon="download" disabled={!pick} onClick={() => void doImport()}>Import</Button>
    </div>
  );
}

/* ---------------- the every-icon listing */

function EveryIcon() {
  const rt = useRuntime();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const packs = rt.registry.list('icon-pack');
  const all = useMemo(() => allIcons(packs.map((p) => ({ id: p.id, data: p.data as { glyphs?: Record<string, unknown> } }))), [packs]);
  const shown = useMemo(() => (q ? all.filter((i) => i.name.includes(q.toLowerCase())) : all).slice(0, 600), [all, q]);
  return (
    <Container title={`Every icon in this app (${all.length.toLocaleString()} glyphs in ${packs.length} pack${packs.length === 1 ? '' : 's'})`} icon="grid" collapsible defaultOpen={false} actions={<IconButton icon={open ? 'chevron-up' : 'chevron-down'} label={open ? 'Hide the listing' : 'Show the listing'} onClick={() => setOpen((o) => !o)} />}>
      <p className="fx-muted" style={{ marginTop: 0 }}>The global pack: every glyph of every icon-pack asset this app has (the framework's, imported library packs, packs you composed). Drag any of them onto a slot or the preview. The library itself holds {'>'}11,000 more: import a pack above to bring it in.</p>
      {(open || q) && <>
        <input className="fx-input" type="search" aria-label="Search every icon" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" />
        <div className="fx-row fx-row--wrap" style={{ gap: 'var(--fx-dens-gap-sm)', marginTop: 'var(--fx-dens-gap-md)' }}>
          {shown.map((i) => <span key={i.ref} className="axp-icon-browser__chip" draggable onDragStart={(e) => { e.dataTransfer.setData(ICON_DROP_MIME, dragPayload([{ name: i.name, pack: i.pack, ref: i.ref, set: '', category: '', tags: [], style: '' }], 'every')); e.dataTransfer.effectAllowed = 'copy'; }} title={i.ref}><PackGlyph pack={i.pack} name={i.name} /> {i.name} <span className="fx-muted">· {i.pack}</span></span>)}
          {all.length > shown.length && <span className="fx-small fx-muted">{all.length - shown.length} more: search to narrow.</span>}
        </div>
      </>}
      {!open && !q && <Note tone="info">Switch the whole app's pack with <em>Pack applied to app root</em> above; a screen's or plugin's own pick wins over it.</Note>}
    </Container>
  );
}

/** A glyph of a pack already in the registry (no server round trip). */
function PackGlyph({ pack, name }: { pack: string; name: string }) {
  const rt = useRuntime();
  const loaded = usePackData(pack);
  const data = rt.registry.get('icon-pack', pack)?.data ?? loaded?.data;
  if (!data) return <Icon name={name} size={16} />;
  return <GlyphArt pack={pack} name={name} size={16} />;
}
