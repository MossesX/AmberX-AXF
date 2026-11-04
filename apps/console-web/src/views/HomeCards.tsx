/**
 * Home cards: one card engine draws any data (card@1 + home-layout@1, framework/core/engines/card-rules.mjs; Brett,
 * Nov 3 2026: "I shouldn't need to build cards. I should draw dynamic data."). A card is a binding to a read: any
 * plugin read command from the plugin-commands@1 registry (served by control@1 at /api/control/<plugin>/<command>) or
 * one of the console's own reads below. The engine picks the value out of the result and the view that draws it;
 * the framework's DataCard draws it with theme tokens only. No code, no agents and no tokens to make or show a card.
 *
 * The layout (own cards, order, sizes, hidden, dismissed suggestions) is saved per user on axHub through
 * GET/PUT /api/home/layout (a local copy keeps Home drawn while the server is away). The console's five starter
 * cards are card@1 assets in src/assets/card; a plugin may add starters (card assets it registers) and draw its own
 * read as a panel (src/cardPanels.tsx), e.g. the Profile switcher's Build profiles card.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react';
import {
  CARD_DROP_MIME, LIVE_FALLBACK_MS, applyLayout, cardFromDrop, cardKey, cardModel, cardSources, cardViews, defaultFields,
  fieldsOf, homeCards, liveHit, normalizeCard, normalizeLayout, pathGet, pickView, reduceValue, applyWhere, refreshMs, suggestCards,
  type CardData, type CardSourceEntry, type HomeCard, type HomeLayout, type HomeStarter, type LayoutOp,
} from '../axf/core/engines/card-rules.mjs';
import { Button, CardBody, DataCard, IconButton, Note, SelectField, Segmented, TextField, useRuntime } from '../axf/react';
import type { AxfRuntime } from '../axf/core';
import { authHeaders } from '../axf/libs/apiclient';
import { consoleTokens, readLocal, writeLocal, type Status } from '../api';
import { pluginFetch } from '../plugins';
import { useStore, type ConsoleStore } from '../store';
import { cardPanel, useCardPanels } from '../cardPanels';
import { PlanSummaryCard } from './Plan';
import { BuildSummaryCard } from './BuildManager';

/* ------------------------------------------------------------------ the console's own reads (source kind "console") */

const TABS: [string, string][] = [['foundations', 'Foundations'], ['kernel', 'Kernel'], ['console', 'Console'], ['modules', 'Modules'], ['demos', 'Demos']];

interface ConsoleRead { title: string; read: (s: ConsoleStore) => unknown; panel?: () => ReactNode; open?: string }

/** Reads the console answers itself (open registry: add one here and every card picker offers it). */
export const CONSOLE_READS: Record<string, ConsoleRead> = {
  'plan.summary': { title: 'Plan summary', read: () => ({ panel: true }), panel: () => <PlanSummaryCard />, open: 'plan' },
  'builds.summary': { title: 'Build summary', read: () => ({ panel: true }), panel: () => <BuildSummaryCard />, open: 'builds' },
  'tracker.coverage': {
    title: 'Coverage per tracker tab', open: 'tracker',
    read: (s) => TABS.map(([id, label]) => { const c = s.coverage(id) as Record<Status, number>; const total = Math.max(1, Object.values(c).reduce((a, b) => a + b, 0)); return { id, label, ...c, total }; }),
  },
  'console.project': {
    title: 'Project and engine',
    read: (s) => ({
      'Open project': s.project || 'none (installs and imports need one)',
      'Build engine': s.backend ? 'online' : 'offline (commands are recorded for Claude Code)',
      Libraries: `${s.libraries.length} installable · ${s.modules.length} Android modules`,
      Boilerplates: s.boilerplates.length,
      'MCP endpoint': s.backend ? `${location.origin}/mcp (Bearer AXF_TOKEN)` : 'local: python3 apps/console-web/server/mcp_server.py',
    }),
  },
  'console.ports': {
    title: 'Recent installs & imports', open: 'libraries',
    read: (s) => [...s.ports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ name: p.name, status: p.status, detail: `${p.kind} · ${p.source}${p.project ? ` → ${p.project}` : ''}`, at: p.createdAt })),
  },
};

const CONSOLE_SOURCE: CardSourceEntry[] = Object.entries(CONSOLE_READS).map(([id, r]) => ({ plugin: 'console', name: 'Console', command: id, title: r.title, description: '', params: [], generic: false }));

/* ------------------------------------------------------------------ the layout store (one per console, per user) */

const LOCAL_KEY = 'home-layout';
type Where = 'hub' | 'local' | 'offline';
interface LayoutState { layout: HomeLayout; loaded: boolean; where: Where; user: string }

let starters: HomeStarter[] = [];
let state: LayoutState = { layout: normalizeLayout(readLocal(LOCAL_KEY, null)), loaded: false, where: 'offline', user: '' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let edits = 0;

async function api(method: 'GET' | 'PUT', body?: unknown) {
  const r = await fetch('/api/home/layout', { method, headers: authHeaders(consoleTokens, body ? { headers: { 'content-type': 'application/json' } } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (!r.ok) throw new Error(`home layout ${r.status}`);
  return r.json() as Promise<{ layout?: unknown; user?: string; where?: Where }>;
}

export const homeLayout = {
  get: () => state,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  setStarters(list: HomeStarter[]) { starters = list; state = { ...state, layout: normalizeLayout(state.layout, starters) }; },
  async load() {
    const at = edits;
    try {
      const r = await api('GET');
      if (edits !== at) return; // the user changed Home while it loaded: keep theirs (it is being saved)
      state = { layout: normalizeLayout(r.layout ?? readLocal(LOCAL_KEY, null), starters), loaded: true, where: r.where ?? 'hub', user: r.user ?? '' };
    } catch {
      state = { ...state, layout: normalizeLayout(readLocal(LOCAL_KEY, null), starters), loaded: true, where: 'offline' };
    }
    emit();
  },
  apply(op: LayoutOp) {
    edits++;
    state = { ...state, layout: applyLayout(state.layout, op, starters) };
    writeLocal(LOCAL_KEY, state.layout);
    emit();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { api('PUT', { layout: state.layout }).then((r) => { if (r.where && r.where !== state.where) { state = { ...state, where: r.where }; emit(); } }, () => { state = { ...state, where: 'offline' }; emit(); }); }, 400);
  },
  cards: (): HomeCard[] => homeCards(state.layout, starters),
};

export const useHomeLayout = () => useSyncExternalStore(homeLayout.subscribe, homeLayout.get);

/** The card@1 assets this app ships (src/assets/card), as Home's starters. */
export function startersOf(rt: AxfRuntime): HomeStarter[] {
  return rt.registry.all().filter((a) => a.type === 'card').map((a) => ({ id: a.id, data: a.data as Partial<CardData> }));
}

/* ------------------------------------------------------------------ the live feed (/api/events, one stream for all cards) */

const liveSubs = new Set<(channel: string) => void>();
let liveStream: EventSource | null = null;
function onLive(fn: (channel: string) => void) {
  liveSubs.add(fn);
  if (!liveStream && typeof EventSource !== 'undefined') {
    liveStream = new EventSource('/api/events');
    liveStream.onmessage = (ev) => { try { const l = JSON.parse(ev.data) as { channel?: string }; liveSubs.forEach((f) => f(String(l.channel ?? ''))); } catch { /* keepalive */ } };
  }
  return () => { liveSubs.delete(fn); if (!liveSubs.size && liveStream) { liveStream.close(); liveStream = null; } };
}

/* ------------------------------------------------------------------ reading a card's data */

/** Reads in flight or just answered, by URL: cards on the same source share one read (each read costs the server two node runs). */
const recent = new Map<string, { at: number; p: Promise<unknown> }>();
const SHARE_MS = 3000;

/** One plugin read through control@1 → its value (the read's own answer). */
export function readCommand(plugin: string, command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const q = new URLSearchParams(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])).toString();
  const url = `/api/control/${encodeURIComponent(plugin)}/${encodeURIComponent(command)}${q ? `?${q}` : ''}`;
  const hit = recent.get(url);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.p;
  const p = readUrl(url, `${plugin}/${command}`);
  recent.set(url, { at: Date.now(), p });
  p.finally(() => { const x = recent.get(url); if (x?.p === p) recent.set(url, { at: Date.now(), p }); }).catch(() => undefined);
  return p;
}

async function readUrl(url: string, name: string): Promise<unknown> {
  const r = await fetch(url, { headers: authHeaders(consoleTokens), cache: 'no-store' });
  const body = await r.json().catch(() => null) as ({ ok?: boolean; value?: unknown; message?: string; detail?: string } & Record<string, unknown>) | null;
  if (!r.ok || !body || body.ok === false) throw new Error(body?.message || body?.detail || `${name} answered ${r.status}`);
  // route reads answer { value }; the runner's own reads (info, data) put their fields beside the control@1 envelope
  if ('value' in body) return body.value;
  const { $axf: _a, ok: _o, op: _p, target: _t, path: _h, action: _c, audit: _d, ...rest } = body;
  return rest;
}

/** A card's result, kept fresh: every N s, on the live feed (with a slow fallback), or by hand (`reload`). */
export function useCardResult(card: CardData, store: ConsoleStore) {
  const [res, setRes] = useState<{ value?: unknown; error?: string; at?: number }>({});
  const [tick, setTick] = useState(0);
  const key = cardKey(card);
  const isConsole = card.source.kind === 'console';
  useEffect(() => {
    if (isConsole || !card.source.plugin || !card.source.command) return;
    let live = true;
    const go = () => readCommand(card.source.plugin ?? '', card.source.command ?? '', card.args).then((value) => live && setRes({ value, at: Date.now() }), (e) => live && setRes((r) => ({ ...r, error: String(e?.message ?? e) })));
    void go();
    const ms = refreshMs(card) || (card.refresh.kind === 'live' ? LIVE_FALLBACK_MS : 0);
    const timer = ms ? setInterval(go, ms) : undefined;
    let last = 0;
    const off = card.refresh.kind === 'live' ? onLive((ch) => { if (liveHit(card, ch) && Date.now() - last > 2000) { last = Date.now(); void go(); } }) : undefined;
    return () => { live = false; if (timer) clearInterval(timer); off?.(); };
  }, [key, card.refresh.kind, card.refresh.every, tick, isConsole]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isConsole) {
    const r = CONSOLE_READS[card.source.id ?? ''];
    return { value: r ? r.read(store) : undefined, error: r ? undefined : `The console has no read ${card.source.id}.`, loading: false, reload: () => setTick((t) => t + 1) };
  }
  return { value: res.value, error: res.value === undefined ? res.error : undefined, loading: res.at === undefined && !res.error, reload: () => setTick((t) => t + 1) };
}

/* ------------------------------------------------------------------ one card on Home */

const HOME_CARD_CTX = 'cx-home.card';
export const HOME_CARD_DRAG = 'application/x-axf-home-card';

/** The renderer a `panel` card uses: a console read's own panel, or one a plugin registered for its read. */
export function panelOf(card: CardData): (() => ReactNode) | undefined {
  if (card.view !== 'panel') return undefined;
  return card.source.kind === 'console' ? CONSOLE_READS[card.source.id ?? '']?.panel : cardPanel(card.source.plugin, card.source.command);
}

export function HomeCardView(props: { entry: HomeCard; index: number; onDropAt: (e: DragEvent, index: number) => void }) {
  useCardPanels();
  const { card } = props.entry;
  const panel = panelOf(card);
  if (panel) return <HomeCardFrame {...props}>{(drag) => <div {...drag} data-fx-ctx-target={HOME_CARD_CTX} data-fx-ctx-payload={props.entry.id}>{panel()}</div>}</HomeCardFrame>;
  // a plugin panel whose plugin is off: draw the read's data with the engine's own view pick
  return <HomeDataCard {...props} entry={card.view === 'panel' ? { ...props.entry, card: { ...card, view: 'auto' } } : props.entry} />;
}

type DragProps = Record<string, unknown> & { className: string };

/** Drag to move and drop-target behaviour every Home card shares. */
function HomeCardFrame({ entry, index, onDropAt, children }: { entry: HomeCard; index: number; onDropAt: (e: DragEvent, index: number) => void; children: (drag: DragProps) => ReactNode }) {
  const [over, setOver] = useState(false);
  const drag: DragProps = {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData(HOME_CARD_DRAG, entry.id); e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e: DragEvent) => { if (accepts(e)) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { setOver(false); onDropAt(e, index); },
    className: `cx-homecard${over ? ' is-over' : ''} fx-dcard--${entry.size}`,
    'data-card': entry.id,
  };
  return <>{children(drag)}</>;
}

function HomeDataCard({ entry, index, onDropAt }: { entry: HomeCard; index: number; onDropAt: (e: DragEvent, index: number) => void }) {
  const s = useStore();
  const rt = useRuntime();
  const { card } = entry;
  const { value, error, loading, reload } = useCardResult(card, s);
  const model = useMemo(() => (value === undefined ? null : cardModel({ ...card, size: entry.size }, value)), [value, card, entry.size]);
  const more = (
    <IconButton icon="more" label={`${card.title}: card menu`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); rt.openContext(r.left, r.bottom, HOME_CARD_CTX, entry.id); }} />
  );
  return (
    <HomeCardFrame entry={entry} index={index} onDropAt={onDropAt}>{(drag) => (
      <div {...drag}>
        <DataCard
          title={card.title || 'Card'} icon={card.icon} model={model} loading={loading} error={error} size={entry.size}
          ctx={HOME_CARD_CTX} ctxPayload={entry.id}
          actions={<>{card.source.kind === 'command' && <IconButton icon="refresh" label="Read again" onClick={reload} />}{more}</>}
        />
      </div>
    )}</HomeCardFrame>
  );
}

const accepts = (e: DragEvent) => [HOME_CARD_DRAG, CARD_DROP_MIME, 'text/plain'].some((t) => e.dataTransfer.types.includes(t));

/* ------------------------------------------------------------------ the Home card menu + actions */

const VIEW_LABEL: Record<string, string> = Object.fromEntries(cardViews().map((v) => [v.id, v.label]));
const SIZES: [string, string][] = [['s', 'Small'], ['m', 'Medium'], ['l', 'Tall'], ['wide', 'Wide']];

/** The card context menu (right-click / long-press / ⋯) and the `home.card` action every item runs. */
export function useHomeCardMenu(rt: AxfRuntime) {
  useEffect(() => {
    rt.contextExtras.set(HOME_CARD_CTX, (_t, id) => {
      const c = homeLayout.cards().find((x) => x.id === id);
      if (!c) return [];
      const panel = c.card.view === 'panel';
      return [
        { id: 'edit', label: c.starter ? 'Edit a copy' : 'Edit card', icon: 'edit', action: `dialog:home-card:${id}` },
        ...(panel ? [] : [{ id: 'view', label: 'Change view', icon: 'grid', items: cardViews().filter((v) => v.id !== 'panel').map((v) => ({ id: `view-${v.id}`, label: v.label, icon: v.icon, action: `home.card:view:${id}:${v.id}`, checked: c.card.view === v.id ? 'true' : undefined })) }]),
        { id: 'size', label: 'Size', icon: 'layout', items: SIZES.map(([k, l]) => ({ id: `size-${k}`, label: l, action: `home.card:size:${id}:${k}`, checked: c.size === k ? 'true' : undefined })) },
        { id: 'open', label: 'Open plugin', icon: 'external', action: `home.card:open:${id}` },
        { id: 'sep', separator: true },
        { id: 'hide', label: 'Hide', icon: 'minus', action: `home.card:hide:${id}` },
        ...(c.starter ? [] : [{ id: 'remove', label: 'Remove', icon: 'trash', action: `home.card:remove:${id}` }]),
      ];
    });
    const off = rt.actions.register('home.card', (args) => {
      const [verb = '', id = '', val = ''] = args;
      const c = homeLayout.cards().find((x) => x.id === id);
      if (!c) return;
      if (verb === 'size') homeLayout.apply({ op: 'size', id, size: val as 's' | 'm' | 'l' | 'wide' });
      else if (verb === 'hide') homeLayout.apply({ op: 'hide', id });
      else if (verb === 'remove') homeLayout.apply({ op: 'remove', id });
      else if (verb === 'view') {
        if (c.starter) { homeLayout.apply({ op: 'add', card: { ...c.card, view: val, fields: {} }, at: homeLayout.get().layout.order.indexOf(id) }); homeLayout.apply({ op: 'hide', id }); }
        else homeLayout.apply({ op: 'update', id, card: { ...c.card, view: val, fields: {} } });
      } else if (verb === 'open') {
        const src = c.card.source;
        rt.navigate(src.kind === 'command' ? (src.plugin ?? 'home') : (CONSOLE_READS[src.id ?? '']?.open ?? 'home'));
      }
    }, { label: 'Home card', params: true });
    return () => { rt.contextExtras.delete(HOME_CARD_CTX); off(); };
  }, [rt]);
}

/* ------------------------------------------------------------------ Add card / Edit card */

const REDUCES: [string, string][] = [['none', 'As it is'], ['count', 'Count'], ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Lowest'], ['max', 'Highest'], ['first', 'First'], ['last', 'Last']];

/** The plugin read registry (plugin-commands@1) as card sources, plus the console's own reads. */
function useSources() {
  const [list, setList] = useState<CardSourceEntry[] | null>(null);
  const [registry, setRegistry] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    pluginFetch('plugin-commands', 'registry').then((r) => r.json()).then((reg) => { if (live) { setRegistry(reg); setList([...CONSOLE_SOURCE, ...cardSources(reg)]); } }, () => live && setList(CONSOLE_SOURCE));
    return () => { live = false; };
  }, []);
  return { sources: list, registry };
}

/**
 * The card dialog: pick any plugin → any of its reads → see the live result → pick a view (the smart default from the
 * data's shape is preselected) → pick fields → Save. `id` edits a card (a starter is saved as a copy); `draft` starts
 * from a dropped hook or a suggestion.
 */
export function HomeCardDialog({ id, draft, at, close }: { id?: string; draft?: CardData; at?: number; close: () => void }) {
  const s = useStore();
  const existing = id ? homeLayout.cards().find((c) => c.id === id) : undefined;
  const [card, setCard] = useState<CardData>(() => normalizeCard(existing?.card ?? draft ?? { source: { kind: 'command', plugin: '', command: '' }, view: 'auto' }));
  const { sources } = useSources();
  const [argsText, setArgsText] = useState(() => (Object.keys(card.args).length ? JSON.stringify(card.args) : '{}'));
  const [whereText, setWhereText] = useState(() => (Object.keys(card.where).length ? JSON.stringify(card.where) : ''));
  const set = (patch: Partial<CardData>) => setCard((c) => normalizeCard({ ...c, ...patch }));
  const plugin = card.source.kind === 'console' ? 'console' : card.source.plugin ?? '';
  const command = card.source.kind === 'console' ? card.source.id ?? '' : card.source.command ?? '';
  const plugins = useMemo(() => [...new Map((sources ?? []).map((x) => [x.plugin, x.name])).entries()], [sources]);
  const reads = (sources ?? []).filter((x) => x.plugin === plugin);
  const chosen = reads.find((x) => x.command === command);
  const preview = useCardResult(card, s);
  const picked = useMemo(() => reduceValue(applyWhere(pathGet(preview.value, card.path), card.where), card.reduce), [preview.value, card.path, card.where, card.reduce]);
  const auto = pickView(picked);
  const view = card.view === 'auto' ? auto : card.view;
  const roles = cardViews().find((v) => v.id === view)?.fields ?? [];
  const fields = fieldsOf(picked);
  const prefill = defaultFields(view, picked);
  const model = preview.value === undefined ? null : cardModel(card, preview.value);
  const topKeys = useMemo(() => (preview.value && typeof preview.value === 'object' && !Array.isArray(preview.value) ? Object.keys(preview.value as object).slice(0, 30) : []), [preview.value]);
  const pickSource = (p: string, c: string) => {
    const src = (sources ?? []).find((x) => x.plugin === p && x.command === c);
    const title = card.title && existing ? card.title : src ? (p === 'console' ? src.title : `${src.name}: ${src.title}`) : '';
    setCard(normalizeCard({ ...card, title, source: p === 'console' ? { kind: 'console', id: c } : { kind: 'command', plugin: p, command: c }, view: p === 'console' && CONSOLE_READS[c]?.panel ? 'panel' : 'auto', path: '', fields: {}, where: {}, reduce: 'none', args: {} }));
    setArgsText('{}'); setWhereText('');
  };
  const save = () => {
    let args: Record<string, unknown> = {}; let where: Record<string, unknown> = {};
    try { args = JSON.parse(argsText || '{}'); where = whereText.trim() ? JSON.parse(whereText) : {}; } catch { return; }
    const out = normalizeCard({ ...card, args, where, title: card.title || chosen?.title || 'Card' });
    if (existing && !existing.starter) homeLayout.apply({ op: 'update', id: existing.id, card: out });
    else {
      const order = homeLayout.get().layout.order;
      homeLayout.apply({ op: 'add', card: out, at: existing ? order.indexOf(existing.id) : at });
      if (existing?.starter) homeLayout.apply({ op: 'hide', id: existing.id });
    }
    close();
  };
  const ready = !!command && (plugin === 'console' ? !!CONSOLE_READS[command] : !!plugin);
  return (
    <div className="fx-stack cx-cardpick">
      {existing?.starter && <Note tone="info">This is one of the console's starter cards: saving keeps your copy in its place and hides the starter (Show all brings it back).</Note>}
      <div className="cx-cardpick__row">
        <SelectField label="Plugin" value={plugin} onChange={(p) => { const first = (sources ?? []).find((x) => x.plugin === p); if (first) pickSource(p, first.command); }} options={[{ value: '', label: sources ? 'Pick a plugin' : 'Loading…' }, ...plugins.map(([v, l]) => ({ value: v, label: l }))]} />
        <SelectField label="Read" value={command} onChange={(c) => pickSource(plugin, c)} options={reads.length ? reads.map((r) => ({ value: r.command, label: r.title === r.command ? r.command : `${r.title} (${r.command})` })) : [{ value: '', label: 'Pick a plugin first' }]} />
      </div>
      {chosen && chosen.params.length > 0 && <TextField label={`Input (JSON: ${chosen.params.join(', ')})`} value={argsText} onChange={(v) => { setArgsText(v); try { set({ args: JSON.parse(v || '{}') }); } catch { /* typing */ } }} mono />}
      {card.view !== 'panel' && (
        <>
          <div className="cx-cardpick__row">
            <TextField label="Path into the result" value={card.path} onChange={(v) => set({ path: v })} placeholder={topKeys.length ? `e.g. ${topKeys.slice(0, 3).join(', ')}` : 'empty = the whole result'} mono />
            <SelectField label="Fold a list" value={card.reduce} onChange={(v) => set({ reduce: v as CardData['reduce'] })} options={REDUCES.map(([v, l]) => ({ value: v, label: l }))} />
          </div>
          {topKeys.length > 0 && !card.path && <div className="fx-row fx-row--wrap">{topKeys.map((k) => <Button key={k} size="sm" onClick={() => set({ path: k })}>{k}</Button>)}</div>}
          <TextField label="Keep only (JSON, e.g. {&quot;status&quot;: &quot;waiting&quot;})" value={whereText} onChange={(v) => { setWhereText(v); try { set({ where: v.trim() ? JSON.parse(v) : {} }); } catch { /* typing */ } }} mono />
          <Segmented label="View" value={card.view} onChange={(v) => set({ view: v, fields: {} })} options={[{ value: 'auto', label: `Auto (${VIEW_LABEL[auto] ?? auto})` }, ...cardViews().filter((v) => v.id !== 'panel').map((v) => ({ value: v.id, label: v.label }))]} />
          {view === 'chart' && <Segmented label="Chart" value={card.chart} onChange={(v) => set({ chart: v as CardData['chart'] })} options={[{ value: 'line', label: 'Line' }, { value: 'bar', label: 'Bars' }, { value: 'spark', label: 'Spark' }]} />}
          {roles.length > 0 && fields.length > 0 && (
            <div className="cx-cardpick__row">
              {roles.filter((r) => r !== 'columns').map((r) => (
                <SelectField key={r} label={r} value={String(card.fields[r] ?? '')} onChange={(v) => set({ fields: { ...card.fields, [r]: v } })} options={[{ value: '', label: `Auto${prefill[r] ? ` (${String(prefill[r])})` : ''}` }, ...fields.map((f) => ({ value: f.id, label: f.id }))]} />
              ))}
            </div>
          )}
        </>
      )}
      <div className="cx-cardpick__row">
        <TextField label="Title" value={card.title} onChange={(v) => set({ title: v })} />
        <SelectField label="Refresh" value={card.refresh.kind === 'every' ? String(card.refresh.every) : card.refresh.kind} onChange={(v) => set({ refresh: v === 'live' || v === 'manual' ? { kind: v, every: card.refresh.every, channels: card.refresh.channels } : { kind: 'every', every: Number(v), channels: [] } })}
          options={[{ value: 'live', label: 'Live' }, { value: '15', label: 'Every 15 s' }, { value: '60', label: 'Every minute' }, { value: '300', label: 'Every 5 min' }, { value: '3600', label: 'Every hour' }, { value: 'manual', label: 'By hand' }]} />
        <SelectField label="Size" value={card.size} onChange={(v) => set({ size: v as CardData['size'] })} options={SIZES.map(([v, l]) => ({ value: v, label: l }))} />
      </div>
      <div className="cx-cardpick__preview">
        <p className="fx-eyebrow">Live preview {preview.loading && ready ? '· reading…' : ''}</p>
        {panelOf(card) ? panelOf(card)?.() : <CardBody model={ready ? model : null} loading={ready && preview.loading} error={ready ? preview.error : undefined} />}
      </div>
      <div className="fx-row cx-cardpick__actions">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="check" onClick={save} disabled={!ready}>{existing && !existing.starter ? 'Save card' : 'Add card'}</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Suggested cards */

/** One-tap starter set made from whatever read commands exist (core suggestCards), never hand-built. */
export function useSuggestions() {
  const { registry } = useSources();
  const { layout } = useHomeLayout();
  const have = homeLayout.cards().filter((c) => !c.hidden).map((c) => c.card);
  return useMemo(() => (registry ? suggestCards(registry, have).filter((x) => !layout.dismissed.includes(x.id)) : []), [registry, layout]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Add a suggested card; when the same card is on Home but hidden (a starter can't be removed), show it again. */
function addSuggested(card: CardData) {
  const k = cardKey(card);
  const hidden = homeLayout.cards().find((c) => c.hidden && cardKey(c.card) === k);
  if (hidden) homeLayout.apply({ op: 'show', id: hidden.id });
  else homeLayout.apply({ op: 'add', card });
}

export function SuggestedCards({ onDone }: { onDone?: () => void }) {
  const list = useSuggestions();
  if (!list.length) return null;
  return (
    <section className="cx-suggest" aria-label="Suggested cards">
      <span className="fx-muted fx-small">Suggested cards</span>
      {list.map((x) => (
        <span key={x.id} className="cx-suggest__item" draggable onDragStart={(e) => e.dataTransfer.setData(CARD_DROP_MIME, JSON.stringify(x.card))}>
          <Button size="sm" icon="plus" onClick={() => { addSuggested(x.card); onDone?.(); }}>{x.card.title}</Button>
          <IconButton icon="x" label={`Not now: ${x.card.title}`} onClick={() => homeLayout.apply({ op: 'dismiss', suggestion: x.id })} />
        </span>
      ))}
      <Button size="sm" tone="primary" icon="plus" onClick={() => { list.forEach((x) => addSuggested(x.card)); onDone?.(); }}>Add all</Button>
    </section>
  );
}

/* ------------------------------------------------------------------ drops onto Home (drop-target for hooks and reads) */

/**
 * What Home does with a drop at `index`: a Home card moves there; a card draft, a plugin read reference or a control@1
 * path opens the card dialog prefilled. (Home is the drop target; the shared hook@1 / drop-target@1 contract from the
 * toolbar build isn't on main yet, so Home reads CARD_DROP_MIME and plain text the same way that contract will.)
 */
export function dropOnHome(rt: AxfRuntime, e: DragEvent, index: number) {
  e.preventDefault();
  const moved = e.dataTransfer.getData(HOME_CARD_DRAG);
  if (moved) { homeLayout.apply({ op: 'move', id: moved, to: index }); return; }
  const draft = cardFromDrop(e.dataTransfer.getData(CARD_DROP_MIME) || e.dataTransfer.getData('text/plain'));
  if (draft) rt.openDialog('home-card', { draft, at: index });
  else rt.toast('That can\'t be drawn as a card: drop a plugin read, a hook or a card.', 'info', 'Home');
}

