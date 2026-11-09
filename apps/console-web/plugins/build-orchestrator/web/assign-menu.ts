import type { AxfRuntime, MenuEntry } from '@console/axf/core';

/*
 * Assign to account (Brett, Nov 9 2026: "I need to be able to right-click jobs in the orchestrator and assign them to
 * one of my stored accounts"). Right-click (or long-press) a build card or grid row on the Pipeline or Builds tab: an
 * "Assign to account" submenu lists Auto and every saved Claude account (subscription logins, then API-key accounts)
 * with what each can take now; the current pin is ticked. Picking one runs the action
 * `build-orchestrator.assign:<build>:<account|auto>` → POST /pipeline/pin (the same as the plugin command pipeline-pin,
 * MCP build-orchestrator_pipeline-pin and `pipeline.mjs pin`). Builds that left the pipeline (built, complete…) get no
 * entry. The menu reads a cached GET /pipeline (refreshed by the Pipeline tab, on page open and when it is stale).
 */

export const CTX_TARGET = 'axf-orchestrator-build';
export const ASSIGN_ACTION = 'build-orchestrator.assign';
const STALE_MS = 30_000;

export type AssignAccount = { name: string; label?: string; kind?: string; fable: boolean; running: number; parallel: number; free: number; usable: boolean; why: string; api?: { usable: boolean; why: string } | null };
type Row = { id: string; pipeline?: { pin?: string } | null };
export type AssignStatus = { accounts: AssignAccount[]; table: { pending: Row[]; queued: Row[]; building: Row[] } };
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };

let cache: { at: number; accounts: AssignAccount[]; pins: Map<string, string> } = { at: 0, accounts: [], pins: new Map() };
const listeners = new Set<() => void>();

/** Feed the menu from a GET /pipeline answer (the Pipeline tab calls this on every load). */
export function setAssignStatus(s: AssignStatus): void {
  const pins = new Map<string, string>();
  for (const r of [...s.table.pending, ...s.table.queued, ...s.table.building]) pins.set(r.id, r.pipeline?.pin ?? '');
  cache = { at: Date.now(), accounts: s.accounts, pins };
}

/** Reload the cache now (page open, a stale menu). */
export async function refreshAssign(api: Api): Promise<void> {
  try { const r = await api.call<AssignStatus & { ok: boolean }>('pipeline'); if (r.ok) setAssignStatus(r); } catch { /* the menu keeps what it had */ }
}

/** Run `fn` after every pin change made through the menu (the open tab reloads). */
export function onAssigned(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export const accountLabel = (accounts: AssignAccount[], name: string) => { const a = accounts.find((x) => x.name === name); return a?.label || name; };
export const pinnedAccounts = () => cache.accounts;

/** The account's label; its saved name too when another account shares the label (two "Hulu API" keys). */
function nameOf(a: AssignAccount): string {
  const label = a.label || a.name;
  return cache.accounts.some((x) => x !== a && (x.label || x.name) === label) && label !== a.name ? `${label} · ${a.name}` : label;
}
/** The first clause of a reason (the how-to-fix part stays on the Pipeline tab's account card). */
const short = (why: string) => why.split(' (')[0]!.trim();

/** What an account can take now, in a few words (shown after its name). */
function stateOf(a: AssignAccount): string {
  if (a.kind === 'api') return a.api?.usable ? `API key · ${a.running}/${a.parallel}` : `API key · ${short(a.api?.why || 'not usable')}`;
  if (a.why === 'switched off for the pipeline' || /until/.test(a.why)) return short(a.why);
  return `${a.fable ? 'Fable' : 'Opus'} · ${a.running}/${a.parallel}`;
}

/** The submenu for one build ([] for a build that is not in Pending, Queue or Building). */
export function assignMenu(id: string): MenuEntry[] {
  if (!id || !cache.pins.has(id)) return [];
  const pin = cache.pins.get(id) ?? '';
  const mark = (on: boolean) => (on ? 'check' : 'user');
  const subs = cache.accounts.filter((a) => a.kind !== 'api');
  const apis = cache.accounts.filter((a) => a.kind === 'api');
  const item = (a: AssignAccount): MenuEntry => ({ id: `orch-assign-${a.name}`, label: `${nameOf(a)} (${stateOf(a)})`, icon: mark(pin === a.name), action: `${ASSIGN_ACTION}:${id}:${a.name}` });
  const items: MenuEntry[] = [
    { id: 'orch-assign-auto', label: 'Auto (the dispatcher picks)', icon: mark(!pin), action: `${ASSIGN_ACTION}:${id}:auto` },
    ...(subs.length ? [{ id: 'orch-assign-s1', separator: true }, ...subs.map(item)] : []),
    ...(apis.length ? [{ id: 'orch-assign-s2', separator: true }, ...apis.map(item)] : []),
  ];
  const now = pin ? accountLabel(cache.accounts, pin) : 'Auto';
  return [{ id: 'orch-assign', label: `Assign to account: ${now}`, icon: 'user', items }];
}

/** Register the right-click entry and its action (plugin `register`). */
export function registerAssignMenu(rt: AxfRuntime, api: Api): void {
  rt.contextExtras.set(CTX_TARGET, (_t, id = '') => {
    if (Date.now() - cache.at > STALE_MS) void refreshAssign(api);
    return assignMenu(id);
  });
  rt.actions.register(ASSIGN_ACTION, ([id, account]) => {
    if (!id || !account) return;
    void (async () => {
      try {
        const r = await api.post<{ ok: boolean; error?: string; pin?: string }>('pipeline/pin', { id, account });
        if (!r.ok) throw new Error(r.error || 'pin failed');
        const what = account === 'auto' ? `${id}: account Auto` : `${id}: assigned to ${accountLabel(cache.accounts, account)}`;
        rt.terminal.log('orchestrator', what, 'ok'); rt.toast(what, 'success');
        await refreshAssign(api);
        listeners.forEach((fn) => fn());
      } catch (e) { rt.terminal.log('orchestrator', (e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); }
    })();
  }, { label: 'Assign a build to a saved Claude account', params: true });
}
