/**
 * Split runs in the orchestrator (split-plan@1, framework/spec/BUILD-SPLIT.md; build one-build-time-always-split-to-fill).
 *
 *   SplitStatus   the row's status while it splits (Pending: the animated split badge) and, once it has parts, the
 *                 status rolled up from them (Building 2/4, Combining, CI, Merging, Merged, Live, Finished, Failed)
 *   PartBadge     one part's live status badge (waiting, building, testing, rebuilding, failed, done); it animates only
 *                 while the part works (waiting … rebuilding) and stays still at failed / done
 *   SplitParts    the expanded row's parts grid: part, slot, branch, account, steps and the live badge
 *   GateReason    a start the gate rule require-split-id refused: the reason on the Failed row, the record in its detail
 *
 * Every look value comes from the badge assets in ../assets/badge (split-splitting, split-part-status-<pill|dot|icon>:
 * label, tone, icon, shape, motion, which states animate); durations are --fx-motion multiples, so a theme that turns
 * motion off stops them. console-control@1: every part is `row:<build>/part:<pN>` (data-axf-target; kind `part`), the
 * parts grid `row:<build>/grid:build-orchestrator.parts.<build>`; the expanded queue row is the build's own DataGrid row.
 */
import { Chip, Icon } from '@console/axf/react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import splitting from '../assets/badge/split-splitting.json';
import pill from '../assets/badge/split-part-status-pill.json';
import dot from '../assets/badge/split-part-status-dot.json';
import iconOnly from '../assets/badge/split-part-status-icon.json';

export type SplitPart = { id: string; status: string; slot: string; branch: string; account: string; session: string; model: string; steps: string[]; files: number; rebuilds: number; startedAt: string; endedAt: string; lastError: string; head: string };
export type SplitRow = { id: string; run: string; base: string; at: string; badge: { state: string; done: number; total: number; label: string }; parts: SplitPart[]; combine: { branch: string; head: string; pr: number; ci: string; mergedAt: string; liveAt: string; finishedAt: string }; failure: { at: string; part: string; why: string } | null; maxRebuilds: number };
export type GateRejection = { rule: string; at: string; by: string; name: string; reason: string; missing: string[] };
type Look = { label: string; tone: string; icon: string; animate: boolean };
type BadgeAsset = { id: string; data: { shape: string; motion: string; animateWhile?: string[]; statuses?: Record<string, Look>; runs?: Record<string, Look>; icon: string; label: string; tone: string; tooltip?: string } };

/** The part-status badge style in use (UI Review choice set split-part-status; pill until Brett picks). */
export const PART_BADGES: Record<string, BadgeAsset> = { pill: pill as BadgeAsset, dot: dot as BadgeAsset, icon: iconOnly as BadgeAsset };
let style = 'pill';
export function setPartBadgeStyle(s: string): void { if (PART_BADGES[s]) style = s; }
const current = (): BadgeAsset => PART_BADGES[style] ?? (pill as BadgeAsset);
const toneOf = (t: string) => (t === 'muted' || t === 'neutral' ? undefined : (t as 'success' | 'warning' | 'danger' | 'accent'));

/** One badge drawn from an asset look: shape pill = Chip, dot = dot + label, icon = the icon alone (label as its title). */
function Badge({ look, shape, motion, animate, state, title }: { look: Look; shape: string; motion: string; animate: boolean; state: string; title?: string }) {
  const cls = `axp-orch-badge is-${shape}${animate ? ` is-anim is-${motion}` : ''}`;
  const mark = <span className="axp-orch-badge__mark" aria-hidden="true"><Icon name={look.icon} size={12} /></span>;
  if (shape === 'pill') return <span className={cls} data-state={state} title={title ?? look.label}><Chip tone={toneOf(look.tone)}>{mark}{look.label}</Chip></span>;
  if (shape === 'dot') return <span className={cls} data-state={state} data-tone={look.tone} title={title ?? look.label}><span className="axp-orch-badge__dot" aria-hidden="true" /><span className="fx-small">{look.label}</span></span>;
  return <span className={cls} data-state={state} data-tone={look.tone} title={title ?? look.label} aria-label={look.label} role="img">{mark}</span>;
}

/** One part's live badge: animated only while waiting, building, testing or rebuilding. */
export function PartBadge({ status, why }: { status: string; why?: string }) {
  const a = current(); const look = a.data.statuses?.[status] ?? { label: status, tone: 'muted', icon: 'info', animate: false };
  const animate = (a.data.animateWhile ?? []).includes(status) && look.animate;
  return <Badge look={look} shape={a.data.shape} motion={a.data.motion} animate={animate} state={status} title={why ? `${look.label}: ${why}` : undefined} />;
}

/** The row's status for a split build: Splitting (animated) before it has parts, then the roll-up through Finished. */
export function SplitStatus({ status, split }: { status: string; split?: SplitRow }) {
  if (status === 'splitting' || (split && split.run === 'splitting')) {
    const d = (splitting as BadgeAsset).data;
    return <Badge look={{ label: d.label, tone: d.tone, icon: d.icon, animate: true }} shape={d.shape} motion={d.motion} animate state="splitting" title={d.tooltip} />;
  }
  if (!split) return null;
  const a = current(); const st = split.badge.state;
  const look = a.data.runs?.[st] ?? { label: split.badge.label, tone: 'muted', icon: 'info', animate: false };
  const label = st === 'building' ? split.badge.label : look.label;
  const why = split.failure ? `Failed${split.failure.part ? ` (${split.failure.part})` : ''}: ${split.failure.why}` : `${split.id}: ${split.badge.done}/${split.badge.total} parts done`;
  return <span data-split-run={st}><Badge look={{ ...look, label }} shape={a.data.shape === 'icon' ? 'pill' : a.data.shape} motion={a.data.motion} animate={look.animate} state={st} title={why} /></span>;
}

/** The expanded row's parts: slot, branch, account, its steps and a live badge each. */
export function SplitParts({ build, split }: { build: string; split: SplitRow }) {
  const cols: GridColumn<SplitPart>[] = [
    { id: 'id', label: 'Part', width: 'calc(var(--fx-font-size) * 3.5)', render: (p) => <span className="fx-mono fx-small" data-axf-target={`row:${build}/part:${p.id}`}>{p.id}</span> },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-font-size) * 8)', render: (p) => <PartBadge status={p.status} why={p.lastError} /> },
    { id: 'slot', label: 'Slot', width: 'calc(var(--fx-font-size) * 7)', render: (p) => <span className="fx-small fx-mono">{p.slot || '—'}</span> },
    { id: 'branch', label: 'Branch', width: 'minmax(calc(var(--fx-font-size) * 10), 2fr)', render: (p) => <span className="fx-small fx-mono" title={p.head ? `head ${p.head.slice(0, 12)}` : undefined}>{p.branch}</span> },
    { id: 'account', label: 'Account', width: 'calc(var(--fx-font-size) * 7)', render: (p) => <span className="fx-small">{p.account || '—'}</span> },
    { id: 'steps', label: 'Steps', width: 'minmax(calc(var(--fx-font-size) * 6), 1fr)', render: (p) => <span className="fx-small" title={`${p.files} file${p.files === 1 ? '' : 's'}`}>{p.steps.join(', ')}{p.rebuilds ? ` · rebuild ${p.rebuilds}/${split.maxRebuilds}` : ''}</span> },
  ];
  const c = split.combine;
  return (
    <div className="fx-stack" data-axf-target={`row:${build}/grid:build-orchestrator.parts.${build}`}>
      <DataGrid<SplitPart> id={`build-orchestrator.parts.${build}`} label={`${build} parts`}
        groups={[{ id: split.id, title: `${split.id} · ${split.parts.length} part${split.parts.length === 1 ? '' : 's'} · ${split.badge.label}`, rows: split.parts, groups: [], fixed: true }]}
        columns={cols} rowId={(p) => p.id} rowLabel={(p) => `${build} ${p.id}`} hidden={[]} />
      {(c.head || c.pr > 0) && <p className="fx-small"><Icon name="branch" size={13} /> Combine {c.branch}{c.head ? ` @ ${c.head.slice(0, 12)}` : ''}{c.pr ? ` · PR #${c.pr}` : ''}{c.ci ? ` · CI ${c.ci}` : ''}{c.mergedAt ? ' · merged' : ''}{c.liveAt ? ' · live' : ''}{c.finishedAt ? ' · finished' : ''}</p>}
      {split.failure && <p className="fx-small oc-flag" role="alert"><Icon name="alert" size={13} /> Run failed{split.failure.part ? ` (${split.failure.part})` : ''}: {split.failure.why}. Nothing landed; main is unlocked.</p>}
    </div>
  );
}

/** The gate's reason on a Failed row (short) or in its detail (who, when, what was missing). */
export function GateReason({ reason, rejection, full = false }: { reason?: string; rejection?: GateRejection; full?: boolean }) {
  if (!reason && !rejection) return null;
  const text = reason || rejection?.reason || '';
  if (!full) return <span className="fx-small oc-flag axp-orch-gate" title={text} data-gate-reason="require-split-id"><Icon name="shield" size={12} /> {text}</span>;
  return (
    <p className="fx-small oc-flag" role="note" data-gate-reason="require-split-id"><Icon name="shield" size={13} /> Start refused by the gate rule <b>{rejection?.rule || 'require-split-id'}</b>{rejection?.missing?.length ? ` (missing ${rejection.missing.join(', ')})` : ''}: {text}{rejection?.by ? ` · tried by ${rejection.by}` : ''}{rejection?.at ? ` · ${new Date(rejection.at).toLocaleString()}` : ''}. Queue it to send it back through the splitter.</p>
  );
}
