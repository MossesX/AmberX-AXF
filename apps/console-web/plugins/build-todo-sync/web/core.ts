/**
 * Build to-do sync — pure part of the web plugin (no React, no CSS): the shapes the server answers with and the small
 * rules the views use. Checked by test.mts.
 */

export const CATEGORIES = ['Plugin', 'Plugin extension', 'Add-on', 'Framework', 'App', 'Feature', 'Module'] as const;
export type Category = (typeof CATEGORIES)[number];
export const MAX_NAME = 48;

export interface MirroredBuild { id: string; displayName: string; title: string; category: string; area: string; nameReview: boolean; status: string; place: string; profiles: string[]; steps: number; done: number; next: string; updatedAt: string }
export interface NameRow { id: string; title: string; displayName: string; category: string; area: string; status: string; source: string; createdAt: string; profiles: string[]; suggested: { displayName: string; category: string; why: string; confidence: string } }
export interface Ask { id: string; kind: 'ticked' | 'unticked'; build: string; step: string; stepId: string; item: string; at: string; state: string; title: string; by?: string; closedAt?: string }
export interface Drift { kind: string; build: string; stepId?: string; fixId?: string; item?: string; listName?: string; title?: string; at: string }
export interface Settings { on: boolean; completedDays: number; reconcileMinutes: number; pollSeconds: number; linkBase: string; autoPrompt: boolean; debounceSeconds: number }
export interface SyncState { ok: boolean; settings: Settings; enabled: boolean; control: boolean; lastSync: string; lastOk: boolean | null; lastError: string; lastSummary: { builds: number; groups: number; ops: number; adds: number; sets: number; removes: number; drift: number } | null; lastReason: string; lastFull: string; builds: MirroredBuild[]; drift: Drift[]; openAsks: Ask[]; links: Record<string, number>; clients: number }
export interface Frame { $axf?: string; type?: string; at?: string; [k: string]: unknown }

export const GROUP_LAST = ['Done', 'Archive'];

/** Builds grouped by their place in the to-do manager: categories A→Z, then Done, then Archive. */
export function groupBuilds(builds: readonly MirroredBuild[]): { place: string; builds: MirroredBuild[] }[] {
  const by = new Map<string, MirroredBuild[]>();
  for (const b of builds) by.set(b.place, [...(by.get(b.place) ?? []), b]);
  const rank = (p: string) => (GROUP_LAST.includes(p) ? GROUP_LAST.indexOf(p) + 1 : 0);
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([place, list]) => ({ place, builds: [...list].sort((a, b) => a.displayName.localeCompare(b.displayName)) }));
}

/** "just now", "3 min ago", "2 h ago", "4 d ago"; '' without a time. */
export function since(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** A frame from the server stream, or null when it is not one of ours. */
export function parseFrame(raw: unknown): Frame | null {
  const f = (typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw) as Frame | null;
  return f && typeof f === 'object' && f.$axf === 'build-todo-sync@1' && typeof f.type === 'string' ? f : null;
}

/** What an ask asks, in one line. */
export function askLine(a: Ask): string {
  return a.kind === 'ticked' ? `You ticked step ${a.stepId || a.step} of ${a.build} in the to-do manager. Mark the step done in the orchestrator?`
    : `You unticked step ${a.stepId || a.step} of ${a.build} in the to-do manager. Reopen the step in the orchestrator?`;
}

/**
 * Builds the console should prompt a name for now: still unreviewed, made in the last `withinMin` minutes, not yet
 * prompted in this browser (newest first). Nothing when auto-prompt is off.
 */
export function promptCandidates(names: readonly NameRow[], prompted: ReadonlySet<string>, { now = Date.now(), withinMin = 15, autoPrompt = true } = {}): NameRow[] {
  if (!autoPrompt) return [];
  return names.filter((n) => !prompted.has(n.id) && now - Date.parse(n.createdAt) <= withinMin * 60_000 && !['built', 'complete', 'archived'].includes(n.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A name as the store takes it: trimmed, at most MAX_NAME; '' when nothing is left. */
export const cleanName = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** One line for the sync status chip. */
export function statusLine(s: Pick<SyncState, 'enabled' | 'control' | 'lastSync' | 'lastOk' | 'lastError' | 'lastSummary'>, now = Date.now()): { tone: 'success' | 'warning' | 'danger'; text: string } {
  if (!s.control) return { tone: 'danger', text: 'The to-do manager is out of reach (Token control plugin off)' };
  if (!s.enabled) return { tone: 'warning', text: 'Off: the lists are not following the builds' };
  if (!s.lastSync) return { tone: 'warning', text: 'Not synced yet' };
  if (s.lastOk === false) return { tone: 'danger', text: `Last sync failed ${since(s.lastSync, now)}: ${s.lastError}`.trim() };
  return { tone: 'success', text: `Synced ${since(s.lastSync, now)} · ${s.lastSummary?.builds ?? 0} build list(s)` };
}
