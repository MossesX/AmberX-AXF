/**
 * Row kinds the Build orchestrator owns (grid-row@1, framework/libs/datagrid/rowkinds.ts): `build` (aliases
 * `orchestrator`, `merge` so a Merge log row is a build too), `build-step` (`<build>/<step>`) and `account`.
 * Every grid, card list or log that says its rows are one of these gets the fields, the Related links and the commands
 * below; each command is also the console action `row.<kind>.<command>:<id>[,<id>…]` (control@1 console.actions, so
 * API / MCP / CLI / voice), and the server-side form is `axf control act planner.builds <id> <verb>` where one exists.
 */
import { registerRowKind, type RelatedLink } from '@console/axf/libs/datagrid';
import type { AxfRuntime } from '@console/axf/core';
import { BUILD_ACTIONS, type BuildAction } from '@console/axf/core/build-pipeline.mjs';
import { pluginApi } from '@console/plugins';

const OWNER = 'build-orchestrator';
const api = pluginApi(OWNER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const LABEL: Record<BuildAction, string> = { unqueue: 'Back to Pending', hold: 'Hold', release: 'Release', archive: 'Archive', unarchive: 'Unarchive', delete: 'Delete', restore: 'Restore' };
const ICON: Record<BuildAction, string> = { unqueue: 'arrow-left', hold: 'pause', release: 'play', archive: 'package', unarchive: 'undo', delete: 'trash', restore: 'undo' };
/** The pipeline actions a build allows (pipeline rows carry `actions`; store records don't, so status decides). */
function allows(rec: unknown, a: BuildAction): boolean {
  const r = rec as Rec;
  if (Array.isArray(r.actions)) return (r.actions as string[]).includes(a);
  const st = str(r.status);
  if (a === 'restore') return st === 'deleted';
  if (a === 'unarchive') return st === 'archived';
  if (a === 'release') return !!r.held;
  return st !== 'deleted';
}
async function pipelineAction(action: BuildAction, ids: string[]) {
  const r = await api.post<{ ok: boolean; error?: string; refused?: { id: string; error: string }[] }>('pipeline/action', { action, ids });
  if (!r.ok) throw new Error(r.error ?? `${LABEL[action]} failed`);
  if (r.refused?.length) throw new Error(r.refused.map((x) => x.error).join('; '));
}
async function act(change: Rec) {
  const r = await api.post<{ ok: boolean; error?: string }>('act', change);
  if (!r.ok) throw new Error(r.error ?? 'Change failed');
}

export function registerOrchestratorRowKinds(rt: AxfRuntime, open: (id: string) => void) {
  const offs: (() => void)[] = [];
  offs.push(registerRowKind({
    kind: 'build', label: 'Build', icon: 'layers', owner: OWNER, aliases: ['orchestrator', 'merge'],
    title: (r) => str((r as Rec).title) || str((r as Rec).id),
    open,
    load: async (id) => {
      const r = await api.call<{ ok: boolean; state?: { builds: Rec[] } }>('state');
      return r.state?.builds.find((b) => b.id === id) ?? null;
    },
    related: (rec) => {
      const r = rec as Rec; const out: RelatedLink[] = [];
      if (str(r.pendingId)) out.push({ kind: 'pending', id: str(r.pendingId), note: 'filed as' });
      const p = r.pipeline as Rec | null | undefined;
      if (p && str(p.account)) out.push({ kind: 'account', id: str(p.account), note: 'runs on' });
      if (p && str(p.session)) out.push({ kind: 'session', id: str(p.session), note: 'session' });
      const pl = p?.planned as Rec | null | undefined;
      if (pl && str(pl.account) && pl.account !== p?.account) out.push({ kind: 'account', id: str(pl.account), note: 'planned on' });
      if (str(r.id)) out.push({ kind: 'report', id: `_claude/builds/reports/${str(r.id)}.md`, label: 'Build report', note: 'report' });
      if (str(r.id)) out.push({ kind: 'review', id: `group:${str(r.id)}`, label: 'UI Review shots', note: 'UI Review group' });
      return out;
    },
    commands: [
      { id: 'open', label: 'Open in Build orchestrator', icon: 'layers', effect: 'navigate', order: 1, run: ({ ids }) => open(ids[0]!) },
      { id: 'queue', label: 'Queue it', icon: 'play', multi: true, button: true, order: 5, control: 'node apps/console-web/plugins/build-orchestrator/pipeline.mjs queue {id}',
        when: (r) => str((r as Rec).status) === 'pending' || str((r as Rec).tab) === 'pending',
        run: async ({ ids }) => { for (const id of ids) { const r = await api.post<{ ok: boolean; error?: string }>('pipeline/queue', { id }); if (!r.ok) throw new Error(r.error ?? `${id}: queue failed`); } rt.toast(`${ids.join(', ')} queued.`, 'success'); } },
      ...BUILD_ACTIONS.map((a, i) => ({
        id: a, label: LABEL[a], icon: ICON[a], multi: true, order: 10 + i, effect: a === 'delete' ? 'destructive' as const : 'write' as const,
        ...(a === 'delete' ? { confirm: 'Delete this build? It is kept in Deleted and can be restored.' } : {}),
        control: `node apps/console-web/plugins/build-orchestrator/pipeline.mjs ${a} {id}`,
        when: (r: unknown) => allows(r, a),
        run: async ({ ids }: { ids: string[] }) => { await pipelineAction(a, ids); rt.toast(`${ids.join(', ')}: ${LABEL[a].toLowerCase()}`, 'success'); },
      })),
      { id: 'note', label: 'Add a note…', icon: 'edit', order: 30, control: 'axf control act planner.builds {id} note --input \'{"text":"…"}\'',
        run: async ({ ids }) => { const text = globalThis.prompt?.(`Note on ${ids[0]}`) ?? ''; if (text.trim()) await act({ action: 'note', id: ids[0], text }); } },
      { id: 'copy-id', label: 'Copy build id', icon: 'copy', effect: 'read', order: 90, run: async ({ ids }) => { await navigator.clipboard?.writeText(ids.join(' ')); rt.toast('Copied.', 'success'); } },
    ],
  }));
  offs.push(registerRowKind({
    kind: 'build-step', label: 'Build step', icon: 'list', owner: OWNER, aliases: ['orchestrator-step'],
    title: (r) => str((r as Rec).text) || str((r as Rec).title) || str((r as Rec).id),
    open: (id) => open(id.split('/')[0]!),
    related: (rec, ref) => {
      const r = rec as Rec; const build = str(r.build) || ref.id.split('/')[0]!;
      return build ? [{ kind: 'build', id: build, note: 'step of' }] : [];
    },
    commands: [
      { id: 'done', label: 'Tick done', icon: 'check', button: false, order: 1, control: 'node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step <build> <step>',
        when: (r) => !(r as Rec).done,
        run: async ({ ids }) => { for (const id of ids) { const [b, s] = id.split('/'); await act({ action: 'step', id: b, step: s, done: true }); } } },
      { id: 'undone', label: 'Untick', icon: 'undo', order: 2, when: (r) => !!(r as Rec).done,
        run: async ({ ids }) => { for (const id of ids) { const [b, s] = id.split('/'); await act({ action: 'step', id: b, step: s, done: false }); } } },
    ],
  }));
  offs.push(registerRowKind({
    kind: 'account', label: 'Claude account', icon: 'user', owner: OWNER,
    title: (r) => str((r as Rec).label) || str((r as Rec).name),
    open: () => { rt.navigate('build-orchestrator'); window.dispatchEvent(new CustomEvent('axf:orchestrator-tab', { detail: 'accounts' })); },
    commands: [
      { id: 'open', label: 'Open the Accounts tab', icon: 'user', effect: 'navigate', order: 1, run: () => { rt.navigate('build-orchestrator'); window.dispatchEvent(new CustomEvent('axf:orchestrator-tab', { detail: 'accounts' })); } },
      { id: 'health', label: 'Run a health check', icon: 'refresh', order: 5, run: async () => { await api.post('pipeline/health', {}); rt.toast('Health check asked for: results land in the Accounts tab.', 'success'); } },
    ],
  }));
  return () => offs.forEach((f) => f());
}
