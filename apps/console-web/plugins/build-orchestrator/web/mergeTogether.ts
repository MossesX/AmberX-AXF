/**
 * "Merge together" (Brett, Nov 23 2026: "compile them all into one and merge them all together"): ask the lander to
 * combine every build waiting in the merge line into one branch, run CI once and merge them in one go. A build that
 * clashes is named and lands one at a time. The lander owns the action; this is only the call.
 *
 * The call goes to the console server's builds routes first and to this plugin's own server second, so the button
 * works wherever the lander's action is mounted. A server with neither says so in plain words.
 */
import * as consoleApi from '@console/api';
import type { pluginApi } from '@console/plugins';

type Api = ReturnType<typeof pluginApi>;
export type MergeTogetherResult = { ok: boolean; error?: string; message?: string; note?: string; branch?: string; pr?: number | string; builds?: string[]; merged?: string[]; clashed?: (string | { id?: string; build?: string; why?: string })[] };

export const MERGE_TOGETHER_ROUTE = 'builds/merge-together';
export const MERGE_TOGETHER_PLUGIN_ROUTE = 'pipeline/merge-together';
const MISSING = /not found|method not allowed|\b40[45]\b/i;

/** The plain line a result reads as. */
export function mergeTogetherLine(r: MergeTogetherResult, asked: number): string {
  const clashed = (r.clashed ?? []).map((c) => (typeof c === 'string' ? c : c.id ?? c.build ?? '')).filter(Boolean);
  const said = r.message ?? r.note ?? '';
  const base = said || `Merge together: the lander combines ${r.builds?.length ?? asked} waiting build${(r.builds?.length ?? asked) === 1 ? '' : 's'} into one branch, runs CI once and merges them in one go.`;
  return clashed.length ? `${base} ${clashed.join(', ')} clash${clashed.length === 1 ? 'es' : ''}: landing one at a time.` : base;
}

/** Ask the lander to merge these waiting builds together. Throws with a plain reason when it cannot. */
export async function mergeTogether(api: Api, builds: string[]): Promise<MergeTogetherResult> {
  const body = { builds, reason: { title: 'Merge together', description: `Combine ${builds.length} waiting build${builds.length === 1 ? '' : 's'} into one branch, run CI once and merge them in one go.` } };
  const first = (await consoleApi.post(MERGE_TOGETHER_ROUTE, body)) as MergeTogetherResult;
  if (first.ok) return first;
  if (!MISSING.test(first.error ?? '')) throw new Error(first.error ?? 'The lander did not take the request.');
  try {
    const second = await api.post<MergeTogetherResult>(MERGE_TOGETHER_PLUGIN_ROUTE, body);
    if (!second.ok) throw new Error(second.error ?? 'The lander did not take the request.');
    return second;
  } catch (e) {
    if (MISSING.test((e as Error).message)) throw new Error('Merge together is not on this server yet: the lander still merges the waiting builds one at a time.');
    throw e;
  }
}
