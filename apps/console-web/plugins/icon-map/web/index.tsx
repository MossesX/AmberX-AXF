/**
 * Icon map console plugin (ai.amberx.axf.console.icon-map; icon-map@1, framework/core/engines/icon-map-rules.mjs).
 *
 * Every icon, badge and logo slot in every app, plugin and screen, searchable, with a live preview; the icon pack in
 * force (one pick changes every icon) and per-slot picks (one place). State is the plugin's icons.json on the server;
 * this file applies it to the runtime (rt.setIconPack / rt.setIconSlot) on load and every few seconds, and writes it
 * back when a pick is made here, so REST, MCP, the CLI, voice and the page never disagree.
 *
 * Reach: View → Icon map, nav `icon-map`, the actions icon-map.open / icon-map.pack.use:<pack> / icon-map.pack.clear /
 * icon-map.slot.set:<slot>:<glyph> / icon-map.slot.clear:<slot> / icon-map.refresh (search, voice, `function:` control
 * targets), Settings → Plugins → Icon map.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Container, Icon, ICON_NAMES, SelectField, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import './icon-map.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.icon-map';
/** The folder under plugins/ — the server routes live at /api/plugins/icon-map/. */
const FOLDER = 'icon-map';
const VIEW = 'icon-map';
/** Fired on window when the state changed (the page re-reads). */
const CHANGED = 'axf:icon-map-changed';
const POLL_MS = 20000;
const PAGE = 300;

interface Slot { id: string; kind: string; role: string; glyph: string; surface: string; label: string; app: string; owner: string; ownerKind: string; screen: string; source: string; file: string; line: number; picked?: string }
interface MapAnswer { ok: boolean; slots: Slot[]; total: number; counts?: { bySurface?: Record<string, number>; byApp?: Record<string, number> }; pack: string }
interface State { ok: boolean; pack: string; slots: Record<string, string> }
interface PackRow { id: string; name: string; style: string; themable: boolean; covers: string[] }

/* ------------------------------------------------------------------ server */

const json = async <T,>(r: Response): Promise<T> => { if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`); return (await r.json()) as T; };
const get = <T,>(path: string) => pluginFetch(FOLDER, path).then((r) => json<T>(r));
const send = <T,>(method: 'PUT' | 'DELETE', path: string, body: unknown = {}) => pluginFetch(FOLDER, path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r));
const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');

/* ------------------------------------------------------------------ runtime */

/** The icon packs this app ships (registry assets of type icon-pack). */
function packsOf(rt: AxfRuntime): PackRow[] {
  return rt.registry.all().filter((a) => a.type === 'icon-pack').map((a) => {
    const d = (a.data ?? {}) as { style?: string; themable?: boolean; covers?: string[]; tags?: string[] };
    return { id: a.id, name: a.name || a.id, style: d.style ?? 'outline', themable: d.themable !== false, covers: d.covers ?? ['icons'] };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** A pack by id, else by a word of its name, style or tags ("duotone", "filled", "amberx"); the same rule as the server's. */
export function findPack(packs: PackRow[], words: string): PackRow | null {
  const w = words.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!w) return null;
  const exact = packs.find((p) => p.id === w);
  if (exact) return exact;
  const parts = w.replace(/\b(the|icon|icons|pack|set|please)\b/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return packs.find((p) => { const hay = `${p.id} ${p.name.toLowerCase()} ${p.style}`; return parts.every((x) => hay.includes(x)); }) ?? null;
}

/** Make the runtime draw what the server state says (pack + every pick); true when something changed. */
function applyState(rt: AxfRuntime, state: State): boolean {
  let changed = false;
  if ((rt.iconPackId() || '') !== (state.pack || '') && (!state.pack || rt.registry.has('icon-pack', state.pack))) { rt.setIconPack(state.pack || null); changed = true; }
  const have = rt.iconOverrides();
  for (const [slot, glyph] of Object.entries(state.slots ?? {})) if (have[slot] !== glyph) { rt.setIconSlot(slot, glyph); changed = true; }
  for (const slot of Object.keys(have)) if (!(slot in (state.slots ?? {}))) { rt.setIconSlot(slot, null); changed = true; }
  return changed;
}

let lastState = '';
async function pull(rt: AxfRuntime, force = false): Promise<void> {
  try {
    const s = await get<State>('state');
    const key = JSON.stringify([s.pack, s.slots]);
    if (!force && key === lastState) return;
    lastState = key;
    applyState(rt, s);
    window.dispatchEvent(new Event(CHANGED));
  } catch { /* server part off: the runtime keeps its saved picks */ }
}

/* ------------------------------------------------------------------ the page */

function IconMapView() {
  const rt = useRuntime();
  const [q, setQ] = useState('');
  const [surface, setSurface] = useState('');
  const [app, setApp] = useState('');
  const [answer, setAnswer] = useState<MapAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [pickPack, setPickPack] = useState('');
  const [tick, setTick] = useState(0);
  const packs = useMemo(() => packsOf(rt), [rt]);
  const activePack = rt.iconPackId();
  const overrides = rt.iconOverrides();
  const glyphs = ICON_NAMES;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (q.trim()) params.set('q', q.trim());
      if (surface) params.set('surface', surface);
      if (app) params.set('app', app);
      setAnswer(await get<MapAnswer>(`map?${params}`));
      setError('');
    } catch (e) { setError((e as Error).message || 'The icon map could not be read.'); }
    setLoading(false);
  }, [q, surface, app]);
  useEffect(() => { const t = setTimeout(() => void load(), 150); return () => clearTimeout(t); }, [load, tick]);
  useEffect(() => { const on = () => setTick((n) => n + 1); window.addEventListener(CHANGED, on); return () => window.removeEventListener(CHANGED, on); }, []);
  useEffect(() => { void pull(rt, true); }, [rt]);

  const usePack = async (id: string) => { if (!rt.dispatch(`icon-map.pack.use:${id}`)) rt.toast('Your role cannot change the look.', 'danger', 'Icon map'); };
  const clearPack = () => { rt.dispatch('icon-map.pack.clear'); };
  const pick = (slot: string, glyph: string) => { rt.dispatch(`icon-map.slot.set:${slot}:${glyph}`); setPicking(null); };
  const clear = (slot: string) => { rt.dispatch(`icon-map.slot.clear:${slot}`); };

  const surfaces = Object.keys(answer?.counts?.bySurface ?? {}).sort();
  const apps = Object.keys(answer?.counts?.byApp ?? {}).sort();
  const rows = answer?.slots ?? [];
  const packLabel = activePack ? (packs.find((p) => p.id === activePack)?.name ?? activePack) : 'framework glyphs';

  return (
    <div className="fx-stack fx-stack--lg axp-icon-map" data-axf-screen={VIEW}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Appearance</p>
          <h1>Icon map</h1>
          <p className="fx-muted">Every icon, badge and logo slot in every app, plugin and screen: switch the pack to change them all, or pick one place.</p>
        </div>
      </header>

      <Container title="Icon pack" icon="palette">
        <div className="axp-icon-map__bar">
          <div className="axp-icon-map__grow">
            <SelectField label="Pack" value={pickPack || activePack} onChange={(v: string) => setPickPack(v)} options={[{ value: '', label: 'Framework glyphs (branding default)' }, ...packs.map((p) => ({ value: p.id, label: `${p.name} · ${p.style}${p.themable ? '' : ' · fixed colour'}` }))]} />
          </div>
          <Button tone="primary" icon="check" onClick={() => void usePack(pickPack || activePack)} disabled={!packs.length}>Use pack</Button>
          <Button icon="undo" onClick={clearPack} disabled={!activePack}>Back to branding pack</Button>
        </div>
        <p className="axp-icon-map__summary">In force: {packLabel}. {Object.keys(overrides).length} place{Object.keys(overrides).length === 1 ? '' : 's'} picked by hand.</p>
      </Container>

      <Container title="Slots" icon="grid">
        <div className="axp-icon-map__bar">
          <div className="axp-icon-map__grow"><TextField label="Search" value={q} onChange={(v: string) => setQ(v)} placeholder="id, role, glyph, screen or file" /></div>
          <SelectField label="Surface" value={surface} onChange={(v: string) => setSurface(v)} options={[{ value: '', label: 'Every surface' }, ...surfaces.map((s) => ({ value: s, label: `${s} (${answer?.counts?.bySurface?.[s] ?? 0})` }))]} />
          <SelectField label="App" value={app} onChange={(v: string) => setApp(v)} options={[{ value: '', label: 'Every app' }, ...apps.map((a) => ({ value: a, label: `${a} (${answer?.counts?.byApp?.[a] ?? 0})` }))]} />
          <Button icon="refresh" onClick={() => rt.dispatch('icon-map.refresh')}>Reload</Button>
        </div>
        {answer ? <p className="axp-icon-map__summary">{answer.total} slot{answer.total === 1 ? '' : 's'}{answer.total > rows.length ? `, first ${rows.length} shown (search to narrow)` : ''}.</p> : null}
        {error ? <EmptyState icon="alert">{error}</EmptyState> : null}
        {loading && !answer ? <LoadingSkeleton rows={6} label="Reading the icon map" /> : null}
        {answer && !rows.length ? <EmptyState icon="search">No slot matches. Try a role (save, approve), a glyph name or a plugin folder.</EmptyState> : null}
        {rows.length ? (
          <ul className="axp-icon-map__list">
            {rows.map((s) => {
              const picked = overrides[s.id] ?? s.picked;
              return (
                <li key={s.id} className={`axp-icon-map__row${picked ? ' is-picked' : ''}`}>
                  <span className="axp-icon-map__preview"><Icon name={s.glyph || undefined} slot={s.id} role={s.role || undefined} size={20} /></span>
                  <div className="axp-icon-map__text">
                    <span className="axp-icon-map__id">{s.id}</span>
                    <span className="axp-icon-map__where">{s.kind} · {s.surface}{s.role ? ` · role ${s.role}` : ''}{s.glyph ? ` · glyph ${s.glyph}` : ''}{picked ? ` · picked ${picked}` : ''}{s.file ? ` · ${s.file}${s.line ? `:${s.line}` : ''}` : ''}</span>
                  </div>
                  <div className="axp-icon-map__actions">
                    {picking === s.id ? (
                      <SelectField label="Glyph" value={picked ?? s.glyph} onChange={(v: string) => pick(s.id, v)} options={glyphs.map((g) => ({ value: g, label: g }))} />
                    ) : (
                      <Button icon="edit" onClick={() => setPicking(s.id)}>Pick</Button>
                    )}
                    {picked ? <Button icon="x" onClick={() => clear(s.id)}>Clear</Button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Container>
    </div>
  );
}

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Every icon, badge and logo slot in the console and its plugins, with the icon pack in force and per-slot picks.</p>
      <p className="fx-muted" style={{ margin: 0 }}>Also on the API: REST /api/plugins/icon-map, MCP icon-map_* tools, the CLI (axf icon-map …) and voice ("switch to the duotone icon pack").</p>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="grid" onClick={() => rt.dispatch(`nav:${VIEW}`)}>Open icon map</Button>
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Icon map',
  version: '0.1.0',
  appMenu,
  register(rt) {
    const packs = () => packsOf(rt);
    const say = (text: string, tone: 'success' | 'warning' | 'danger' = 'success') => rt.toast(text, tone, 'Icon map');
    rt.actions.register('icon-map.open', () => rt.dispatch(`nav:${VIEW}`), { label: 'Icon map', effect: 'navigate' });
    rt.actions.register('icon-map.pack.use', (args) => {
      const words = args.join(':');
      const p = findPack(packs(), words);
      if (!p) { say(`No icon pack matches "${words}". Packs: ${packs().map((x) => x.id).join(', ') || 'none'}.`, 'warning'); return; }
      if (!rt.setIconPack(p.id)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('PUT', 'pack', { pack: p.id, by: 'console' }).then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say(`${p.name} is the icon pack.`);
    }, { label: 'Switch the icon pack', params: true, effect: 'write' });
    rt.actions.register('icon-map.pack.clear', () => {
      if (!rt.setIconPack(null)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('DELETE', 'pack').then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say('Back to the branding’s icon pack.');
    }, { label: 'Back to the branding icon pack', effect: 'write' });
    rt.actions.register('icon-map.slot.set', ([slot, glyph]) => {
      if (!slot || !glyph) { say('Say which slot and which glyph: icon-map.slot.set:<slot id>:<glyph>.', 'warning'); return; }
      if (!rt.setIconSlot(slot, glyph)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('PUT', `slot/${enc(slot)}`, { glyph, by: 'console' }).then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say(`${slot} draws ${glyph}.`);
    }, { label: 'Pick one slot’s icon', params: true, effect: 'write' });
    rt.actions.register('icon-map.slot.clear', ([slot]) => {
      if (!slot) { say('Say which slot: icon-map.slot.clear:<slot id>.', 'warning'); return; }
      if (!rt.setIconSlot(slot, null)) { say('Your role cannot change the look.', 'danger'); return; }
      void send('DELETE', `slot/${enc(slot)}`).then(() => window.dispatchEvent(new Event(CHANGED)), () => undefined);
      say(`${slot} follows the pack again.`);
    }, { label: 'Drop one slot’s pick', params: true, effect: 'write' });
    rt.actions.register('icon-map.refresh', () => { void pull(rt, true); }, { label: 'Reload the icon map', effect: 'read' });
    // the server's state is the one every transport writes: follow it
    void pull(rt);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void pull(rt); }, POLL_MS);
    window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
  },
  views: { [VIEW]: { title: 'Icon map', icon: 'grid', render: () => <IconMapView /> } },
  nav: { label: 'Appearance', items: [{ id: VIEW, label: 'Icon map', icon: 'grid', view: VIEW }] },
  settingsTabs: [{ id: 'icon-map', label: 'Icon map', icon: 'grid', order: 62, parent: 'plugins' }],
  settingsPanels: [
    { id: 'icon-map.open', tab: 'icon-map', title: 'Icon map', icon: 'grid', order: 5, render: () => <OpenPanel /> },
    { id: 'icon-map.lifecycle', tab: 'icon-map', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
