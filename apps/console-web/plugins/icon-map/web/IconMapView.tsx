/**
 * The Icon map page: every slot as a searchable, filterable tree (app → plugin / screen owner → surface → slot) or a
 * flat list, each row with a live preview drawn through the runtime (so it shows the pack in force and the pick), and a
 * slot panel where a click on any glyph changes that one place. Writes go through the plugin's console actions, so the
 * page, REST, MCP, the CLI and voice share one path.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Container, Icon, ICON_NAMES, IconButton, SelectField, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { CHANGED, get, packsOf, type MapAnswer, type Slot, VIEW, selectedSlot, setSelectedSlot, SELECTED } from './shared';

const PAGE = 2000;
const APP_PAGE = 6000;
/** Slots shown per surface before "show more". */
const SURFACE_PAGE = 120;
const KINDS = ['icon', 'badge', 'logo'];

type Mode = 'tree' | 'list';
interface SurfaceNode { surface: string; slots: Slot[] }
interface OwnerNode { owner: string; ownerKind: string; count: number; surfaces: SurfaceNode[] }
interface AppNode { app: string; count: number; owners: OwnerNode[] }

/** Group slots into app → owner → surface (sorted, counted). */
export function treeOf(slots: Slot[]): AppNode[] {
  const apps = new Map<string, Map<string, { kind: string; surfaces: Map<string, Slot[]> }>>();
  for (const s of slots) {
    const owners = apps.get(s.app) ?? new Map();
    apps.set(s.app, owners);
    const o = owners.get(s.owner) ?? { kind: s.ownerKind, surfaces: new Map<string, Slot[]>() };
    owners.set(s.owner, o);
    const list = o.surfaces.get(s.surface) ?? [];
    o.surfaces.set(s.surface, list);
    list.push(s);
  }
  return [...apps.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([app, owners]) => {
    const os = [...owners.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([owner, o]) => {
      const surfaces = [...o.surfaces.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([surface, list]) => ({ surface, slots: list }));
      return { owner, ownerKind: o.kind, count: surfaces.reduce((n, x) => n + x.slots.length, 0), surfaces };
    });
    return { app, count: os.reduce((n, x) => n + x.count, 0), owners: os };
  });
}

function SlotRow({ s, picked, active, onOpen }: { s: Slot; picked?: string; active: boolean; onOpen: (id: string) => void }) {
  return (
    <li className={`axp-icon-map__row${picked ? ' is-picked' : ''}${active ? ' is-active' : ''}`} data-slot={s.id}>
      <span className="axp-icon-map__preview"><Icon name={s.glyph || undefined} slot={s.id} role={s.role || undefined} size={20} /></span>
      <div className="axp-icon-map__text">
        <span className="axp-icon-map__id">{s.label || s.id}</span>
        <span className="axp-icon-map__where">{s.id} · {s.kind}{s.role ? ` · role ${s.role}` : ''}{picked ? ` · picked ${picked}` : ''}</span>
      </div>
      <div className="axp-icon-map__actions">
        <Button size="sm" icon="edit" onClick={() => onOpen(s.id)} aria-label={`Change the icon of ${s.id}`}>Change</Button>
      </div>
    </li>
  );
}

/** The slot panel: what the place draws and why, previews at three sizes, and a clickable glyph grid. */
function SlotPanel({ slotId, slots, onClose }: { slotId: string; slots: Slot[]; onClose: () => void }) {
  const rt = useRuntime();
  const [find, setFind] = useState('');
  const [detail, setDetail] = useState<Slot | null>(slots.find((s) => s.id === slotId) ?? null);
  useEffect(() => {
    const known = slots.find((s) => s.id === slotId);
    if (known) { setDetail(known); return; }
    let live = true;
    void get<{ slot: Slot }>(`slot/${slotId.split('/').map(encodeURIComponent).join('/')}`).then((r) => { if (live) setDetail(r.slot); }, () => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [slotId, slots]);
  const res = rt.iconResolution(detail?.glyph ?? '', slotId, detail?.role || undefined);
  const picked = rt.iconOverrides()[slotId];
  const words = find.trim().toLowerCase();
  const glyphs = words ? ICON_NAMES.filter((g) => g.includes(words)) : ICON_NAMES;
  return (
    <Container title="Slot" icon="edit" className="axp-icon-map__panel">
      <div className="fx-stack">
        <div className="axp-icon-map__big">
          {[16, 24, 40].map((n) => <span key={n} className="axp-icon-map__preview"><Icon name={detail?.glyph || undefined} slot={slotId} role={detail?.role || undefined} size={n} /></span>)}
        </div>
        <p className="axp-icon-map__id">{slotId}</p>
        <p className="axp-icon-map__where">{detail ? `${detail.kind} · ${detail.surface} · ${detail.ownerKind} ${detail.owner}${detail.file ? ` · ${detail.file}${detail.line ? `:${detail.line}` : ''}` : ''}` : 'Not in the map yet.'}</p>
        <p className="axp-icon-map__summary">Draws {res.glyph} (decided by {res.via}){picked ? `, picked by hand` : ''}.</p>
        <div className="axp-icon-map__bar">
          <div className="axp-icon-map__grow"><TextField label="Find a glyph" value={find} onChange={(v: string) => setFind(v)} placeholder="check, star, user…" /></div>
          {picked ? <Button icon="undo" onClick={() => rt.dispatch(`icon-map.slot.clear:${slotId}`)}>Clear pick</Button> : null}
          <Button icon="x" onClick={onClose}>Close</Button>
        </div>
        <div className="axp-icon-map__grid" role="listbox" aria-label="Glyphs">
          {glyphs.map((g) => (
            <IconButton key={g} icon={g} size={20} label={`Use ${g}`} aria-pressed={res.glyph === g} onClick={() => rt.dispatch(`icon-map.slot.set:${slotId}:${g}`)} />
          ))}
        </div>
        {!glyphs.length ? <EmptyState icon="search">No glyph matches "{find}".</EmptyState> : null}
      </div>
    </Container>
  );
}

export function IconMapView() {
  const rt = useRuntime();
  const [mode, setMode] = useState<Mode>('tree');
  const [q, setQ] = useState('');
  const [surface, setSurface] = useState('');
  const [app, setApp] = useState('');
  const [kind, setKind] = useState('');
  const [answer, setAnswer] = useState<MapAnswer | null>(null);
  const [more, setMore] = useState<Record<string, Slot[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [slot, setSlot] = useState<string | null>(selectedSlot());
  const [pickPack, setPickPack] = useState('');
  const [tick, setTick] = useState(0);
  const packs = useMemo(() => packsOf(rt), [rt]);
  const activePack = rt.iconPackId();
  const overrides = rt.iconOverrides();

  const filters = useCallback((limit: number, forApp?: string) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (q.trim()) p.set('q', q.trim());
    if (surface) p.set('surface', surface);
    if (forApp || app) p.set('app', forApp || app);
    if (kind) p.set('kind', kind);
    return p;
  }, [q, surface, app, kind]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAnswer(await get<MapAnswer>(`map?${filters(PAGE)}`)); setMore({}); setError(''); }
    catch (e) { setError((e as Error).message || 'The icon map could not be read.'); }
    setLoading(false);
  }, [filters]);
  useEffect(() => { const t = setTimeout(() => void load(), 150); return () => clearTimeout(t); }, [load, tick]);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    const sel = () => setSlot(selectedSlot());
    window.addEventListener(CHANGED, on); window.addEventListener(SELECTED, sel);
    return () => { window.removeEventListener(CHANGED, on); window.removeEventListener(SELECTED, sel); };
  }, []);

  const truncated = !!answer && answer.total > answer.slots.length;
  const slots = useMemo(() => {
    const base = answer?.slots ?? [];
    const extra = Object.values(more).flat();
    if (!extra.length) return base;
    const seen = new Set(base.map((s) => s.id));
    return [...base, ...extra.filter((s) => !seen.has(s.id))];
  }, [answer, more]);
  const tree = useMemo(() => treeOf(slots), [slots]);
  const narrowed = !!(q.trim() || surface || app || kind);
  const isOpen = (key: string, def: boolean) => open[key] ?? def;
  const toggle = (key: string, def: boolean) => setOpen((o) => ({ ...o, [key]: !(o[key] ?? def) }));
  const openApp = async (name: string) => {
    toggle(`a:${name}`, false);
    if (!truncated || more[name]) return;
    try { const r = await get<MapAnswer>(`map?${filters(APP_PAGE, name)}`); setMore((m) => ({ ...m, [name]: r.slots })); } catch { /* the first page stays */ }
  };
  const choose = (id: string) => { setSelectedSlot(id); setSlot(id); };

  const surfaces = Object.keys(answer?.counts?.bySurface ?? {}).sort();
  const apps = Object.keys(answer?.counts?.byApp ?? {}).sort();
  const packLabel = activePack ? (packs.find((p) => p.id === activePack)?.name ?? activePack) : 'framework glyphs';
  const nPicked = Object.keys(overrides).length;

  return (
    <div className="fx-stack fx-stack--lg axp-icon-map" data-axf-screen={VIEW}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Appearance</p>
          <h1>Icon map</h1>
          <p className="fx-muted">Every icon, badge and logo slot in every app, plugin and screen. Switch the pack to change them all, or click a slot to change one place.</p>
        </div>
      </header>

      <Container title="Icon pack" icon="palette">
        <div className="axp-icon-map__bar" role="toolbar" aria-label="Icon pack">
          <div className="axp-icon-map__grow">
            <SelectField label="Pack" value={pickPack || activePack} onChange={(v: string) => setPickPack(v)} options={[{ value: '', label: 'Framework glyphs (branding default)' }, ...packs.map((p) => ({ value: p.id, label: `${p.name} · ${p.style}${p.themable ? ' · themable' : ' · fixed colour'}` }))]} />
          </div>
          <Button tone="primary" icon="check" onClick={() => { if (pickPack || activePack) rt.dispatch(`icon-map.pack.use:${pickPack || activePack}`); }} disabled={!packs.length}>Use pack</Button>
          <Button icon="undo" onClick={() => rt.dispatch('icon-map.pack.clear')} disabled={!activePack}>Back to branding pack</Button>
        </div>
        <p className="axp-icon-map__summary">In force: {packLabel}. {nPicked} place{nPicked === 1 ? '' : 's'} picked by hand.</p>
      </Container>

      <div className={`axp-icon-map__split${slot ? ' has-panel' : ''}`}>
        <Container title="Slots" icon="grid">
          <div className="fx-stack">
            <TabGroup id="icon-map.mode" label="Icon map view" value={mode} onChange={(v) => setMode(v as Mode)} tabs={[{ value: 'tree', label: 'Tree', icon: 'folder' }, { value: 'list', label: 'List', icon: 'list' }]} />
            <div className="axp-icon-map__bar" role="toolbar" aria-label="Filter slots">
              <div className="axp-icon-map__grow"><TextField label="Search" value={q} onChange={(v: string) => setQ(v)} placeholder="id, label, role, glyph, screen or file" /></div>
              <SelectField label="App" value={app} onChange={(v: string) => setApp(v)} options={[{ value: '', label: 'Every app' }, ...apps.map((a) => ({ value: a, label: `${a} (${answer?.counts?.byApp?.[a] ?? 0})` }))]} />
              <SelectField label="Surface" value={surface} onChange={(v: string) => setSurface(v)} options={[{ value: '', label: 'Every surface' }, ...surfaces.map((s) => ({ value: s, label: `${s} (${answer?.counts?.bySurface?.[s] ?? 0})` }))]} />
              <SelectField label="Kind" value={kind} onChange={(v: string) => setKind(v)} options={[{ value: '', label: 'Icons, badges, logos' }, ...KINDS.map((k) => ({ value: k, label: `${k}s (${answer?.counts?.byKind?.[k] ?? 0})` }))]} />
              <Button icon="refresh" onClick={() => rt.dispatch('icon-map.refresh')}>Reload</Button>
            </div>
            {answer ? <p className="axp-icon-map__summary">{answer.total} slot{answer.total === 1 ? '' : 's'}{truncated ? `; the first ${answer.slots.length} are loaded, opening an app loads all of it` : ''}.</p> : null}
            {error ? <EmptyState icon="alert">{error}</EmptyState> : null}
            {loading && !answer ? <LoadingSkeleton rows={6} label="Reading the icon map" /> : null}
            {answer && !slots.length ? <EmptyState icon="search">No slot matches. Try a role (save, approve), a glyph name or a plugin folder.</EmptyState> : null}

            {mode === 'list' && slots.length ? (
              <ul className="axp-icon-map__list">
                {slots.slice(0, shown.list ?? SURFACE_PAGE * 3).map((s) => <SlotRow key={s.id} s={s} picked={overrides[s.id] ?? s.picked} active={slot === s.id} onOpen={choose} />)}
                {slots.length > (shown.list ?? SURFACE_PAGE * 3) ? <li className="axp-icon-map__more"><Button size="sm" onClick={() => setShown((x) => ({ ...x, list: (x.list ?? SURFACE_PAGE * 3) + SURFACE_PAGE * 3 }))}>Show more</Button></li> : null}
              </ul>
            ) : null}

            {mode === 'tree' && slots.length ? (
              <ul className="axp-icon-map__tree" role="tree" aria-label="Icon slots">
                {tree.map((a) => {
                  const ak = `a:${a.app}`;
                  const aOpen = isOpen(ak, narrowed && slots.length <= 300);
                  const full = answer?.counts?.byApp?.[a.app];
                  return (
                    <li key={a.app} role="treeitem" aria-expanded={aOpen}>
                      <Button tone="ghost" icon={aOpen ? 'chevron-down' : 'chevron-right'} onClick={() => void openApp(a.app)}>{a.app} · {narrowed || !full ? a.count : full}</Button>
                      {aOpen ? (
                        <ul role="group">
                          {a.owners.map((o) => {
                            const ok = `o:${a.app}/${o.owner}`;
                            const oOpen = isOpen(ok, narrowed && a.count <= 120);
                            return (
                              <li key={o.owner} role="treeitem" aria-expanded={oOpen}>
                                <Button tone="ghost" size="sm" icon={oOpen ? 'chevron-down' : 'chevron-right'} onClick={() => toggle(ok, narrowed && a.count <= 120)}>{o.owner} ({o.ownerKind}) · {o.count}</Button>
                                {oOpen ? (
                                  <ul role="group">
                                    {o.surfaces.map((sf) => {
                                      const sk = `s:${a.app}/${o.owner}/${sf.surface}`;
                                      const sOpen = isOpen(sk, narrowed && o.count <= 60);
                                      const n = shown[sk] ?? SURFACE_PAGE;
                                      return (
                                        <li key={sf.surface} role="treeitem" aria-expanded={sOpen}>
                                          <Button tone="ghost" size="sm" icon={sOpen ? 'chevron-down' : 'chevron-right'} onClick={() => toggle(sk, narrowed && o.count <= 60)}>{sf.surface} · {sf.slots.length}</Button>
                                          {sOpen ? (
                                            <ul className="axp-icon-map__list" role="group">
                                              {sf.slots.slice(0, n).map((s) => <SlotRow key={s.id} s={s} picked={overrides[s.id] ?? s.picked} active={slot === s.id} onOpen={choose} />)}
                                              {sf.slots.length > n ? <li className="axp-icon-map__more"><Button size="sm" onClick={() => setShown((x) => ({ ...x, [sk]: n + SURFACE_PAGE }))}>Show more</Button></li> : null}
                                            </ul>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </Container>
        {slot ? <SlotPanel slotId={slot} slots={slots} onClose={() => { setSelectedSlot(null); setSlot(null); }} /> : null}
      </div>
    </div>
  );
}
