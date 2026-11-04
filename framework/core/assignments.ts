/**
 * Assignment directory — which build or step a helper session has (session-link@1, spec/HANDOFF.md), for every place
 * that lists builds and steps (helper badges, "In X's queue", scoped lists). Brett, Nov 4 2026: "Anywhere a step or a
 * build is listed in any of the tables and it's being built by the helper account, it needs to display that".
 *
 * The Session sync plugin publishes the link's assignments here with `setAssignments(source, list)` (live, on every
 * push event); any list looks one up with `findAssignment(build, step?)` and draws `HelperBadge` (react). Pure and
 * framework-agnostic (no React), like the agent directory. Several sources may publish; a later entry for the same
 * build + step wins. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

/** One helper's hold on a build (or some of its steps). `kind` = the badge to draw. */
export interface AssignmentBadge {
  /** the build the badge is about (a child build's `parent` is listed too) */
  build: string;
  /** step ids when only some steps are the helper's; null = the whole build */
  steps: string[] | null;
  /** queued · working · held · blocked · rejected · released · taken-back · done */
  status: string;
  kind: 'queued' | 'working' | 'held' | 'blocked' | 'rejected' | 'done' | string;
  /** the icon moves while the helper is actually working */
  animated: boolean;
  agent: string;
  session: string;
  account: string;
  /** "Paulie (helper) · step 3/5", "In Paulie's queue (#2)", "On hold at Paulie: lunch" */
  text: string;
  since?: string;
  updatedAt?: string;
  assignment?: string;
  /** the child build a step was handed over as (shown as "with helper" on the parent) */
  withHelper?: string;
}

/** The context-menu target every build reference carries (payload = the build id) and every step (payload = `build.step`). */
export const BUILD_CONTEXT_TARGET = 'axf-build';
export const STEP_CONTEXT_TARGET = 'axf-step';

const sources = new Map<string, AssignmentBadge[]>();
const listeners = new Set<() => void>();
let rev = 0;
let all: AssignmentBadge[] = [];

function rebuild() {
  all = [...sources.values()].flat();
  rev += 1;
  for (const l of listeners) l();
}

/** Publish (or replace) one source's assignments. Entries without a build are dropped. */
export function setAssignments(source: string, list: readonly AssignmentBadge[]): void {
  const clean = list.filter((a) => a && typeof a.build === 'string' && a.build).map((a) => ({ ...a, steps: Array.isArray(a.steps) ? [...a.steps] : null }));
  const before = JSON.stringify(sources.get(source) ?? []);
  if (before === JSON.stringify(clean)) return;
  sources.set(source, clean);
  rebuild();
}
export function clearAssignments(source?: string): void {
  if (source) sources.delete(source); else sources.clear();
  rebuild();
}
/** The badge for a build (any helper on it or on its steps) or for one step; null when nobody else has it. */
export function findAssignment(build: string, step = ''): AssignmentBadge | null {
  const list = all.filter((a) => (a.build === build || a.withHelper === build) && (!step || !a.steps || a.steps.includes(step)));
  return list.find((a) => a.kind === 'working') ?? list[0] ?? null;
}
export function listAssignments(): AssignmentBadge[] { return [...all]; }
export function assignmentRev(): number { return rev; }
export function subscribeAssignments(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
