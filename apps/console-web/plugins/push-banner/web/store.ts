/** Push banner: the branches every watched repo has ahead of its default branch, read from this plugin's server part. */
import { useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';

export const ID = 'ai.amberx.axf.console.push-banner';
export const FOLDER = 'push-banner';
export const VERSION = '0.3.0';
export const BANNER_KEY = 'push-banner.banner';
const POLL_MS = 120_000;

export const api = pluginApi(FOLDER, 'Push banner');

export interface PullInfo { number: number | null; title: string; url: string; draft: boolean; ci: 'none' | 'running' | 'failure' | 'success' | 'unknown' }
export interface Branch { name: string; ahead: number | null; behind: number | null; sha?: string; subject?: string; date?: string; url?: string; hidden?: boolean; pr: PullInfo | null; error: string; /** no PR, not behind its base: merges cleanly */ clean?: boolean; ci?: PullInfo['ci']; canMerge?: boolean }
export interface Pull { number: number; title: string; url: string; draft: boolean; head: string; base: string; fork: boolean; author: string; updated: string; ci: PullInfo['ci']; mergeable: boolean | null; mergeState?: string; ready: boolean; hidden?: boolean; sha?: string }
export interface RepoBranches { repo: string; base: string; url: string; branches: Branch[]; pulls?: Pull[]; error: string }
export interface PullRow extends Pull { repo: string; key: string; ahead: number | null; behind: number | null }
/** A successful Merge or Pull main in, kept (every device, 7 days) until its trash can is tapped. */
export interface Done { key: string; kind: 'merged' | 'pulled'; at: number; repo: string; base?: string; number?: number; branch?: string; title?: string; url?: string; text?: string }
/** A Pull main in GitHub refused (from its own button or Pull all), kept (every device) until a pull goes through or it's removed. */
export interface Failed { key: string; at: number; repo: string; number?: number | null; branch?: string; error: string }
export interface Answer { checkedAt: number; repos: RepoBranches[]; error: string; done?: Done[]; failed?: Failed[] }
/** One entry's details (GET detail): its commits, the checks on its head, GitHub's merge state. */
export interface Detail { commits: { sha: string; subject: string; author: string; date: string; url: string }[]; checks: { name: string; status: string; conclusion: string; url: string }[]; mergeState: string; files: number | null; body?: string; sha?: string; error: string }
export interface Row extends Branch { repo: string; base: string; key: string }

export interface ClaudeJob { key: string; state: 'asking' | 'waiting' | 'launched' | 'failed'; message: string; title?: string; repo?: string; branch?: string; changeId?: string; startedAt?: number; /** launched: its change-log entry's status */ fixed?: 'running' | 'done' | 'failed' }
export interface ClaudeState { on: boolean; shell: boolean; hubToken: boolean; mosses?: boolean; mossesWhy?: string; changes: boolean; jobs: ClaudeJob[] }
interface State { claude: ClaudeState | null; answer: Answer | null; loading: boolean; error: string; busy: string; note: { key: string; text: string; tone: 'ok' | 'danger' } | null; details: Record<string, { loading: boolean; data?: Detail; error?: string }> }
let state: State = { claude: null, answer: null, loading: false, error: '', busy: '', note: null, details: {} };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useStore = (): State => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

export const keyOf = (repo: string, branch: string) => `${repo}:${branch}`;

/** Every branch waiting for main, newest first; hidden ones only when asked. */
export function rows(a: Answer | null, withHidden = false): Row[] {
  const out: Row[] = [];
  for (const r of a?.repos ?? []) for (const b of r.branches) if (withHidden || !b.hidden) out.push({ ...b, repo: r.repo, base: r.base, key: keyOf(r.repo, b.name) });
  return out.sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''));
}

/** Every open pull request as its own entry (ready ones first), with its branch's ahead/behind when it has a row. */
export function pullRows(a: Answer | null, withHidden = false): PullRow[] {
  const out: PullRow[] = [];
  for (const r of a?.repos ?? []) for (const p of r.pulls ?? []) {
    if (!withHidden && p.hidden) continue;
    const b = !p.fork ? r.branches.find((x) => x.name === p.head && p.base === r.base) : undefined;
    out.push({ ...p, repo: r.repo, key: `${r.repo}:#${p.number}`, ahead: b?.ahead ?? null, behind: b?.behind ?? null });
  }
  return out.sort((x, y) => Number(y.ready) - Number(x.ready) || (y.updated ?? '').localeCompare(x.updated ?? ''));
}

/** Finished entries (merged / main pulled in), newest first; their keys leave the other groups. */
export const doneRows = (a: Answer | null): Done[] => [...(a?.done ?? [])].sort((x, y) => y.at - x.at);
export const doneKeys = (a: Answer | null) => new Set((a?.done ?? []).map((d) => d.key));

/** The trash can on a finished entry: forget it, and when it's still open on GitHub, hide it until its next commit. */
export const removeDone = (d: Done, sha?: string) => act(d.key, async () => {
  await api.post('done/remove', sha ? { key: d.key, sha } : { key: d.key });
  return 'Removed from the banner.';
});

/** Load one entry's details (commits, checks) the first time it's opened; `force` reloads. */
export async function loadDetail(e: { key: string; repo: string; number?: number; branch?: string }, force = false): Promise<void> {
  const have = state.details[e.key];
  if (have?.loading || (have?.data && !force)) return;
  set({ details: { ...state.details, [e.key]: { loading: true, data: have?.data } } });
  const q = new URLSearchParams({ repo: e.repo, ...(e.number ? { number: String(e.number) } : { branch: e.branch ?? '' }) });
  try { set({ details: { ...state.details, [e.key]: { loading: false, data: await api.call<Detail>(`detail?${q}`) } } }); }
  catch (x) { set({ details: { ...state.details, [e.key]: { loading: false, error: x instanceof Error ? x.message : String(x) } } }); }
}

/** Claude on failure: the setting and the hand-overs (read with every load; quiet when the plugin's route is older). */
export async function loadClaude(): Promise<void> {
  try { set({ claude: await api.call<ClaudeState>('claude') }); } catch { /* keep what we had */ }
}

export async function saveClaude(patch: Partial<Record<'claudeOnFail' | 'claudeShell', boolean>>): Promise<void> {
  await api.put('config', patch);
  await loadClaude();
}

/** "Fix with Claude": hand this entry to headless Claude Code on the VPS (approved on axHub first). */
export const fixWithClaude = (r: { key: string; repo: string; number?: number; branch?: string }) => act(r.key, async () => {
  const body = r.number ? { repo: r.repo, number: r.number, confirm: `${r.repo}#${r.number}` } : { repo: r.repo, branch: r.branch, confirm: `${r.repo}:${r.branch}` };
  const j = await api.post<{ job: ClaudeJob }>('claude', body);
  return j.job.state === 'failed' ? `Claude Code couldn't be started: ${j.job.message}` : 'Handed to Claude Code on the VPS: approve it on axHub, then follow it in the building banner.';
});

/** Failed pulls, newest first; their keys leave the Needs main pulled in group. */
export const failedRows = (a: Answer | null): Failed[] => [...(a?.failed ?? [])].sort((x, y) => y.at - x.at);
export const failedKeys = (a: Answer | null) => new Set((a?.failed ?? []).map((f) => f.key));
export const jobOf = (key: string) => state.claude?.jobs.find((j) => j.key === key);

const claudeBody = (f: Failed) => f.number ? { repo: f.repo, number: f.number, confirm: `${f.repo}#${f.number}`, repair: true } : { repo: f.repo, branch: f.branch, confirm: `${f.repo}:${f.branch}`, repair: true };
const pullBody = (f: Failed) => f.number ? { repo: f.repo, number: f.number, confirm: `${f.repo}#${f.number}` } : { repo: f.repo, branch: f.branch, confirm: `${f.repo}:${f.branch}` };

/** The Repair badge: a headless Claude Code session on the VPS (approved on axHub) merges main in and fixes the branch;
 *  once its change-log entry says done, the pull is tried again by itself (retryRepaired). */
export const repair = (f: Failed) => act(f.key, async () => {
  const j = await api.post<{ job: ClaudeJob }>('claude', claudeBody(f));
  return j.job.state === 'failed' ? `Repair couldn't start: ${j.job.message}` : 'Repairing on the VPS: approve it on axHub. The pull runs again when it\'s done.';
});

export const REPAIR_ALL = 'repair-all';
/** Repair all: every failed pull without a repair under way, one hand-over at a time. */
export async function repairAll(list: Failed[]): Promise<void> {
  if (state.busy || !list.length) return;
  set({ busy: REPAIR_ALL, note: null });
  const bad: string[] = [];
  let n = 0;
  for (const f of list) {
    try { const j = await api.post<{ job: ClaudeJob }>('claude', claudeBody(f)); if (j.job.state === 'failed') bad.push(f.number ? `#${f.number}` : f.branch ?? f.key); else n++; }
    catch (e) { bad.push(`${f.number ? `#${f.number}` : f.branch} (${e instanceof Error ? e.message : String(e)})`); }
  }
  await loadClaude();
  set({ busy: '', note: { key: REPAIR_ALL, text: `Repairing ${n} of ${list.length} on the VPS: approve each on axHub.${bad.length ? ` Not started: ${bad.join('; ')}` : ''}`, tone: bad.length ? 'danger' : 'ok' } });
}

export const removeFailed = (f: Failed) => act(f.key, async () => { await api.post('failed/remove', { key: f.key }); return 'Removed from the banner.'; });

const retried = new Set<string>();
/** A failed pull whose repair session finished (after the failure): try the pull again, once per repair. */
async function retryRepaired(): Promise<void> {
  if (state.busy) return;
  for (const f of state.answer?.failed ?? []) {
    const j = jobOf(f.key);
    const mark = `${f.key}@${j?.startedAt ?? 0}`;
    if (!j || j.state !== 'launched' || j.fixed !== 'done' || (j.startedAt ?? 0) * 1000 < f.at || retried.has(mark)) continue;
    retried.add(mark);
    await act(f.key, async () => { await api.post('update', pullBody(f)); return 'Repaired, and main is pulled in now.'; });
  }
}

export async function load(refresh = false): Promise<void> {
  if (state.loading) return;
  set({ loading: true });
  void loadClaude().then(retryRepaired);
  try { set({ answer: await api.call<Answer>(`branches${refresh ? '?refresh=true' : ''}`), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  finally { set({ loading: false }); }
}

async function act(key: string, fn: () => Promise<string>): Promise<void> {
  set({ busy: key, note: null });
  try { set({ note: { key, text: await fn(), tone: 'ok' } }); const { [key]: _gone, ...rest } = state.details; set({ details: rest }); await load(true); }
  catch (e) { set({ note: { key, text: e instanceof Error ? e.message : String(e), tone: 'danger' } }); }
  finally { set({ busy: '' }); }
}

export const openPr = (r: Row) => act(r.key, async () => {
  const p = await api.post<{ number: number; url: string; existing: boolean }>('pr', { repo: r.repo, branch: r.name });
  return p.existing ? `PR #${p.number} was already open.` : `Opened PR #${p.number}.`;
});

export const mergePr = (r: { key: string; repo: string; number: number; base: string }) => act(r.key, async () => {
  const n = r.number;
  const m = await api.post<{ merged: boolean }>('merge', { repo: r.repo, number: n, confirm: `${r.repo}#${n}` });
  return m.merged ? `Merged PR #${n} into ${r.base}.` : `GitHub didn't merge PR #${n}.`;
});

/** Merge a branch without a PR that merges cleanly (the server re-checks it, opens its PR and merges that, head pinned). */
export const mergeBranch = (r: Row) => act(r.key, async () => {
  const m = await api.post<{ merged: boolean; number: number }>('merge-branch', { repo: r.repo, branch: r.name, confirm: `${r.repo}:${r.name}` });
  return m.merged ? `Merged ${r.name} into ${r.base} (#${m.number}).` : `Opened #${m.number}, but GitHub didn't merge it.`;
});

/** Pull the default branch into a PR's branch, or into a branch without a PR (never touches the default branch). */
export const pullMain = (r: { key: string; repo: string; number?: number; branch?: string; base: string }) => act(r.key, async () => {
  const body = r.number ? { repo: r.repo, number: r.number, confirm: `${r.repo}#${r.number}` } : { repo: r.repo, branch: r.branch, confirm: `${r.repo}:${r.branch}` };
  await api.post('update', body);
  return `Pulled ${r.base} in. CI runs again on the new commit.`;
});

export const PULL_ALL = 'pull-all';

/** Pull main into every entry of "Needs main pulled in", one at a time (each the same server action as its own button);
 *  a failure (a conflict GitHub only finds now, a refused branch) is noted and the rest go on. One reload at the end. */
export async function pullAll(list: { key: string; repo: string; number?: number; branch?: string; base: string }[]): Promise<void> {
  if (state.busy || !list.length) return;
  set({ busy: PULL_ALL, note: null });
  const failed: string[] = [];
  let done = 0;
  for (const r of list) {
    set({ note: { key: PULL_ALL, text: `Pulling main into ${done + failed.length + 1} of ${list.length}…`, tone: 'ok' } });
    const body = r.number ? { repo: r.repo, number: r.number, confirm: `${r.repo}#${r.number}` } : { repo: r.repo, branch: r.branch, confirm: `${r.repo}:${r.branch}` };
    try { await api.post('update', body); done++; }
    catch (e) { failed.push(`${r.number ? `#${r.number}` : r.branch} (${e instanceof Error ? e.message : String(e)})`); }
  }
  const text = `Pulled main into ${done} of ${list.length}.${failed.length ? ` Not pulled (moved to Pull failed, Repair them there): ${failed.join('; ')}` : ' CI runs again on each.'}`;
  set({ details: {} });
  try { await load(true); } finally { set({ busy: '', note: { key: PULL_ALL, text, tone: failed.length ? 'danger' : 'ok' } }); }
}

/** Behind its base and nothing in the way of pulling it in (no conflicts GitHub knows of). */
export const needsPull = (behind: number | null | undefined, mergeState?: string) => (behind ?? 0) > 0 && mergeState !== 'dirty';

export const setHidden = (r: { key: string }, hide: boolean) => act(r.key, async () => {
  const cfg = await api.call<{ hidden: string[] }>('config');
  const hidden = hide ? [...new Set([...cfg.hidden, r.key])] : cfg.hidden.filter((k) => k !== r.key);
  await api.put('config', { hidden });
  return hide ? 'Hidden on every device (Settings → Plugins → Push banner shows it again).' : 'Shown again.';
});

let started = false;
/** Load now, every 2 minutes while the page is visible, and when it comes back into view. */
export function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void load();
  setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
  // while a repair is under way, check its session every 20 s so the pull is tried again soon after it finishes
  setInterval(() => { if (document.visibilityState === 'visible' && state.answer?.failed?.some((f) => jobOf(f.key))) void loadClaude().then(retryRepaired); }, 20_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void load(); });
}

export function bannerOn(get: (k: string) => unknown): boolean { return get(BANNER_KEY) !== false; }

export function ago(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
