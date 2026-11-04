/**
 * Crew — pure part (no React, no fetch): the crew@1 snapshot's types, live timers and cost, search / filter / sort,
 * and a small syntax highlighter for diff lines. Checked by core-check.mts.
 */

export type RunStatus = 'working' | 'waiting' | 'stuck' | 'idle';
export interface Face { face: string; hair: number; gear: string; hue: number }
export interface CrewAgent { id: string; name: string; role: string; avatar: Face | null; initials: string; known: boolean; salary?: number; status?: string; catchphrase?: string }
export interface Tool { id: string; tool: string; what: string; target: string; state: 'running' | 'done' | 'failed'; costUsd: number }
export interface Step { id: string; text: string; model: string; state: 'done' | 'now' | 'next'; doneAt: string }
export interface BuildInfo { id: string; title: string; status: string; branch: string; pr: string; prUrl: string; steps: Step[]; done: number; total: number; now: Step | null; stepStartedAt: string | null; waitingApproval: boolean }
export interface Run {
  id: string; session: string; name: string; cwd: string; agent: CrewAgent; model: string; modelKey: string;
  startedAt: string | null; lastEventAt: string | null; costUsd: number; costExact: boolean;
  tokens: Record<string, number>; tokensTotal: number; turns: number; toolRunning: boolean; ended: boolean;
  result: { subtype?: string; isError?: boolean } | null; tools: Tool[]; lastText: string; build: BuildInfo | null;
  sessionId: string; status: RunStatus; now: string; filesCount?: number;
}
export interface Snapshot {
  $axf: 'crew@1'; now: string; runs: Run[]; offTheClock: CrewAgent[];
  /** build id → the agent its detail names or who is running it */
  buildAgents?: Record<string, string>;
  totals: { working: number; runs: number; costRunningUsd: number; costTodayUsd: number; runsToday?: number };
  source?: { headless: boolean; ready: boolean; why: string; roster: boolean };
}
export interface FileChange { path: string; kind: 'created' | 'modified' | 'deleted' | 'renamed'; from?: string; added?: number; removed?: number; untracked?: boolean; changedAt: string | null }
export interface DiffLine { t: 'add' | 'del' | 'ctx'; o?: number; n?: number; text: string }
export interface Hunk { header: string; context: string; lines: DiffLine[]; added: number; removed: number }

export const STATUS_LABEL: Record<RunStatus, string> = { working: 'Working', waiting: 'Waiting on approval', stuck: 'Stuck', idle: 'Idle' };
export const STATUS_TONE: Record<RunStatus, string> = { working: 'success', waiting: 'warning', stuck: 'danger', idle: 'muted' };
export const KIND_TONE: Record<FileChange['kind'], string> = { created: 'success', modified: 'accent', deleted: 'danger', renamed: 'info' };

export function isSnapshot(v: unknown): v is Snapshot {
  return !!v && typeof v === 'object' && (v as Snapshot).$axf === 'crew@1' && Array.isArray((v as Snapshot).runs);
}

const ts = (v: string | null | undefined) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };

/** "4s", "12m 03s", "2h 05m": time since `from` (ISO) at `now` (ms); "—" without a start. */
export function elapsed(from: string | null | undefined, now: number): string {
  const t = ts(from);
  if (t === null) return '—';
  let s = Math.max(0, Math.floor((now - t) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}h ${pad(m)}m` : m ? `${m}m ${pad(s)}s` : `${s}s`;
}

export function usd(v: number | null | undefined): string {
  const n = Number(v) || 0;
  return n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}

export function tokensText(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v);
}

/** "s3 of 7: Crew routes …" — the build's current step in plain words. */
export function stepLine(b: BuildInfo | null): string {
  if (!b) return 'No build on record';
  if (!b.total) return b.title;
  if (!b.now) return `All ${b.total} steps done`;
  const i = b.steps.findIndex((s) => s.state === 'now');
  return `s${i + 1} of ${b.total}: ${b.now.text}`;
}

export type Sort = 'status' | 'started' | 'cost' | 'agent' | 'tokens';
export function filterRuns(runs: Run[], q: string, status: RunStatus | ''): Run[] {
  const s = q.trim().toLowerCase();
  return runs.filter((r) => (!status || r.status === status) && (!s || [r.agent.name, r.agent.id, r.name, r.build?.title, r.build?.id, r.now, r.model, stepLine(r.build)].some((x) => String(x ?? '').toLowerCase().includes(s))));
}
const ORDER: Record<RunStatus, number> = { working: 0, waiting: 1, stuck: 2, idle: 3 };
export function sortRuns(runs: Run[], sort: Sort, dir: 1 | -1 = 1): Run[] {
  const key = (r: Run): number | string => sort === 'cost' ? r.costUsd : sort === 'tokens' ? r.tokensTotal : sort === 'agent' ? r.agent.name.toLowerCase() : sort === 'started' ? ts(r.startedAt) ?? 0 : ORDER[r.status] * 1e13 + (ts(r.startedAt) ?? 0);
  return [...runs].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}

/** The agent directory entries (core/agent-directory.ts) the snapshot knows: every run's agent and the off-the-clock crew. */
export function directoryOf(s: Snapshot): { id: string; name: string; role?: string; avatar: Face | null; aliases: string[] }[] {
  const out = new Map<string, { id: string; name: string; role?: string; avatar: Face | null; aliases: string[] }>();
  for (const a of [...s.runs.map((r) => r.agent), ...s.offTheClock]) if (a.known && a.id && !out.has(a.id)) out.set(a.id, { id: a.id, name: a.name, role: a.role, avatar: a.avatar, aliases: [] });
  // the runs and builds an agent is on: a Terminal tab (axf-…), a build row or a step finds its agent by those
  for (const r of s.runs) { const e = r.agent.known ? out.get(r.agent.id) : undefined; if (e) e.aliases.push(r.session, r.name, ...(r.build ? [r.build.id] : [])); }
  for (const [bid, aid] of Object.entries(s.buildAgents ?? {})) out.get(aid)?.aliases.push(bid);
  return [...out.values()];
}

// ---------------------------------------------------------------- highlighting

export type Tok = { k: 'kw' | 'str' | 'com' | 'num' | 'txt'; v: string };
const KW = new Set(('const let var function return if else for while do switch case break continue new class extends import export from as default async await try catch finally throw typeof instanceof in of interface type enum public private protected readonly static void null undefined true false this super yield ' +
  'def lambda pass with elif None True False and or not is self raise except global nonlocal assert del print fun val when object package').split(' '));
/** Split one source line into keyword / string / comment / number / text tokens (any C-like or Python-like language). */
export function highlight(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\/\/.*$|#(?![{\w-]*[:;]).*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_.]*(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push({ k: 'txt', v: line.slice(at, m.index) });
    if (m[1]) out.push({ k: 'com', v: m[1] });
    else if (m[2]) out.push({ k: 'str', v: m[2] });
    else if (m[3]) out.push({ k: 'num', v: m[3] });
    else out.push({ k: KW.has(m[4]!) ? 'kw' : 'txt', v: m[4]! });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ k: 'txt', v: line.slice(at) });
  // merge neighbouring plain text
  return out.reduce<Tok[]>((acc, t) => { const last = acc[acc.length - 1]; if (last && last.k === 'txt' && t.k === 'txt') last.v += t.v; else acc.push({ ...t }); return acc; }, []);
}
