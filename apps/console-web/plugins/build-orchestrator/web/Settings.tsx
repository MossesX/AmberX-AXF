import { useEffect, useState } from 'react';
import { Note, SelectField, Switch, useRuntime } from '@console/axf/react';
import * as consoleApi from '@console/api';
import { fillApi, type FillSettings } from './fill';
import type { SlotsLayout } from './SlotsStrip';

/*
 * Settings → Plugins → Build orchestrator → Fill every slot (Nov 13 2026). The three Claude settings the dispatcher's
 * fill round follows, saved through POST pipeline/fill/settings (the MCP command pipeline-fill-settings, `pipeline.mjs
 * fill set`, the voice action build-orchestrator.pipeline-fill-settings): Fill every slot (anyone may switch it off,
 * only Brett on), Max parallel steps per build (only Brett raises it), Auto-queue pending builds (owner-only: greyed out
 * unless this console is Brett's own signed-in session), plus the Slots strip layout (a strip asset choice, this
 * browser). The settings host draws the level toolbar above every panel of the tab.
 * Deep link: console_show `settings/plugins/build-orchestrator#fill` (the panel's anchor is #build-orchestrator-fill).
 */

type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
export const FILL_ANCHOR = 'build-orchestrator-fill';
export const SLOTS_LAYOUT_KEY = 'orch-slots-layout';
export const readSlotsLayout = (): SlotsLayout => { const v = consoleApi.readLocal<string>(SLOTS_LAYOUT_KEY, 'chips'); return v === 'grid' || v === 'list' ? v : 'chips'; };
const PARALLEL = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} step${i ? 's' : ''} beside the build's own session` }));
/** Is this console Brett's own signed-in session (GET /api/me: an admin signed in by session)? Read once per panel. */
function useOwnerSession(): boolean {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    void fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
      .then((m: { admin?: boolean; user?: { via?: string } | null } | null) => setOwner(!!m?.admin && m.user?.via === 'session'))
      .catch(() => setOwner(false));
  }, []);
  return owner;
}
const LAYOUTS = [{ value: 'chips', label: 'Chips in a row' }, { value: 'grid', label: 'Grid of slots' }, { value: 'list', label: 'List, one slot per line' }];

export function FillSettingsPanel({ api }: { api: Api }) {
  const rt = useRuntime();
  const owner = useOwnerSession();
  const fill = fillApi(api);
  const [s, setS] = useState<FillSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useState<SlotsLayout>(readSlotsLayout);
  useEffect(() => { void fill.status().then((f) => setS(f.settings)).catch((e: Error) => setError(e.message)); }, []);
  const save = async (patch: Partial<FillSettings>) => {
    setBusy(true);
    try { const r = await fill.settings(patch); setS(r.settings); rt.toast(r.changed.length ? r.changed.map((c) => `${c.key.replace('builds.', '')}: ${String(c.to)}`).join(', ') : 'Nothing changed', 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  if (error) return <Note tone="warning">Fill every slot: {error}</Note>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  return (
    <div className="fx-stack" id={FILL_ANCHOR}>
      <Switch label="Fill every slot" hint="When agent slots are free, run the independent steps of running builds in parallel (each in its own step worktree, merged back when done). Anyone may switch it off; only you switch it on."
        checked={s.fillSlots} disabled={busy || (!s.fillSlots && !owner)} onChange={(on) => void save({ fillSlots: on })} />
      <SelectField label="Max parallel steps per build" hint="How many step sessions one build may run beside its own session. Anyone may lower it; only you raise it."
        value={String(s.maxParallelPerBuild)} disabled={busy} options={owner ? PARALLEL : PARALLEL.slice(0, s.maxParallelPerBuild)} onChange={(v) => void save({ maxParallelPerBuild: Number(v) })} />
      <Switch label="Auto-queue pending builds" hint="When slots are still free after every ready step and Queue build has one, split Pending builds that clash with nothing running move to the Queue in priority order, with a note and one alert. Owner-only: only your own click here changes it."
        checked={s.autoQueuePending} disabled={busy || !owner} onChange={(on) => void save({ autoQueuePending: on })} />
      {!owner && <Note tone="info">Auto-queue pending builds and switching Fill every slot on are Brett's own click in the console: they are greyed out for this session.</Note>}
      <SelectField label="Slots strip layout" hint="How the Pipeline tab shows the agent slots (this browser)." value={layout} options={LAYOUTS}
        onChange={(v) => { const l = (v === 'grid' || v === 'list' ? v : 'chips') as SlotsLayout; setLayout(l); consoleApi.writeLocal(SLOTS_LAYOUT_KEY, l); }} />
    </div>
  );
}
