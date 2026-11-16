/**
 * Pending banner console plugin (ai.amberx.axf.console.pending-banner).
 *
 * Brett, Nov 16 2026: "I need a pending banner that lists all the pending things and lets me send everything to the
 * queue right from the banner."
 *
 * A banner while builds wait in Pending: a head row with the count badge, Send all to Queue and the bulk moves for the
 * ticked rows, then one row per build (title, what it does in plain words, priority, steps done / total, why it is in
 * Pending) with Queue, Hold, Archive and Open. Launches expanded (useBannerLaunchOpen); collapsed it keeps the head row
 * and the first few builds. Joins the one Banners settings through `label`, `icon` and `settingsTab` on its banner.
 *
 * API (Brett, Nov 8 2026: everything comes with an API): the same list and moves are
 *   REST     GET /api/plugins/pending-banner/list · POST queue {ids | all} · POST hold {ids} · POST archive {ids}
 *   MCP/CLI  the plugin's auto commands (plugin-commands@1) over the same routes
 *   control  pending-banner.open[:<build>] · queue:<id,id> · queue-all · hold:<id,id> · archive:<id,id> · check
 *            (console control, Ctrl+K and AmberX voice run these actions); every button carries its own address.
 * Runtime counter `builds.pending` (the count) for other widgets.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { BannerIcon, Button, Checkbox, Chip, Icon, Note, useBannerLaunchOpen } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './pending-banner.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.pending-banner';
const FOLDER = 'pending-banner';
const POLL_MS = 20_000;
const COLLAPSED_ROWS = 3;
const api = pluginApi(FOLDER, 'Pending banner');

export interface PendingRow {
  id: string; title: string; what: string; priority: string; done: number; total: number; minutesLeft: number;
  nextModel: string; needsSplit: boolean; why: { kind: 'fell-back' | 'new'; text: string; at: string };
}
interface ListReply { rows: PendingRow[]; count: number; at: number }
interface MoveReply { action: string; done: { id: string }[]; refused: { id: string; error: string }[]; pending: number; line: string }
type Move = 'queue' | 'hold' | 'archive';

/* ---------------- store ---------------- */

interface State { rows: PendingRow[]; loaded: boolean; error: string; busy: string; picked: string[]; result: { ok: boolean; text: string } | null; expand: number }
let st: State = { rows: [], loaded: false, error: '', busy: '', picked: [], result: null, expand: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const usePending = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

let runtime: AxfRuntime | null = null;

export async function refresh(fresh = false): Promise<void> {
  try {
    const r = await api.call<ListReply>(`list${fresh ? '?fresh=true' : ''}`);
    const ids = new Set(r.rows.map((x) => x.id));
    set({ rows: r.rows, loaded: true, error: '', picked: st.picked.filter((id) => ids.has(id)) });
    runtime?.setBadge('builds.pending', r.count);
  } catch (e) {
    set({ loaded: true, error: (e as Error).message });
  }
}

/** One move on one build or many. `all` = every build in Pending (Send all to Queue). */
export async function move(action: Move, ids: string[], all = false): Promise<MoveReply | null> {
  if (!all && !ids.length) return null;
  set({ busy: all ? 'queue:all' : `${action}:${ids.join(',')}`, result: null });
  try {
    const r = await api.post<MoveReply>(action, all ? { all: true } : { ids });
    const refused = r.refused.length ? ` Refused: ${r.refused.map((x) => `${x.id} (${x.error})`).join('; ')}` : '';
    set({ result: { ok: !r.refused.length, text: `${verb(action)} ${r.done.length}. ${r.pending} left in Pending.${refused}` }, picked: [] });
    return r;
  } catch (e) {
    set({ result: { ok: false, text: (e as Error).message } });
    return null;
  } finally {
    set({ busy: '' });
    void refresh(true);
  }
}
const verb = (a: Move) => (a === 'queue' ? 'Queued' : a === 'hold' ? 'Queued on hold' : 'Archived');

let timer: ReturnType<typeof setInterval> | null = null;
const onFocus = () => void refresh();
function start() {
  if (timer) return;
  void refresh();
  timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
  globalThis.addEventListener('focus', onFocus);
}

/** Open the orchestrator on a build (or its Pending tab). */
function openBuild(id?: string) {
  if (!runtime) return;
  if (id) runtime.dispatch(`build-orchestrator.focus:${id}`);
  else runtime.dispatch('build-orchestrator.tab:pending');
}

/* ---------------- the banner ---------------- */

const ids = (arg?: string) => decodeURIComponent(arg ?? '').split(',').map((x) => x.trim()).filter(Boolean);

function Row({ r }: { r: PendingRow }) {
  const s = usePending();
  const picked = s.picked.includes(r.id);
  const busy = s.busy.split(':')[1]?.split(',').includes(r.id) || s.busy === 'queue:all';
  const toggle = (on: boolean) => set({ picked: on ? [...s.picked, r.id] : s.picked.filter((x) => x !== r.id) });
  return (
    <div className="axp-pending-banner__row" data-axf-target={`row:pending-banner/${r.id}`} data-why={r.why.kind}>
      <Checkbox label={<span className="axp-pending-banner__hidden">Select {r.title}</span>} checked={picked} onChange={toggle} title="Select for a bulk move" />
      <div className="axp-pending-banner__body">
        <div className="axp-pending-banner__line">
          <strong className="axp-pending-banner__title" title={r.title}>{r.title}</strong>
          {r.priority && <Chip tone={/^(P0|High|Urgent)/i.test(r.priority) ? 'danger' : undefined}>{r.priority}</Chip>}
          <span className="fx-small fx-muted axp-pending-banner__steps" title={`${r.done} of ${r.total} steps done${r.minutesLeft ? `, about ${r.minutesLeft} min left` : ''}`}>{r.total ? `${r.done}/${r.total} steps` : 'not split yet'}</span>
        </div>
        {r.what && <p className="fx-small axp-pending-banner__what" title={r.what}>{r.what}</p>}
        <p className="fx-small fx-muted axp-pending-banner__why" title={r.why.text}>
          <Icon name={r.why.kind === 'fell-back' ? 'undo' : 'plus'} size={12} /> {r.why.text}
        </p>
      </div>
      <div className="axp-pending-banner__acts" role="toolbar" aria-label={`Moves for ${r.title}`}>
        <Button size="sm" tone="primary" icon="play" id={`pending-queue-${r.id}`} disabled={busy} onClick={() => void move('queue', [r.id])}>Queue</Button>
        <Button size="sm" icon="pause" id={`pending-hold-${r.id}`} disabled={busy} title="Into the Queue on hold: keeps its place, nothing starts until you release it" onClick={() => void move('hold', [r.id])}>Hold</Button>
        <Button size="sm" tone="ghost" icon="package" id={`pending-archive-${r.id}`} disabled={busy} confirm={`Archive "${r.title}"?`} undoable onClick={() => void move('archive', [r.id])}>Archive</Button>
        <Button size="sm" tone="ghost" icon="external" id={`pending-open-${r.id}`} onClick={() => openBuild(r.id)}>Open</Button>
      </div>
    </div>
  );
}

function PendingBanner() {
  const s = usePending();
  const [open, setOpen] = useBannerLaunchOpen(); // launches expanded unless its Banner settings say minimized
  useEffect(() => { start(); }, []);
  // pending-banner.open (deep link, voice, MCP): expand and bring the banner into view
  useEffect(() => { if (!s.expand) return; setOpen(true); document.querySelector('.axp-pending-banner')?.scrollIntoView({ block: 'nearest' }); }, [s.expand]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s.rows.length) return null;
  const n = s.rows.length;
  const shown = open ? s.rows : s.rows.slice(0, COLLAPSED_ROWS);
  const more = n - shown.length;
  const allPicked = s.picked.length === n;
  const fellBack = s.rows.filter((r) => r.why.kind === 'fell-back').length;
  return (
    <div className="axp-pending-banner" role="region" aria-label="Pending builds" data-axf-not-banner="the content of BannerDef pending: the framework banner frame draws the banner around it">
      <div className="axp-pending-banner__head">
        <BannerIcon icon="clock" working={!!s.busy} size={20} />
        <button type="button" data-fx-row data-axf-target="button:pending-banner.toggle" className="axp-pending-banner__text" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="axp-pending-banner__count" aria-label={`${n} pending`}>{n}</span>
          <span className="axp-pending-banner__headline">build{n === 1 ? '' : 's'} waiting in Pending{fellBack ? ` · ${fellBack} fell back` : ''}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
        <div className="axp-pending-banner__acts" role="toolbar" aria-label="Pending banner">
          <Checkbox label="All" checked={allPicked} indeterminate={s.picked.length > 0 && !allPicked} onChange={(v) => set({ picked: v ? s.rows.map((r) => r.id) : [] })} title="Select every build" />
          {s.picked.length > 0 && <>
            <Button size="sm" tone="primary" icon="play" id="pending-queue-picked" disabled={!!s.busy} onClick={() => void move('queue', s.picked)}>Queue {s.picked.length}</Button>
            <Button size="sm" icon="pause" id="pending-hold-picked" disabled={!!s.busy} onClick={() => void move('hold', s.picked)}>Hold {s.picked.length}</Button>
            <Button size="sm" tone="ghost" icon="package" id="pending-archive-picked" disabled={!!s.busy} confirm={`Archive ${s.picked.length} build${s.picked.length === 1 ? '' : 's'}?`} undoable onClick={() => void move('archive', s.picked)}>Archive {s.picked.length}</Button>
          </>}
          <Button size="sm" tone="primary" icon="play" id="pending-queue-all" busy={s.busy === 'queue:all'} disabled={!!s.busy} confirm={`Send all ${n} pending build${n === 1 ? '' : 's'} to the Queue?`} onClick={() => void move('queue', [], true)}>Send all to Queue</Button>
        </div>
      </div>
      {s.result && <Note tone={s.result.ok ? 'success' : 'warning'}>{s.result.text}</Note>}
      {shown.map((r) => <Row key={r.id} r={r} />)}
      {more > 0 && (
        <button type="button" data-fx-row data-axf-target="button:pending-banner.more" className="axp-pending-banner__more fx-small fx-muted" onClick={() => setOpen(true)}>…and {more} more</button>
      )}
    </div>
  );
}

/* ---------------- settings ---------------- */

function StatusPanel() {
  const s = usePending();
  useEffect(() => { void refresh(true); }, []);
  return (
    <div className="fx-stack">
      <p className="axp-pending-banner__flat">A banner while builds wait in Pending. Each row says what the build does, its priority, steps done and why it is in Pending, with Queue, Hold (into the Queue, held), Archive and Open. Tick several for a bulk move, or Send all to Queue. A build landing in Pending sends one notice to AmberX (Plugins → Notifications → A build landed in Pending).</p>
      <p className="fx-small axp-pending-banner__flat"><strong>{s.error ? `Couldn't read Pending: ${s.error}` : `${s.rows.length} in Pending now.`}</strong></p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" onClick={() => void refresh(true)}>Check now</Button>
        <Button icon="external" onClick={() => openBuild()}>Pending tab in the orchestrator</Button>
      </div>
      <p className="fx-small fx-muted axp-pending-banner__flat">Same list and moves without the banner: REST /api/plugins/pending-banner (GET list, POST queue / hold / archive), MCP and the CLI (plugin commands), console control and voice (pending-banner.open, queue, queue-all, hold, archive).</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID,
  label: 'Pending banner',
  version: '0.1.0',
  provides: ['banner.pending'],
  register(rt) {
    runtime = rt;
    const note = (r: MoveReply | null) => { if (r) rt.toast?.(r.line); };
    rt.actions.register('pending-banner.open', ([arg]) => { const id = ids(arg)[0]; if (id) openBuild(id); else { set({ expand: st.expand + 1 }); void refresh(true); } }, { label: 'Show the Pending banner (or one pending build: pending-banner.open:<id>)', effect: 'navigate' });
    rt.actions.register('pending-banner.queue', ([arg]) => void move('queue', ids(arg)).then(note), { label: 'Send pending builds to the Queue (pending-banner.queue:<id,id>)', params: true, effect: 'write' });
    rt.actions.register('pending-banner.queue-all', () => void move('queue', [], true).then(note), { label: 'Send every pending build to the Queue', effect: 'write' });
    rt.actions.register('pending-banner.hold', ([arg]) => void move('hold', ids(arg)).then(note), { label: 'Put pending builds in the Queue on hold (pending-banner.hold:<id,id>)', params: true, effect: 'write' });
    rt.actions.register('pending-banner.archive', ([arg]) => void move('archive', ids(arg)).then(note), { label: 'Archive pending builds (pending-banner.archive:<id,id>)', params: true, effect: 'destructive' });
    rt.actions.register('pending-banner.check', () => void refresh(true), { label: 'Check the Pending list now', effect: 'read' });
    start();
  },
  banners: [{ id: 'pending', label: 'Pending builds', icon: 'clock', settingsTab: 'pending-banner', order: 7, render: () => <PendingBanner /> }],
  settingsTabs: [{ id: 'pending-banner', label: 'Pending banner', icon: 'clock', parent: 'plugins', order: 46, description: 'Every build waiting in Pending, queued from the banner.' }],
  settingsPanels: [
    { id: 'pending-banner.status', tab: 'pending-banner', title: 'Now', icon: 'clock', order: 10, render: () => <StatusPanel /> },
    { id: 'pending-banner.lifecycle', tab: 'pending-banner', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
