/** Small helpers the rules share. Pure. */

export interface Step { name: string; value: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Round for display and comparison (scale values carry at most 3 decimals). */
export const round = (n: number, dp = 3): number => Math.round(n * 10 ** dp) / 10 ** dp;
export const fmt = (n: number): string => String(round(n));

/** The step closest to a value (ties go to the smaller step), or null when there are none. */
export function nearestStep(value: number, steps: readonly Step[]): Step | null {
  let best: Step | null = null;
  for (const s of steps) {
    const d = Math.abs(s.value - value);
    if (!best || d < Math.abs(best.value - value) - 1e-9 || (Math.abs(d - Math.abs(best.value - value)) < 1e-9 && s.value < best.value)) best = s;
  }
  return best;
}

/** True when `value` sits within `tolerance` (a fraction of the step) of the step. */
export function onStep(value: number, step: Step, tolerance: number): boolean {
  const d = Math.abs(value - step.value);
  return d < 1e-9 || d <= Math.abs(step.value) * tolerance + 1e-9;
}

/** Every numeric leaf of a group in a scale asset's data: `gap` → [{ name: 'gap.md', value: 0.4 }, …]. */
export function numericLeaves(data: unknown, group: string): Step[] {
  const g = isObj(data) ? data[group] : undefined;
  if (!isObj(g)) return [];
  return Object.entries(g).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => ({ name: `${group}.${k}`, value: v as number }));
}

/** "0.1, 0.2, 0.3 …" for an `expected` line (at most `max` values). */
export function stepList(steps: readonly Step[], max = 8): string {
  const vals = [...new Set(steps.map((s) => round(s.value)))].sort((a, b) => a - b);
  return vals.slice(0, max).join(', ') + (vals.length > max ? ' …' : '');
}

export { isObj };
