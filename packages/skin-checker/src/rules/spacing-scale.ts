/**
 * Rule 1, spacing and sizing on the token scale.
 *
 * The spacing scale is the density asset's own tokens: its gap steps (`gap.*`) and its named paddings (`pad.*`),
 * all in space units. Every spacing value of the sizing asset (each `padX`, `padY`, `pad`: the padding, gap and margin
 * a control or card draws with) must sit on one of them, within `spacing.tolerance` of the step.
 *
 * Heights are steps too: a control's height (`button.height`, `field.height`) is the density's control row
 * (`row.control`), a list row's minimum height (`listRow.minHeight`) is its list row (`row.list`). That keeps a button
 * and the field next to it the same height, and every list on the same rhythm.
 *
 *   spacing.off-scale       one issue per off-scale value; the fix snaps it to the nearest step
 *   spacing.too-many-steps  more distinct spacing values in use than `spacing.maxDistinct` (no fix: a person decides)
 */
import { SCALE_FIELDS } from '../../../../framework/core/engines/scale-rules.mjs';
import type { SkinCheckRule } from '../contract.ts';
import { defineRule, tokenRef } from '../engine.ts';
import { scaleVar } from '../vars.ts';
import { fmt, isObj, nearestStep, numericLeaves, onStep, round, stepList, type Step } from './util.ts';

/** The density steps, gaps first (so a tie names the gap). */
export function spacingScale(density: unknown): Step[] {
  return [...numericLeaves(density, 'gap'), ...numericLeaves(density, 'pad')];
}

/** Sizing paths whose unit is space (paddings and gaps), in table order. */
export const SIZING_SPACE_PATHS: readonly string[] = Object.entries(SCALE_FIELDS.sizing).filter(([, f]) => f[3] === 'space').map(([k]) => k);

/** Sizing heights and the density row each one must match. */
export const HEIGHT_ROWS: Readonly<Record<string, string>> = { 'button.height': 'row.control', 'field.height': 'row.control', 'listRow.minHeight': 'row.list' };

function leaf(data: unknown, path: string): number | null {
  let cur: unknown = data;
  for (const p of path.split('.')) {
    if (!isObj(cur)) return null;
    cur = cur[p];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null;
}

export const spacingOffScale: SkinCheckRule = defineRule('spacing.off-scale', ['density', 'sizing'], (ctx) => {
  const { subject, settings } = ctx;
  const density = subject.density!.data;
  const sizing = subject.sizing!.data;
  const scale = spacingScale(density);
  if (!scale.length) return;
  const tol = settings.spacing.tolerance;
  for (const path of SIZING_SPACE_PATHS) {
    const v = leaf(sizing, path);
    if (v === null || v === 0) continue;
    const near = nearestStep(v, scale)!;
    if (onStep(v, near, tol)) continue;
    ctx.report({
      token: tokenRef(subject, 'sizing', path, scaleVar('sizing', path)),
      value: v,
      expected: `a spacing step: ${stepList(scale)}`,
      message: `${path} is ${fmt(v)}, off the spacing scale; nearest step ${near.name} is ${fmt(near.value)}.`,
      measured: round(Math.abs(v - near.value)),
      fix: { kind: 'set', label: `Snap to ${near.name} (${fmt(near.value)})`, writes: [{ token: tokenRef(subject, 'sizing', path), value: near.value }] },
    });
  }
  for (const [path, row] of Object.entries(HEIGHT_ROWS)) {
    const v = leaf(sizing, path);
    const want = leaf(density, row);
    if (v === null || want === null) continue;
    const step = { name: row, value: want };
    if (onStep(v, step, tol)) continue;
    ctx.report({
      token: tokenRef(subject, 'sizing', path, scaleVar('sizing', path)),
      value: v,
      expected: `the ${row} height: ${fmt(want)}`,
      message: `${path} is ${fmt(v)}, off the ${row} height ${fmt(want)}; rows and controls drift out of line.`,
      measured: round(Math.abs(v - want)),
      fix: { kind: 'set', label: `Snap to ${row} (${fmt(want)})`, writes: [{ token: tokenRef(subject, 'sizing', path), value: want }] },
    });
  }
});

export const spacingTooManySteps: SkinCheckRule = defineRule('spacing.too-many-steps', ['density', 'sizing'], (ctx) => {
  const { subject, settings } = ctx;
  const used = new Set<number>();
  for (const s of spacingScale(subject.density!.data)) if (s.value > 0) used.add(round(s.value, 2));
  for (const path of SIZING_SPACE_PATHS) {
    const v = leaf(subject.sizing!.data, path);
    if (v !== null && v > 0) used.add(round(v, 2));
  }
  const max = settings.spacing.maxDistinct;
  if (used.size <= max) return;
  ctx.report({
    token: tokenRef(subject, 'density', 'gap', '--fx-dens-gap'),
    value: used.size,
    expected: `at most ${max} distinct spacing values`,
    message: `${used.size} distinct spacing values in use (gap, pad and sizing paddings); more than ${max} reads as unplanned.`,
    measured: used.size,
  });
});

export const SPACING_RULES: readonly SkinCheckRule[] = [spacingOffScale, spacingTooManySteps];
