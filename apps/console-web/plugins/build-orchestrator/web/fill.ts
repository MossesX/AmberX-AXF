/*
 * Fill every slot (Nov 13 2026, BUILD-PARALLEL): the one client for its four calls. The Slots strip, the step dependency
 * editor, the settings sub-tab and the console / voice actions (build-orchestrator.pipeline-fill-status | -run |
 * pipeline-step-deps | pipeline-fill-settings) all call these, which are the same REST routes the MCP plugin commands
 * (pipeline-fill-status, pipeline-fill-run, pipeline-step-deps, pipeline-fill-settings) and `pipeline.mjs fill …` use.
 *
 * Paged (Brett, Nov 25 2026: no whole-set reads): the lists that grow with the builds (ready, builds) are asked for one
 * page at a time (?project=&limit=&offset=; ?status= keeps the slots in that state). A caller that only needs the
 * slots, the plan, the settings or one build's steps asks for no rows of them at all (limit 0). An answer without
 * paging is cut to the page asked for (paging.tsx), so nothing here keeps every build.
 */
import { PAGE_MAX, pageOf, pageQuery, type PageQuery, type Paged } from './paging';

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
  /** The page these lists are (`total` = the ready steps) and how many rows each list has in all. */
  limit: number; offset: number; total: number; totals: { ready: number; builds: number };
};
type FillRes = Omit<FillStatus, 'limit' | 'offset' | 'total' | 'totals'> & Paged & { totals?: Partial<FillStatus['totals']>; sessions?: unknown };
/** No rows of the growing lists: the slots, the plan, the settings and (with a build) that build's steps. */
export const FILL_HEAD: PageQuery = { limit: 0 };

/** GET pipeline/fill as the screens hold it: each growing list one page, with its full count beside it. */
function fillPage(r: FillRes, q: PageQuery): FillStatus {
  const { sessions: _sessions, totals, ...rest } = r;
  // the slot filter is the server's (?status=); the lists themselves have no status to match
  const window = { limit: q.limit, offset: q.offset };
  const ready = pageOf(r, r.ready, window); const builds = pageOf(r, r.builds, window);
  const want = typeof r.total === 'number' ? [] : (typeof q.status === 'string' ? q.status.split(',') : [...(q.status ?? [])]).map((x) => x.trim()).filter(Boolean);
  if (want.length) rest.slots = { ...rest.slots, rows: rest.slots.rows.filter((x) => want.includes(x.state)) };
  return { ...rest, ready: ready.rows, builds: builds.rows, limit: ready.limit, offset: ready.offset, total: totals?.ready ?? ready.total, totals: { ready: totals?.ready ?? ready.total, builds: totals?.builds ?? builds.total } };
}

/** How many builds running parallel steps a strip reads on for (their badges), past its first page. */
const BADGE_ROWS = PAGE_MAX;

export type DepsResult = { ok: boolean; id: string; step: string; dependsOn: string[]; explicit: string[] | null; parallel: boolean };
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };

export function fillApi(api: Api) {
  const enc = encodeURIComponent;
  return {
    /** One page of fill status (FILL_HEAD = no list rows); `build` adds that build's steps. */
    status: async (build = '', q: PageQuery = {}) => fillPage(await api.call<FillRes>(pageQuery('pipeline/fill', q, { build })), q),
    /** Fill status with every running build's row (up to BADGE_ROWS), read a page at a time. */
    statusWithBuilds: async (q: PageQuery = {}) => {
      const first = fillPage(await api.call<FillRes>(pageQuery('pipeline/fill', q)), q);
      let builds = first.builds;
      while (builds.length < first.totals.builds && builds.length < BADGE_ROWS) {
        const next = { ...q, offset: (q.offset ?? 0) + builds.length };
        const page = fillPage(await api.call<FillRes>(pageQuery('pipeline/fill', next)), next).builds;
        if (!page.length) break;
        builds = [...builds, ...page];
      }
      return { ...first, builds };
    },
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
