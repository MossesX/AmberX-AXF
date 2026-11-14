/*
 * The landing cell on a build row (build-pipeline@1 `land`): how many commits the build is behind main and where its
 * landing stands. Brett, Nov 14 2026: "I keep getting too many commits behind" (build land-finish-auto-land-live-clear-backlog).
 *
 * <LandCell build={b} />   `312 behind · Red`, `Landed`, `Flagged`… One cell for every build grid (Build manager,
 *                          Pipeline tabs, Pending, the orchestrator), so they all read the same record the same way.
 *
 * `build` is any build row that carries { id, status, mergedAt?, land? } (the builds@1 record or a row made from it).
 * Nothing is drawn for a build the lander never touched and that isn't finished. Each cell is a control@1 target
 * `land:<build id>` (state: behindMain, landState, checkedAt, last attempt; focus scrolls to it), so voice, MCP and the
 * console API read the same numbers. Theme tokens and framework classes only.
 */
import { useRef } from 'react';
import { Chip } from './Controls';
import { useControlTarget } from '../controlTargets';
import { LAND_STATE_LABEL, landStateOf, normLand } from '../../core/build-pipeline.mjs';

export interface LandRow { id: string; status?: string; mergedAt?: string | null; land?: unknown }

type Tone = 'accent' | 'success' | 'warning' | 'danger' | undefined;
const TONE: Record<string, Tone> = { landed: 'success', red: 'danger', flagged: 'warning', landing: 'accent', waiting: undefined, archived: undefined };

/** What the cell shows, as plain data (the grid sorts and the API reads it). */
export function landView(b: LandRow) {
  const l = normLand(b.land);
  const state = landStateOf(b as Parameters<typeof landStateOf>[0]);
  const behind = l && Number.isInteger(l.behindMain) ? (l.behindMain as number) : null;
  const last = l?.landAttempts?.length ? l.landAttempts[l.landAttempts.length - 1] : null;
  return { state, label: (LAND_STATE_LABEL as Record<string, string>)[state] || '', behind, checkedAt: l?.behindCheckedAt || '', last };
}

/** Sort value: the most behind first when sorted descending; builds with no count sort last. */
export const landSortValue = (b: LandRow) => { const v = landView(b); return v.behind ?? -1; };

export function LandCell({ build }: { build: LandRow }) {
  const v = landView(build);
  const el = useRef<HTMLSpanElement | null>(null);
  const setTarget = useControlTarget(build.id ? {
    address: `land:${build.id}`, kind: 'row', label: `${build.id}: ${v.behind != null ? `${v.behind} behind main` : 'behind main not counted'}${v.label ? `, ${v.label}` : ''}`,
    keywords: ['landing', 'behind main', 'commits behind', v.state || 'none'], element: () => el.current,
    can: ['state', 'focus'], get: () => (v.behind != null ? String(v.behind) : ''),
    state: () => ({ behindMain: v.behind, landState: v.state, checkedAt: v.checkedAt, lastAttempt: v.last }),
  } : null, [build.id, v.behind, v.state, v.checkedAt, v.last?.run]);
  if (!v.state && v.behind == null) return <span className="fx-muted">—</span>;
  const title = [v.behind != null ? `${v.behind} commit${v.behind === 1 ? '' : 's'} on main this build does not have${v.checkedAt ? ` (counted ${v.checkedAt.slice(0, 16).replace('T', ' ')})` : ''}` : '', v.last?.note || ''].filter(Boolean).join('\n');
  return (
    <span ref={(d) => { el.current = d; setTarget(d); }} className="fx-small" title={title}>
      {v.behind != null && <span className="fx-mono">{v.behind} behind</span>}
      {v.behind != null && v.label && ' · '}
      {v.label && <Chip tone={TONE[v.state]}>{v.label}</Chip>}
    </span>
  );
}
