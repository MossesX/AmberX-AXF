/**
 * Merge confirmations (merge-confirm@1, framework/spec/MERGE-CONFIRM.md): right after a merge call a PR row or merge
 * queue entry shows "Pending GitHub confirmation" (a turning chip); it turns Merged (with the merge commit) only once
 * GitHub, read back, shows the PR MERGED with its merge commit on main, or "GitHub hasn't confirmed" with Recheck.
 * Data: GET merge-confirm (the shared store, no GitHub call), POST merge-confirm/recheck. Framework Chip and Button,
 * tokens only.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon } from '@console/axf/react';
import { api } from './store';

export type ConfirmState = 'merge-requested' | 'pending-github-confirmation' | 'merged' | 'merge-unconfirmed' | 'merge-failed';
export interface ConfirmRecord {
  id: string; repo: string; pr: number; url?: string; path: string; by?: string; state: ConfirmState; label: string; why?: string;
  requestedAt?: string; confirmedAt?: string; endedAt?: string; checks?: number; rechecks?: number;
  evidence?: { state?: string; mergedAt?: string; mergeCommitSha?: string; onMain?: boolean | null; missing?: string[] } | null;
}
export interface ConfirmAnswer { records: ConfirmRecord[]; counts: Record<string, number>; at?: string }

const PENDING: ConfirmState[] = ['merge-requested', 'pending-github-confirmation'];
export const isPendingState = (s?: string) => PENDING.includes(s as ConfirmState);
const FAST_MS = 10_000;
const SLOW_MS = 60_000;
let cstate: { data: ConfirmAnswer | null; error: string; busy: string } = { data: null, error: '', busy: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof cstate>) => { cstate = { ...cstate, ...p }; subs.forEach((f) => f()); };
export const useConfirms = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cstate);

let timer: ReturnType<typeof setTimeout> | null = null;
export async function loadConfirms(): Promise<void> {
  try { set({ data: await api.call<ConfirmAnswer>('merge-confirm'), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  if (timer) clearTimeout(timer);
  // read back often while anything waits for GitHub, slowly otherwise
  timer = setTimeout(() => void loadConfirms(), (cstate.data?.records ?? []).some((r) => isPendingState(r.state)) ? FAST_MS : SLOW_MS);
}
let started = false;
export function startConfirms(): void { if (started) return; started = true; void loadConfirms(); }

export const confirmOf = (d: ConfirmAnswer | null, repo: string, pr: number): ConfirmRecord | undefined =>
  d?.records.find((r) => r.id === `${repo.toLowerCase()}#${pr}`);

export async function recheck(id: string): Promise<void> {
  set({ busy: id });
  try { await api.post('merge-confirm/recheck', { id }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  finally { set({ busy: '' }); await loadConfirms(); }
}

const commitUrl = (r: ConfirmRecord) => (r.evidence?.mergeCommitSha ? `https://github.com/${r.repo}/commit/${r.evidence.mergeCommitSha}` : '');

/** The state chip: turning while GitHub hasn't answered, Merged with the merge commit, or not confirmed / failed. */
export function MergeConfirmChip({ rec }: { rec?: ConfirmRecord | null }) {
  if (!rec) return null;
  if (isPendingState(rec.state)) {
    return <span className="axp-mc" role="status" title={rec.why || 'Merge called; reading the PR back from GitHub'}><Chip tone="accent"><Icon name="refresh" size={11} className="fx-spin axp-mc__spin" /> Pending GitHub confirmation</Chip></span>;
  }
  if (rec.state === 'merged') {
    const url = commitUrl(rec);
    return (
      <span className="axp-mc" title={`GitHub: MERGED${rec.evidence?.mergedAt ? ` at ${rec.evidence.mergedAt}` : ''}, merge commit on main`}>
        <Chip tone="success"><Icon name="check-circle" size={11} /> Merged</Chip>
        {url && <a className="axp-push-banner__ci" href={url} target="_blank" rel="noreferrer">{rec.evidence?.mergeCommitSha?.slice(0, 7)}</a>}
      </span>
    );
  }
  if (rec.state === 'merge-unconfirmed') return <span className="axp-mc" title={rec.why || ''}><Chip tone="warning"><Icon name="alert" size={11} /> GitHub hasn't confirmed</Chip></span>;
  return <span className="axp-mc" title={rec.why || ''}><Chip tone="danger"><Icon name="x-circle" size={11} /> Merge failed</Chip></span>;
}

/** Recheck (one read-back now): offered when GitHub hasn't confirmed. */
export function RecheckButton({ rec }: { rec?: ConfirmRecord | null }) {
  const c = useConfirms();
  if (!rec || rec.state !== 'merge-unconfirmed') return null;
  return <Button size="sm" tone="neutral" icon="refresh" busy={c.busy === rec.id} disabled={!!c.busy} title={`Ask GitHub again whether #${rec.pr} is merged`} onClick={() => void recheck(rec.id)}>Recheck</Button>;
}

/** The why line under a row that waits for GitHub or wasn't confirmed. */
export function ConfirmWhy({ rec }: { rec?: ConfirmRecord | null }) {
  if (!rec || rec.state === 'merged' || !rec.why) return null;
  return <span className="axp-push-banner__sub axp-mq__why">{rec.why}</span>;
}

/** Every merge call of the last day, newest first (Settings → Plugins → Push banner and the deep link). */
export function MergeConfirmList({ focus = '' }: { focus?: string }) {
  const c = useConfirms();
  useEffect(() => { startConfirms(); }, []);
  const [all, setAll] = useState(false);
  const recs = (c.data?.records ?? []).filter((r) => all || r.state !== 'merged' || r.id === focus);
  return (
    <section className="axp-push-banner__group" aria-label="Merge confirmations">
      <h4 className="axp-push-banner__group-title">Merge confirmations <span>{recs.length}</span></h4>
      {c.error && <p className="fx-small axp-push-banner__note is-danger">{c.error}</p>}
      {recs.length
        ? <ul className="axp-push-banner__list">{recs.map((r) => (
          <li key={r.id} className={`axp-push-banner__item${r.id === focus ? ' is-ready' : ''}`} id={`merge-confirm-${r.id.replace(/[^a-z0-9]+/g, '-')}`}>
            <span className="axp-push-banner__entry">
              <span className="axp-push-banner__line">{r.url ? <a className="axp-push-banner__name" href={r.url} target="_blank" rel="noreferrer">{r.id}</a> : <span className="axp-push-banner__name">{r.id}</span>}</span>
              <span className="axp-push-banner__line axp-push-banner__meta"><MergeConfirmChip rec={r} /><span>{r.path}{r.by ? ` · ${r.by}` : ''}</span></span>
              <ConfirmWhy rec={r} />
            </span>
            <div className="axp-push-banner__acts" role="toolbar" aria-label={`Merge confirmation ${r.id}`}><RecheckButton rec={r} /></div>
          </li>))}</ul>
        : <p className="fx-small fx-muted">{c.data ? 'Every merge is confirmed by GitHub.' : 'Reading merge confirmations…'}</p>}
      <div className="axp-push-banner__foot" role="toolbar" aria-label="Merge confirmations">
        <Button size="sm" tone="quiet" icon="refresh" onClick={() => void loadConfirms()}>Check now</Button>
        <Button size="sm" tone="quiet" aria-pressed={all} onClick={() => setAll(!all)}>{all ? 'Hide confirmed' : 'Show confirmed'}</Button>
      </div>
    </section>
  );
}
