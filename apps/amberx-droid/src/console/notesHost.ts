/**
 * AmberX's side of the shared Notes and tasks plugin's host seam (`@console/notesHost`; the console's copy is
 * `apps/console-web/src/notesHost.ts`).
 */
import { HUB } from '../hub/useHub';
import { native } from '../native';
import { summarize as aiSummarize, useAiStatus } from '../plugins/ai/web/client';

export const NAV_GROUP = 'Work';
export const hubAddress = (): string => HUB;
export function openHubSignIn(url: string): void { void native.hubOpen({ url }); }
export const useSummarizer = (): { ok: boolean } => useAiStatus();
export const summarize = aiSummarize;
/** plugins.ts globs the plugin that imports this: read it lazily. */
export async function listedPlugins(): Promise<{ id: string; name: string }[] | null> {
  const { loadPlugins } = await import('../plugins');
  return loadPlugins().map((p) => ({ id: p.id, name: p.name }));
}
