/**
 * Agent cap console plugin (ai.amberx.axf.console.agent-slots): the console's view of agent-slots@1
 * (framework/cli/agent-slots.mjs), the VPS-wide cap on headless Claude sessions and builds running at once.
 *
 * - Settings → Plugins → Agent cap, and the same panel in the Breakroom's settings (Settings → Plugins → Agent swarm):
 *   max running agents, max heavy test/build steps, memory floor, close-after, priority rules. Saved to the shared
 *   store and read fresh by every launch (hot reload: nothing to restart).
 * - Activity banner summary (slot `activity.summary`): "slots 4/6 · 2 queued".
 * - Builds page (slot `builds.top`) and Build queue screen (slot `build.queue.top`): running + waiting with priority tags, priority and waiting since, Move up and Cancel.
 * - Swarm cards (slot `swarm.agent.status`): on-duty agents past the free slots show "Waiting for a desk".
 *
 * - Hard build limit (build-limit@1, framework/cli/build-limit.mjs, Nov 12 2026): Settings → Plugins → Agent cap shows
 *   the VPS's hard limit with live usage (what really runs on the host), what counts and the axf-builds.slice CPU /
 *   memory caps; only Brett's own signed-in console can change it (the server answers canEdit). The banner chip and the
 *   queue title show "builds 7/8" next to the slots.
 *
 * Polls GET /api/plugins/agent-slots/status every 5 s while a consumer is on screen.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, Icon, PriorityTag, SelectField, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './slots.css';

const FOLDER = 'agent-slots';
const POLL_MS = 5_000;
const LEVELS = ['boss', 'urgent', 'high', 'normal', 'low'] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_LABEL: Record<Level, string> = { boss: 'Boss', urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
const LEVEL_TONE: Record<Level, 'danger' | 'warning' | undefined> = { boss: 'danger', urgent: 'danger', high: 'warning', normal: undefined, low: undefined };

interface Rule { match: string; level: Level }
interface Settings { hardMax?: number; maxAgentsSet?: number; maxAgents: number; maxHeavy: number; minFreeGb: number; closeFinishedAfterSec: number; pollSec: number; priorityRules: Rule[]; guardWarnTrips: number; swapWarnMb: number; swapWarnMin: number }
interface Entry { id: string; name: string; kind: 'headless' | 'swarm' | 'legacy'; priority: Level; build?: string; state: string; session?: string; agent?: string; by?: string; enqueuedAt: string; startedAt?: string; finishedAt?: string; position?: number }
interface Hard { max: number; live: number | null; free: number | null; source?: string; at?: string | null; error?: string }
interface HardItem { kind: 'session' | 'claude' | 'setup' | 'reserved'; name: string; pid?: number; since?: string }
interface HardLimit { max: number; live: number | null; free: number | null; source: string; at: string | null; items: HardItem[]; canEdit: boolean; error?: string
  limit: { maxBuilds: number; cpuQuotaPct: number; memoryMaxGb: number; memoryHighGb: number; tasksMax: number; dockerCpus: number; dockerMemoryGb: number; dockerImages: string; setBy?: string; setAt?: string }
  slice: { name: string; memoryGb?: number; memoryMaxGb?: number | null; cpuQuotaPct?: number | null; tasks?: number; active?: boolean } }
interface Status { used: number; cap: number; free: number; queued: number; hard?: Hard; running: Entry[]; queue: Entry[]; heavy: { used: number; cap: number }; memory: { availGb: number | null; swapMb: number | null; floorGb: number }; guard: { tripsLastHour: number }; settings: Settings; error?: string }

const api = pluginApi(FOLDER, 'Agent cap', { unavailable: 'The Agent cap plugin is switched off or its server part is not running.' });

/* ---------------- one shared poll ---------------- */

let st: { status: Status | null; error: string } = { status: null, error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let again = false;
async function load(): Promise<void> {
  if (inFlight) { again = true; return; } // one request at a time; a call made meanwhile (after an action) runs once after it
  inFlight = true;
  try { const s = await api.call<Status>('status'); set(s.error ? { error: s.error } : { status: s, error: '' }); } catch (e) { set({ error: (e as Error).message }); } finally { inFlight = false; }
  if (again) { again = false; await load(); }
}
/* Module-level on purpose: an inline subscribe is a new function every render, so React re-subscribes after every
   emit; with one consumer that stopped the timer and loaded again at once (a request storm, ~45 calls/s). */
function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) { void load(); timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS); }
  return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
const snapshot = () => st;
function useStatus() {
  return useSyncExternalStore(subscribe, snapshot);
}

const ago = (iso?: string) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};

/* ---------------- activity banner: "slots 4/6 · 2 queued" ---------------- */

function SummaryChip() {
  const { status } = useStatus();
  if (!status) return null;
  const hard = status.hard?.max && status.hard.live != null ? status.hard : null;
  const full = status.used >= status.cap || (hard != null && (hard.live ?? 0) >= hard.max);
  return (
    <span className={`axp-slots__summary${full ? ' is-full' : ''}`} title={`Headless agents: ${status.used} of ${status.cap} slots in use${status.queued ? `, ${status.queued} waiting` : ''}${hard ? `; VPS hard limit: ${hard.live} of ${hard.max} builds really running` : ''} (Settings → Plugins → Agent cap)`}>
      · slots {status.used}/{status.cap}{hard ? ` · builds ${hard.live}/${hard.max}` : ''}{status.queued ? ` · ${status.queued} queued` : ''}
    </span>
  );
}

/* ---------------- Builds page: the queue ---------------- */

function QueuePanel() {
  const rt = useRuntime();
  const { status, error } = useStatus();
  const [busy, setBusy] = useState('');
  if (!status && !error) return null;
  const act = async (id: string, what: 'up' | 'cancel') => {
    setBusy(id);
    try { await api.post(`queue/${encodeURIComponent(id)}/${what}`, {}); await load(); rt.toast(what === 'up' ? 'Moved up' : 'Cancelled: it won\'t start', 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };
  const running = status?.running.filter((r) => r.state !== 'finished') ?? [];
  const hardLine = status?.hard?.max && status.hard.live != null ? ` · VPS limit ${status.hard.live}/${status.hard.max}` : '';
  const title = status ? `Agent slots ${status.used}/${status.cap}${hardLine}${status.queued ? ` · ${status.queued} waiting` : ''}` : 'Agent slots';
  return (
    <Container title={title} icon="layers" className="axp-slots">
      {error && <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {error}</p>}
      {status && (
        <>
          <p className="fx-small fx-muted axp-slots__meta">
            Heavy steps {status.heavy.used}/{status.heavy.cap} · memory {status.memory.availGb ?? '?'} GB free (floor {status.memory.floorGb} GB){status.memory.swapMb ? ` · swap ${status.memory.swapMb} MB` : ''}
          </p>
          {status.queue.length ? (
            <ol className="axp-slots__list" aria-label="Waiting for a slot">
              {status.queue.map((q) => (
                <li key={q.id} className="axp-slots__row">
                  <span className="axp-slots__pos" aria-label={`Position ${q.position}`}>#{q.position}</span>
                  <span className="axp-slots__name"><b>{q.name}</b><span className="fx-small fx-muted">{q.kind === 'swarm' ? 'swarm job' : 'headless session'}{q.by ? ` · ${q.by}` : ''} · waiting {ago(q.enqueuedAt)}</span></span>
                  <PriorityTag build={q.build || q.name} fallback={<Chip tone={LEVEL_TONE[q.priority]}>{LEVEL_LABEL[q.priority] ?? q.priority}</Chip>} />
                  <span className="axp-slots__acts">
                    <Button size="sm" icon="chevron-up" disabled={busy === q.id || q.position === 1} onClick={() => void act(q.id, 'up')}>Move up</Button>
                    <Button size="sm" icon="close" tone="quiet" disabled={busy === q.id} onClick={() => void act(q.id, 'cancel')}>Cancel</Button>
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="fx-small fx-muted">Nothing waiting: new sessions start at once while slots are free.</p>}
          {running.length > 0 && (
            <details className="axp-slots__running" open>
              <summary className="fx-small">Holding a slot ({running.length})</summary>
              <ul className="axp-slots__list">
                {running.map((r) => <li key={r.id} className="axp-slots__row"><span className="axp-slots__name"><b>{r.name}</b><span className="fx-small fx-muted">{r.kind === 'legacy' ? 'started before the cap' : r.kind} · {r.session || r.state} · {ago(r.startedAt)}</span></span><PriorityTag build={r.build || r.name} fallback={<Chip tone={LEVEL_TONE[r.priority]}>{LEVEL_LABEL[r.priority] ?? r.priority}</Chip>} /></li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </Container>
  );
}

/* ---------------- swarm cards: waiting for a desk ---------------- */

/** On-duty agents past the free slots wait for a desk; an agent with a running swarm job has one. */
export function deskState(status: Status, agentId: string, onDuty: string[]): 'desk' | 'waiting' | 'queued' | '' {
  if (!onDuty.includes(agentId)) return '';
  const working = new Set(status.running.filter((r) => r.kind === 'swarm' && r.state !== 'finished' && r.agent).map((r) => r.agent!));
  if (working.has(agentId)) return 'desk';
  if (status.queue.some((q) => q.kind === 'swarm' && q.agent === agentId)) return 'queued';
  const idle = onDuty.filter((id) => !working.has(id));
  return idle.indexOf(agentId) < status.free ? 'desk' : 'waiting';
}

function DeskChip({ agentId, onDuty }: { agentId: string; onDuty: string[] }) {
  const { status } = useStatus();
  if (!status) return null;
  const d = deskState(status, agentId, onDuty);
  if (d !== 'waiting' && d !== 'queued') return null;
  const pos = status.queue.find((q) => q.agent === agentId)?.position;
  return <Chip tone="warning">{d === 'queued' && pos ? `Waiting for a desk · #${pos}` : 'Waiting for a desk'}</Chip>;
}

/* ---------------- the VPS's hard build limit ---------------- */

const KIND_LABEL: Record<HardItem['kind'], string> = { session: 'running', claude: 'claude -p (no tmux)', setup: 'starting up', reserved: 'just admitted' };

function HardLimitPanel() {
  const rt = useRuntime();
  const [h, setH] = useState<HardLimit | null>(null);
  const [err, setErr] = useState('');
  const reload = () => api.call<HardLimit>('hard-limit').then((x) => { if (x.error) setErr(x.error); else { setH(x); setErr(''); } }, (e: Error) => setErr(e.message));
  useEffect(() => { void reload(); const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, POLL_MS); return () => clearInterval(t); }, []);
  const save = async (patch: Partial<HardLimit['limit']>) => {
    try { setH(await api.put<HardLimit>('hard-limit', patch)); void load(); rt.toast('Saved: the VPS applies it to the next launch (slice caps within 30 s)', 'success'); } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (err) return <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {err}</p>;
  if (!h) return <p className="fx-small fx-muted">Loading…</p>;
  const l = h.limit;
  const full = h.live != null && h.live >= h.max;
  const stale = h.source !== 'host' && h.source !== 'snapshot';
  return (
    <div className="fx-stack axp-slots__hard">
      <p className="axp-slots__hard-now" aria-live="polite">
        <Chip tone={full ? 'danger' : undefined}>{h.live ?? '?'}/{h.max} builds running</Chip>{' '}
        <span className="fx-small fx-muted">{full ? 'Full: the VPS refuses new builds until one finishes.' : `${h.free ?? '?'} free.`}{stale ? ' Live count unavailable (the enforcer timer on the VPS is not reporting).' : h.at ? ` Counted ${ago(h.at)} ago.` : ''}</span>
      </p>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Enforced by the VPS itself: every launcher (dispatcher, axHub build_start, swarm, any claude -p) asks it, and it counts what really runs, not the queue. All builds share one systemd slice: CPU {h.slice.cpuQuotaPct ?? l.cpuQuotaPct}%{h.slice.memoryGb != null ? ` · memory ${h.slice.memoryGb}/${h.slice.memoryMaxGb ?? l.memoryMaxGb} GB · ${h.slice.tasks} tasks` : ` · memory max ${l.memoryMaxGb} GB`}. Docker test runs get {l.dockerCpus} CPUs / {l.dockerMemoryGb} GB each.</p>
      {h.items.length > 0 && (
        <details className="axp-slots__running">
          <summary className="fx-small">What counts ({h.items.length})</summary>
          <ul className="axp-slots__list">
            {h.items.map((i) => <li key={`${i.kind}-${i.name}`} className="axp-slots__row"><span className="axp-slots__name"><b>{i.name}</b><span className="fx-small fx-muted">{KIND_LABEL[i.kind] ?? i.kind}{i.pid ? ` · pid ${i.pid}` : ''}{i.since ? ` · ${ago(i.since)}` : ''}</span></span></li>)}
          </ul>
        </details>
      )}
      {h.canEdit ? (
        <>
          <NumberSetting label="Hard limit: builds at once" hint="The VPS refuses the next build past this (default 8)" value={l.maxBuilds} min={1} max={64} onSave={(v) => void save({ maxBuilds: v })} />
          <NumberSetting label="CPU for all builds (%)" hint="100 = one core; the slice's CPUQuota" value={l.cpuQuotaPct} min={50} max={25600} onSave={(v) => void save({ cpuQuotaPct: v })} />
          <NumberSetting label="Memory for all builds (GB)" hint="The slice's MemoryMax; builds slow down near it and are stopped past it" value={l.memoryMaxGb} min={1} max={1024} onSave={(v) => void save({ memoryMaxGb: v })} />
          <NumberSetting label="Docker test run CPUs" hint="--cpus on node:* / Playwright containers" value={l.dockerCpus} min={0.25} max={64} step={0.25} onSave={(v) => void save({ dockerCpus: v })} />
          <NumberSetting label="Docker test run memory (GB)" hint="--memory on node:* / Playwright containers" value={l.dockerMemoryGb} min={0.25} max={256} step={0.25} onSave={(v) => void save({ dockerMemoryGb: v })} />
        </>
      ) : <p className="fx-small fx-muted" style={{ margin: 0 }}><Icon name="lock" size={14} /> Only Brett changes these, from his own signed-in console.</p>}
      {l.setBy && <p className="fx-small fx-muted" style={{ margin: 0 }}>Last set by {l.setBy}{l.setAt ? `, ${ago(l.setAt)} ago` : ''}.</p>}
    </div>
  );
}

/* ---------------- settings ---------------- */

function NumberSetting({ label, hint, value, min, max, step = 1, onSave }: { label: string; hint: string; value: number; min: number; max: number; step?: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const n = Number(v);
  const bad = v === '' || !Number.isFinite(n) || n < min || n > max;
  return (
    <div className="axp-slots__num">
      <TextField label={label} type="number" value={v} onChange={setV} hint={hint} error={bad ? `${min}–${max}` : undefined} />
      <Button size="sm" disabled={bad || n === value} onClick={() => onSave(Math.round(n / step) * step)}>Save</Button>
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  const [rule, setRule] = useState<Rule>({ match: '', level: 'urgent' });
  const reload = () => api.call<Settings>('settings').then((x) => { setS(x); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void reload(); const f = () => { if (document.visibilityState === 'visible') void reload(); }; window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, []);
  const save = async (patch: Partial<Settings>) => {
    try { setS(await api.put<Settings>('settings', patch)); void load(); rt.toast('Saved: the next launch uses it', 'success'); } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (err) return <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {err}</p>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  const addRule = () => {
    try { new RegExp(rule.match, 'i'); } catch { rt.toast('That pattern is not a valid regular expression', 'danger'); return; }
    void save({ priorityRules: [...s.priorityRules, rule] }); setRule({ match: '', level: 'urgent' });
  };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>One cap for every headless Claude session on the VPS: console launches, axHub build_start, orchestrator runs and swarm agents. Extras wait in line and start by themselves.</p>
      <NumberSetting label="Max running agents" hint={`Sessions and swarm jobs at once (default 6; never above the VPS hard limit${s.hardMax ? ` of ${s.hardMax}` : ''})`} value={s.maxAgents} min={1} max={64} onSave={(v) => void save({ maxAgents: v })} />
      <NumberSetting label="Max heavy steps at once" hint="pnpm/vite builds, docker node:22 test runs, Playwright (default 3)" value={s.maxHeavy} min={1} max={32} onSave={(v) => void save({ maxHeavy: v })} />
      <NumberSetting label="Memory floor (GB)" hint="Don't start a new one while less memory than this is free (default 2; 0 = off)" value={s.minFreeGb} min={0} max={64} step={0.5} onSave={(v) => void save({ minFreeGb: v })} />
      <NumberSetting label="Close finished sessions after (s)" hint="The result stays on screen this long, then the window closes; the log stays (default 120)" value={s.closeFinishedAfterSec} min={0} max={86400} onSave={(v) => void save({ closeFinishedAfterSec: v })} />
      <div>
        <p className="fx-small" style={{ margin: 0 }}><b>Priority rules</b> <span className="fx-muted">· first match on the session name wins; Boss, then Urgent, start first; same priority = first come, first served</span></p>
        <ul className="axp-slots__list">
          {s.priorityRules.map((r, i) => (
            <li key={`${r.match}-${i}`} className="axp-slots__row">
              <span className="axp-slots__name fx-mono">{r.match}</span>
              <Chip tone={LEVEL_TONE[r.level]}>{LEVEL_LABEL[r.level]}</Chip>
              <Button size="sm" icon="close" tone="quiet" onClick={() => void save({ priorityRules: s.priorityRules.filter((_, j) => j !== i) })}>Remove</Button>
            </li>
          ))}
        </ul>
        <div className="axp-slots__num">
          <TextField label="Name matches (regex)" value={rule.match} onChange={(m) => setRule({ ...rule, match: m })} mono placeholder="^hotfix" />
          <SelectField label="Priority" value={rule.level} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} onChange={(l) => setRule({ ...rule, level: l as Level })} />
          <Button size="sm" icon="plus" disabled={!rule.match.trim()} onClick={addRule}>Add rule</Button>
        </div>
      </div>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Systems check warns when the memory guard holds starts {s.guardWarnTrips}+ times in an hour, or swap stays over {s.swapWarnMb} MB for {s.swapWarnMin} min.</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.agent-slots',
  label: 'Agent cap',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-01' },
  appMenu,
  settingsTabs: [{ id: FOLDER, label: 'Agent cap', icon: 'layers', order: 46, parent: 'plugins' }],
  settingsPanels: [
    { id: 'agent-slots.hard-limit', tab: FOLDER, title: 'VPS hard build limit', icon: 'lock', order: 5, render: () => <HardLimitPanel /> },
    { id: 'agent-slots.settings', tab: FOLDER, title: 'Agent cap', icon: 'layers', order: 10, render: () => <SettingsPanel /> },
    { id: 'agent-slots.queue', tab: FOLDER, title: 'Queue', icon: 'list', order: 20, render: () => <QueuePanel /> },
    { id: 'agent-slots.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  slots: {
    'activity.summary': [{ id: 'agent-slots.summary', render: () => <SummaryChip /> }],
    'builds.top': [{ id: 'agent-slots.queue', render: () => <QueuePanel /> }],
    'build.queue.top': [{ id: 'agent-slots.build-queue', render: () => <QueuePanel /> }], // the real queue, on the Build queue screen
    // the Breakroom (agent swarm) settings show the same panel: one store, so a change in either place is the same change
    'swarm.settings.desks': [{ id: 'agent-slots.desks', render: () => <SettingsPanel /> }],
    'swarm.agent.status': [{ id: 'agent-slots.desk', render: (p) => <DeskChip agentId={String(p.agentId ?? '')} onDuty={Array.isArray(p.onDuty) ? (p.onDuty as string[]) : []} /> }],
  },
};
