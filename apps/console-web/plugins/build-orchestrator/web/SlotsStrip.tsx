import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { focusBuild } from './focus';
import { fillApi, type FillStatus, type SlotRow } from './fill';

/*
 * Slots strip (fill every slot, Nov 13 2026): one chip per agent slot on the VPS, saying which build and step runs
 * there (a parallel step session shows its step; the build's own session shows the build) or that it is free, then what
 * the next dispatcher round would start (planFill dry run) and a "Fill now" button. Data: GET pipeline/fill (the same as
 * the MCP command pipeline-fill-status, `pipeline.mjs fill status`, `agent-slots.mjs fill` and the voice action).
 * Deep link: console_show `builds/pipeline/slots` (the strip scrolls into view and flashes). Layout is a strip asset
 * choice: chips (default), grid or list (UI Review options), set by the settings sub-tab.
 */

export type SlotsLayout = 'chips' | 'grid' | 'list';
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
const REFRESH_MS = 10_000;
export const SLOTS_ANCHOR = 'builds-pipeline-slots';

const label = (r: SlotRow) => (r.state === 'free' ? 'free' : `${r.build || r.name}${r.step ? ` · ${r.step}` : ''}`);
const tone = (r: SlotRow): 'accent' | 'success' | undefined => (r.state === 'free' ? undefined : r.step ? 'accent' : 'success');

export function SlotsStrip({ api, layout = 'chips', onData }: { api: Api; layout?: SlotsLayout; onData?: (f: FillStatus) => void }) {
  const rt = useRuntime();
  const fill = fillApi(api);
  const [f, setF] = useState<FillStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const load = async () => {
    try { const r = await fill.status(); setF(r); setError(''); onData?.(r); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    const tickIt = () => { if (document.visibilityState === 'visible') void load(); };
    timer.current = window.setInterval(tickIt, REFRESH_MS);
    document.addEventListener('visibilitychange', tickIt);
    return () => { if (timer.current) window.clearInterval(timer.current); document.removeEventListener('visibilitychange', tickIt); };
  }, []);
  const runNow = async () => {
    setBusy(true);
    try { const r = await fill.run(); rt.toast(r.ran ? `Round run: ${r.fill?.launched.length ?? 0} parallel step(s) started` : r.note ?? 'Filed: the dispatcher runs a round within a minute', 'success'); await load(); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  if (!f) return error ? <p className="fx-small fx-muted" id={SLOTS_ANCHOR}>Slots: {error}</p> : null;
  const next = f.plan.launches;
  return (
    <section className="pl-slots fx-stack" id={SLOTS_ANCHOR} aria-label="Agent slots">
      <div className={`pl-slots__row pl-slots--${layout}`} role="toolbar" aria-label="Agent slots" data-axf-toolbar="build-orchestrator.slots">
        {f.slots.rows.map((r) => (
          <span key={r.n} className="pl-slots__slot" title={r.state === 'free' ? `Slot ${r.n} is free` : `Slot ${r.n}: ${r.build || r.name}${r.step ? ` step ${r.step} (parallel step session)` : " (the build's own session)"} · ${r.state}${r.session ? ` · ${r.session}` : ''}`}>
            {r.state === 'free' ? <Chip>{r.n} · free</Chip>
              : <Button size="sm" tone="neutral" icon={r.step ? 'branch' : 'play'} onClick={() => { if (r.build) focusBuild(r.build); }}>{r.n} · {label(r)}</Button>}
          </span>
        ))}
        <Button size="sm" tone="neutral" icon="zap" disabled={busy || !f.settings.fillSlots} title={f.settings.fillSlots ? 'Run one dispatcher round now: ready steps start in the free slots' : 'Fill every slot is off (Settings → Plugins → Build orchestrator)'} onClick={() => void runNow()}>Fill now</Button>
      </div>
      <p className="fx-small fx-muted">
        <Icon name="layers" size={13} /> {f.slots.used}/{f.slots.cap} in use · {f.slots.free} free · fill every slot {f.settings.fillSlots ? 'on' : 'off'} · up to {f.settings.maxParallelPerBuild} parallel steps per build
        {next.length ? ` · next: ${next.map((l) => `${l.id}${l.step ? ` ${l.step}` : ''} on ${l.account}`).join(', ')}` : f.plan.blocked ? ` · ${f.plan.blocked}` : ''}
      </p>
    </section>
  );
}

/** The badge on a build: "N steps running in parallel" (nothing when none). */
export function ParallelBadge({ n }: { n: number }) {
  if (!n) return null;
  return <Chip tone="accent">{n} step{n === 1 ? '' : 's'} running in parallel</Chip>;
}
