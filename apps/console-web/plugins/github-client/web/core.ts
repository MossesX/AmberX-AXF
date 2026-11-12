/**
 * GitHub client — the web part's pure half: record types (contract.json → records), the readiness rule (the same as
 * server/core.py ready_reasons, line for line), the deep-link focus grammar and a tiny focus store the page reads.
 */
import { useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'github-client';
export const ID = 'ai.amberx.axf.console.github-client';
export const VIEW = 'github-client';
export const api = pluginApi(FOLDER, 'The GitHub client plugin');

export type ChecksState = 'success' | 'failure' | 'pending' | 'none';
export interface Checks { state: ChecksState; total: number; failed: string[]; pending: string[] }
export interface Pr {
  repo: string; number: number; title: string; author: string; head: string; headSha: string; base: string; draft: boolean;
  state: 'open' | 'closed' | 'merged'; mergeable: 'clean' | 'conflict' | 'blocked' | 'unknown'; behind: number; ahead: number;
  checks: Checks; review: 'approved' | 'changes' | 'required' | 'none'; labels: string[]; updatedAt: string; createdAt: string;
  ageDays: number; stale: boolean; comments: number; changedFiles: number; additions: number; deletions: number;
  linkedBuild: { id: string; title: string; status: string } | null; queue: { state: string; position?: number } | null;
  ready: boolean; why: string[]; url: string;
}
export interface Policy { requireGreenChecks: boolean; allowNoChecks: boolean; requireReview: boolean; doNotMergeLabel: string; staleDays: number; mergeMethod: string }
export interface PrList { repo: string; counts: Record<string, number>; total: number; items: Pr[]; policy: Policy; queue: { on: boolean }; polledAt: string; version: number }
export interface Repo { repo: string; project: string; defaultBranch: string; source: string; selected: boolean }
export interface Job { id: string; kind: string; repo: string; state: string; items: { target: string; state: string; note?: string }[]; startedAt: string; finishedAt?: string; by: string; error?: string; meta?: Record<string, unknown> }
export interface FileRec { path: string; status: string; additions: number; deletions: number; previous?: string; patch: string; truncated?: boolean }
export interface Commit { repo: string; sha: string; message: string; author: string; at: string; parents: string[]; url?: string; files?: FileRec[]; stats?: { additions: number; deletions: number } }
export interface Branch { repo: string; name: string; sha: string; ahead: number; behind: number; lastCommit: { sha: string; message: string; author: string; at: string }; pr: number | null; protected: boolean; default: boolean }
export interface Check { repo: string; ref: string; name: string; kind: string; state: string; startedAt?: string; finishedAt?: string; url?: string; runId?: number; workflow?: string; description?: string }
export interface Group { id: string; repo: string; name: string; branch: string; base?: string; titles?: Record<string, string>; members: number[]; merged: number[]; pr: number | null; state: string; conflicts: { member: number; files: string[]; how?: string }[]; createdAt: string; by: string; autoLand: boolean; tries: number; fixBuild?: string; why?: string; url?: string }
export interface LogEntry { id: string; at: string; repo: string; kind: string; target: { pr?: number; branch?: string; sha?: string; group?: string }; actor: { kind: string; name: string }; outcome: 'ok' | 'failed'; why?: string; details?: string; savedSha?: string; restorable: boolean; restoredAt?: string }

export const FILTERS = ['all', 'ready', 'failing', 'conflicts', 'behind', 'stale', 'drafts', 'mine'] as const;
export type Filter = (typeof FILTERS)[number];
export const SORTS = ['updated', 'oldest', 'number', 'behind'] as const;
export type Sort = (typeof SORTS)[number];
export const TABS = ['prs', 'batches', 'branches', 'commits', 'checks', 'log'] as const;
export type Tab = (typeof TABS)[number];

/** Why a PR is not ready ([] = ready). Mirrors server/core.py ready_reasons. */
export function readyReasons(pr: Pick<Pr, 'state' | 'draft' | 'mergeable' | 'checks' | 'review' | 'labels'>, policy: Partial<Policy>): string[] {
  const why: string[] = [];
  if (pr.state !== 'open') why.push(`it is ${pr.state}`);
  if (pr.draft) why.push('it is a draft');
  if (pr.mergeable === 'conflict') why.push('it has conflicts with its base');
  else if (pr.mergeable !== 'clean') why.push(`GitHub says mergeable: ${pr.mergeable}`);
  const cs = pr.checks?.state;
  const green = policy.requireGreenChecks ?? true;
  if (cs === 'failure') why.push('checks are failing');
  else if (cs === 'pending' && green) why.push('checks are still running');
  else if (cs === 'none' && green && !policy.allowNoChecks) why.push('no checks have run');
  if (pr.review === 'changes') why.push('changes were requested');
  else if (policy.requireReview && pr.review !== 'approved') why.push('it needs an approving review');
  const label = policy.doNotMergeLabel || 'do-not-merge';
  if ((pr.labels ?? []).includes(label)) why.push(`it has the ${label} label`);
  return why;
}

export type Tone = 'success' | 'warning' | 'danger' | 'accent' | undefined;
/** The row's status chip: what to say and its tone. */
export function prStatus(pr: Pr): { label: string; tone: Tone } {
  if (pr.state !== 'open') return { label: pr.state, tone: pr.state === 'merged' ? 'accent' : undefined };
  if (pr.queue) return { label: pr.queue.state === 'landing' ? 'landing' : `queued ${(pr.queue.position ?? 0) + 1}`, tone: 'accent' };
  if (pr.ready) return { label: 'ready', tone: 'success' };
  if (pr.mergeable === 'conflict') return { label: 'conflicts', tone: 'danger' };
  if (pr.checks.state === 'failure') return { label: 'failing', tone: 'danger' };
  if (pr.draft) return { label: 'draft', tone: undefined };
  if (pr.checks.state === 'pending') return { label: 'checks running', tone: 'warning' };
  return { label: 'not ready', tone: 'warning' };
}
export const checksTone = (s: string): Tone => (s === 'success' ? 'success' : s === 'failure' ? 'danger' : s === 'pending' || s === 'running' || s === 'queued' ? 'warning' : undefined);

export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const short = (sha: string) => (sha || '').slice(0, 8);
export const prPath = (repo: string, n: number, tail = '') => `pr/${repo}/${n}${tail ? `/${tail}` : ''}`;

/* ---------------- deep links (contract.json → screens.github-client.focus) ---------------- */

export interface Focus { tab: Tab; repo?: string; pr?: number; filter?: Filter; branch?: string; sha?: string; ref?: string; q?: string; group?: string; at: number }

/** "pr 123", "pr owner/name 123", "prs ready", "branch x", "branches", "commits main", "commit <sha>", "checks <ref>", "log <q>", "batch <id>", "batches". */
export function parseFocus(raw: string): Focus | null {
  const s = decodeURIComponent(raw || '').trim();
  if (!s) return null;
  const [w0 = '', ...rest] = s.split(/\s+/);
  const word = w0.toLowerCase();
  const arg = rest.join(' ');
  const at = Date.now();
  const repoLike = (x?: string) => !!x && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(x);
  if (word === 'pr' || /^#?\d+$/.test(word)) {
    const parts = word === 'pr' ? rest : [w0];
    const repo = repoLike(parts[0]) ? parts[0] : undefined;
    const n = Number(String(repo ? parts[1] : parts[0] ?? '').replace('#', ''));
    return Number.isInteger(n) && n > 0 ? { tab: 'prs', pr: n, repo, at } : { tab: 'prs', at };
  }
  if (word === 'prs' || word === 'pulls' || word === 'pull-requests') {
    const f = (rest[0] ?? 'all').toLowerCase() as Filter;
    return { tab: 'prs', filter: (FILTERS as readonly string[]).includes(f) ? f : 'all', at };
  }
  if (word === 'branch') return { tab: 'branches', branch: arg || undefined, at };
  if (word === 'branches') return { tab: 'branches', at };
  if (word === 'commits') return { tab: 'commits', branch: arg || undefined, at };
  if (word === 'commit') return { tab: 'commits', sha: arg || undefined, at };
  if (word === 'checks') return { tab: 'checks', ref: arg || undefined, at };
  if (word === 'log' || word === 'git-log') return { tab: 'log', q: arg, at };
  if (word === 'batch' || word === 'group') return { tab: 'batches', group: arg || undefined, at };
  if (word === 'batches' || word === 'groups') return { tab: 'batches', at };
  if ((TABS as readonly string[]).includes(word)) return { tab: word as Tab, at };
  return null;
}

let focus: Focus | null = null;
const subs = new Set<() => void>();
export function setFocus(f: Focus | null) { focus = f; subs.forEach((fn) => fn()); }
export const useFocus = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => focus, () => focus);

/* ---------------- selection shared by the list, the bulk bar and the batch dialog ---------------- */

let selected: number[] = [];
const selSubs = new Set<() => void>();
export function setSelected(next: number[]) { selected = [...new Set(next)].sort((a, b) => a - b); selSubs.forEach((fn) => fn()); }
export const useSelected = () => useSyncExternalStore((f) => { selSubs.add(f); return () => { selSubs.delete(f); }; }, () => selected, () => selected);
