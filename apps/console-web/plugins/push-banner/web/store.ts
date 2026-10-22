/** Push banner: the branches every watched repo has ahead of its default branch, read from this plugin's server part. */
import { useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';

export const ID = 'ai.amberx.axf.console.push-banner';
export const FOLDER = 'push-banner';
export const VERSION = '0.1.0';
export const BANNER_KEY = 'push-banner.banner';
const POLL_MS = 120_000;

export const api = pluginApi(FOLDER, 'Push banner');

export interface PullInfo { number: number | null; title: string; url: string; draft: boolean; ci: 'none' | 'running' | 'failure' | 'success' | 'unknown' }
export interface Branch { name: string; ahead: number | null; behind: number | null; sha?: string; subject?: string; date?: string; url?: string; hidden?: boolean; pr: PullInfo | null; error: string }
export interface Pull { number: number; title: string; url: string; draft: boolean; head: string; base: string; fork: boolean; author: string; updated: string; ci: PullInfo['ci']; mergeable: boolean | null; mergeState?: string; ready: boolean; hidden?: boolean }
export interface RepoBranches { repo: string; base: string; url: string; branches: Branch[]; pulls?: Pull[]; error: string }
export interface PullRow extends Pull { repo: string; key: string; ahead: number | null; behind: number | null }
export interface Answer { checkedAt: number; repos: RepoBranches[]; error: string }
export interface Row extends Branch { repo: string; base: string; key: string }

interface State { answer: Answer | null; loading: boolean; error: string; busy: string; note: { key: string; text: string; tone: 'ok' | 'danger' } | null }
let state: State = { answer: null, loading: false, error: '', busy: '', note: null };
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

export async function load(refresh = false): Promise<void> {
  if (state.loading) return;
  set({ loading: true });
  try { set({ answer: await api.call<Answer>(`branches${refresh ? '?refresh=true' : ''}`), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  finally { set({ loading: false }); }
}

async function act(key: string, fn: () => Promise<string>): Promise<void> {
  set({ busy: key, note: null });
  try { set({ note: { key, text: await fn(), tone: 'ok' } }); await load(true); }
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

/** Pull the default branch into a PR's branch, or into a branch without a PR (never touches the default branch). */
export const pullMain = (r: { key: string; repo: string; number?: number; branch?: string; base: string }) => act(r.key, async () => {
  const body = r.number ? { repo: r.repo, number: r.number, confirm: `${r.repo}#${r.number}` } : { repo: r.repo, branch: r.branch, confirm: `${r.repo}:${r.branch}` };
  await api.post('update', body);
  return `Pulled ${r.base} in. CI runs again on the new commit.`;
});

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
