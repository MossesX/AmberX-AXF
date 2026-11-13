/*
 * Fill every slot (Nov 13 2026, BUILD-PARALLEL): the one client for its four calls. The Slots strip, the step dependency
 * editor, the settings sub-tab and the console / voice actions (build-orchestrator.pipeline-fill-status | -run |
 * pipeline-step-deps | pipeline-fill-settings) all call these, which are the same REST routes the MCP plugin commands
 * (pipeline-fill-status, pipeline-fill-run, pipeline-step-deps, pipeline-fill-settings) and `pipeline.mjs fill …` use.
 */

export type FillSettings = { fillSlots: boolean; autoQueuePending: boolean; maxParallelPerBuild: number };
export type SlotRow = { n: number; id: string; name: string; build: string; step: string; state: string; session: string; since: string; main: boolean };
export type RunningIn = { runId: string; slot: string; session: string; account: string; branch: string; model: string; worktree: string; since: string; main: boolean; n: number };
export type StepState = { id: string; text: string; model: string; estimate: string; done: boolean; skip: boolean; dependsOn: string[]; explicit: string[] | null; parallel: boolean; files: string[]; state: 'done' | 'skipped' | 'running' | 'ready' | 'waiting' | 'blocked'; waitingOn: string[]; why: string; runningIn: RunningIn | null };
export type FillLaunch = { kind: 'step' | 'build' | 'pending'; id: string; step?: string; model: string; account: string; why: string };
export type FillStatus = {
  ok: boolean; at: string; settings: FillSettings;
  slots: { cap: number; used: number; free: number; rows: SlotRow[] };
  ready: { id: string; step: string; text: string; model: string; parallel: boolean }[];
  builds: { id: string; title: string; parallel: number; cap: number }[];
  plan: { launches: FillLaunch[]; waits: { id: string; step?: string; why: string }[]; free: number; blocked: string };
  build?: { id: string; title: string; status: string; branch: string; steps: StepState[] };
};
export type DepsResult = { ok: boolean; id: string; step: string; dependsOn: string[]; explicit: string[] | null; parallel: boolean };
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };

export function fillApi(api: Api) {
  const enc = encodeURIComponent;
  return {
    status: (build = '') => api.call<FillStatus>(`pipeline/fill${build ? `?build=${enc(build)}` : ''}`),
    run: () => api.post<{ ok: boolean; ran: boolean; note?: string; fill?: { launched: { id: string; step: string }[] } }>('pipeline/fill/run', {}),
    deps: (build: string, step: string, dependsOn: string[] | null) => api.post<DepsResult>(`builds/${enc(build)}/steps/${enc(step)}/deps`, { dependsOn }),
    settings: (patch: Partial<FillSettings>) => api.post<{ ok: boolean; changed: { key: string; from: unknown; to: unknown }[]; settings: FillSettings }>('pipeline/fill/settings', patch),
  };
}

/** `<build>/<step>/<s1,s2 | none | sequential>` (the action argument) → { build, step, dependsOn }. */
export function parseDepsArg(arg: string): { build: string; step: string; dependsOn: string[] | null } | null {
  const [build = '', step = '', list = ''] = decodeURIComponent(arg || '').split('/').map((x) => x.trim());
  if (!build || !step) return null;
  if (list === 'sequential' || list === '') return { build, step, dependsOn: null };
  if (list === 'none') return { build, step, dependsOn: [] };
  return { build, step, dependsOn: list.split(/[\s,]+/).filter(Boolean) };
}

/** `fillSlots=false,maxParallelPerBuild=2` → the settings patch (unknown keys dropped). */
export function parseSettingsArg(arg: string): Partial<FillSettings> {
  const out: Partial<FillSettings> = {};
  for (const part of decodeURIComponent(arg || '').split(/[,;\s]+/)) {
    const [k = '', v = ''] = part.split('=');
    const on = /^(on|true|yes)$/i.test(v); const off = /^(off|false|no)$/i.test(v);
    if (k === 'fillSlots' && (on || off)) out.fillSlots = on;
    else if (k === 'autoQueuePending' && (on || off)) out.autoQueuePending = on;
    else if (k === 'maxParallelPerBuild' && /^\d+$/.test(v)) out.maxParallelPerBuild = Number(v);
  }
  return out;
}

/** One spoken / toast line: the slots and what the next round would start. */
export function fillSummary(f: FillStatus): string {
  const busy = f.slots.rows.filter((r) => r.state !== 'free' && r.state !== 'finished');
  const steps = busy.filter((r) => r.step).map((r) => `${r.build} ${r.step}`);
  const next = f.plan.launches.map((l) => `${l.id}${l.step ? ` ${l.step}` : ''}`);
  return `${f.slots.used} of ${f.slots.cap} slots in use, ${f.slots.free} free${steps.length ? `; parallel steps: ${steps.join(', ')}` : ''}${next.length ? `; next: ${next.join(', ')}` : f.plan.blocked ? `; ${f.plan.blocked}` : ''}. Fill every slot is ${f.settings.fillSlots ? 'on' : 'off'}.`;
}
