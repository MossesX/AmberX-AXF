import { Button, Chip, Icon } from '@console/axf/react';

/*
 * Behind main (Brett, Nov 12 2026: "I need all the build tables and the orchestrator to list how many commits they are
 * behind main"). Every build row / card carries behindMain and aheadMain (framework/cli/branch-drift.mjs: git rev-list
 * --count branch..origin/main, cached per main + branch sha, refreshed by the dispatcher tick after each main push).
 * null = the build has no branch here: a dash. FAR_BEHIND (from the server) marks a branch that is far behind.
 * The same counts: GET pipeline/drift, MCP pipeline-drift, `pipeline.mjs drift`, voice "how far behind main are the builds".
 */
export type Drift = { behindMain?: number | null; aheadMain?: number | null; compareUrl?: string; branch?: string };
let farBehind = 50;
/** The server's threshold (status.main.farBehind, framework/cli/branch-drift.mjs FAR_BEHIND): one number everywhere. */
export const setFarBehind = (n: unknown) => { if (typeof n === 'number' && n > 0) farBehind = n; };
export const farBehindNow = () => farBehind;

/** Filter: any, behind (≥ 1), far (≥ the threshold), current (0 behind), none (no branch). */
export const DRIFT_FILTERS = [{ value: '', label: 'Any vs main' }, { value: 'behind', label: 'Behind main' }, { value: 'far', label: 'Far behind main' }, { value: 'current', label: 'Up to date with main' }, { value: 'none', label: 'No branch' }] as const;
export type DriftFilter = (typeof DRIFT_FILTERS)[number]['value'];
export function matchesDrift(d: Drift, f: string): boolean {
  const n = d.behindMain;
  if (!f) return true;
  if (f === 'none') return typeof n !== 'number';
  if (typeof n !== 'number') return false;
  return f === 'behind' ? n > 0 : f === 'far' ? n >= farBehind : f === 'current' ? n === 0 : true;
}

/** Sort value: a branch-less build sorts below every counted one. */
export const behindSort = (d: Drift) => (typeof d.behindMain === 'number' ? d.behindMain : -1);
export const isFarBehind = (d: Drift, far = farBehind) => typeof d.behindMain === 'number' && d.behindMain >= far;

/** The count as a table cell / card chip: "12 behind", a warning chip when far behind, a dash with no branch. */
export function BehindMain({ d, far = farBehind, label = false }: { d: Drift; far?: number; label?: boolean }) {
  if (typeof d.behindMain !== 'number') return <span className="fx-muted" title="No branch for this build yet">—</span>;
  const title = `${d.behindMain} commit${d.behindMain === 1 ? '' : 's'} behind main · ${d.aheadMain ?? 0} ahead${d.branch ? ` (${d.branch})` : ''}`;
  if (d.behindMain === 0) return <span className="fx-small fx-muted" title={title}>{label ? 'up to date with main' : '0'}</span>;
  return <span title={title}><Chip tone={isFarBehind(d, far) ? 'warning' : undefined}>{d.behindMain}{label ? ' behind main' : ''}</Chip></span>;
}

/** The expanded row's part: behind / ahead, the compare view, and Pull in main / Rebuild. */
export function DriftDetail({ d, far = farBehind, busy, canRebuild, onPull, onRebuild }: { d: Drift; far?: number; busy: boolean; canRebuild: boolean; onPull: () => void; onRebuild: () => void }) {
  if (typeof d.behindMain !== 'number') return <p className="fx-small fx-muted"><Icon name="branch" size={13} /> No branch yet: nothing to compare with main.</p>;
  return (
    <div className="oc-drift" role="toolbar" aria-label="Behind main">
      <span className="fx-small"><Icon name="branch" size={13} /> <b>{d.behindMain}</b> behind main · <b>{d.aheadMain ?? 0}</b> ahead{isFarBehind(d, far) ? ' · far behind' : ''}</span>
      {d.compareUrl && <a className="fx-link fx-small" href={d.compareUrl} target="_blank" rel="noopener noreferrer">Compare with main</a>}
      <DriftButtons d={d} busy={busy} canRebuild={canRebuild} onPull={onPull} onRebuild={onRebuild} />
    </div>
  );
}

/** Pull in main / Rebuild only (the Builds page's expanded row shows its own counts and fills these in through slot build.detail.actions). */
export function DriftButtons({ d, busy, canRebuild, onPull, onRebuild }: { d: Drift; busy: boolean; canRebuild: boolean; onPull: () => void; onRebuild: () => void }) {
  if (typeof d.behindMain !== 'number' || d.behindMain <= 0) return null;
  return <>
    <Button size="sm" tone="neutral" icon="download" disabled={busy} title="Merge main into this build's branch and push it (the dispatcher does it within a minute; refused while a session runs it or its worktree has uncommitted work; a conflict is aborted and noted)" onClick={onPull}>Pull in main</Button>
    {canRebuild && <Button size="sm" tone="neutral" icon="refresh" disabled={busy} title="Queue it: a session picks the build up again on today's main" onClick={onRebuild}>Rebuild</Button>}
  </>;
}
