/**
 * Merge banner (build auto-merge-switch, Brett Nov 11 2026: "The merge banner needs to group those actions: the ones
 * waiting for that answer for the toggle, the ones that are ready to merge, and the ones that are merged."). Four
 * collapsible groups with counts, from GET merge-banner (auto-merge-core.mjs groups()):
 *   Auto-merge?     one entry per build sent to the orchestrator: "Auto-merge this build when done?" On / Off;
 *   Ready to merge  finished builds waiting for Brett (tests, clash): Merge (tap twice, one build at a time) / Skip / Rebuild;
 *   Blocked         red tests or a clash with main: Rebuild / Skip;
 *   Merged          landed builds (last 7 days, with the commit): Dismiss.
 * Every group has select-all and a toolbar acting on the selected entries (auto-merge on / off, dismiss). The banner
 * hides when every group is empty. Framework controls only; orchestrator.css lays it out.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BannerIcon, Button, Checkbox, Chip, Icon, PriorityTag, useBannerLaunchOpen, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';

export type GroupId = 'ask' | 'ready' | 'blocked' | 'merged';
export interface Entry {
  id: string; title: string; group: GroupId; status: string; autoMerge: boolean; answered: boolean; branch: string; pr: string; agent: string; createdAt: string; builtAt: string;
  tests?: string; clash?: string; queueState?: string; queueWhy?: string; prNumber?: number; url?: string; approved?: boolean; landing?: boolean; why?: string; runUrl?: string; mergedAt?: string; commit?: string;
}
export interface BannerData { ok: boolean; groups: Record<GroupId, Entry[]>; counts: Record<GroupId, number>; total: number }

const api = pluginApi('build-orchestrator', 'Merge banner', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
const POLL_MS = 60_000;
const ORDER: GroupId[] = ['ask', 'ready', 'blocked', 'merged'];
const TITLE: Record<GroupId, string> = { ask: 'Auto-merge?', ready: 'Ready to merge', blocked: 'Blocked', merged: 'Merged' };
const HINT: Record<GroupId, string> = {
  ask: 'Auto-merge this build when done? Off (the default) waits for your Merge.',
  ready: 'Finished, not on main. Merge lands it after its test run on current main; one at a time.',
  blocked: 'Tests failed or it clashes with main. Nothing lands.',
  merged: 'On main.',
};

let st: { data: BannerData | null; error: string; busy: string } = { data: null, error: '', busy: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useBanner = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
export async function loadBanner(): Promise<void> {
  try { set({ data: await api.call<BannerData>('merge-banner'), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
}
let timer: ReturnType<typeof setInterval> | null = null;
function start(): void {
  if (timer) return;
  void loadBanner();
  timer = setInterval(() => { if (document.visibilityState === 'visible') void loadBanner(); }, POLL_MS);
}

type Toast = (text: string, tone: 'success' | 'warning' | 'danger' | 'info') => void;
/** Auto-merge on / off for one build or many (also the orchestrator's right-click item and card switch). */
export async function setAutoMerge(ids: string[], on: boolean, toast: Toast): Promise<boolean> {
  if (!ids.length) return false;
  set({ busy: ids.length === 1 ? (ids[0] ?? '') : 'bulk' });
  try {
    const r = await api.post<{ ok: boolean; error?: string; done?: { id: string }[]; refused?: { id: string; error: string }[] }>('pipeline/auto-merge', { ids, on });
    if (!r.ok) throw new Error(r.error);
    const done = r.done ?? [];
    if (done.length) toast(`${done.length === 1 ? done[0]?.id : `${done.length} builds`}: auto-merge ${on ? 'on (lands by itself on green)' : 'off (waits for your Merge)'}`, 'success');
    if (r.refused?.length) toast(r.refused.map((x) => x.error).join('; '), 'warning');
    void loadBanner();
    return true;
  } catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger'); return false; }
  finally { set({ busy: '' }); }
}
async function decide(id: string, decision: 'merge' | 'skip' | 'rebuild', toast: Toast): Promise<void> {
  set({ busy: id });
  try {
    const r = await api.post<{ ok: boolean; error?: string }>('merge-banner/decide', { id, decision });
    if (!r.ok) throw new Error(r.error);
    toast(decision === 'merge' ? `${id}: merging. The merge queue tests it on current main and lands it on green.` : decision === 'skip' ? `${id}: skipped and archived.` : `${id}: back in the Queue to rebuild on current main.`, 'success');
    void loadBanner();
  } catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger'); }
  finally { set({ busy: '' }); }
}
async function dismiss(ids: string[], toast: Toast): Promise<void> {
  set({ busy: 'bulk' });
  try { await api.post('merge-banner/dismiss', { ids }); void loadBanner(); }
  catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger'); }
  finally { set({ busy: '' }); }
}

const fmt = (v?: string) => { const d = new Date(v ?? ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const TEST_TONE: Record<string, 'success' | 'danger' | 'warning' | undefined> = { green: 'success', red: 'danger', running: 'warning' };

function Item({ e, selected, onSelect, toast }: { e: Entry; selected: boolean; onSelect: (on: boolean) => void; toast: Toast }) {
  const s = useBanner();
  const [sure, setSure] = useState(false);
  const busy = s.busy === e.id || s.busy === 'bulk';
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 6000); return () => clearTimeout(t); }, [sure]);
  return (
    <li className={`mb-item is-${e.group}`} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={e.id}>
      <Checkbox label="Select" checked={selected} onChange={onSelect} />
      <span className="mb-item__body">
        <span className="mb-item__line">
          <b className="mb-item__title">{e.title}</b>
          <PriorityTag build={e.id} />
          {e.autoMerge && <Chip tone="success">Auto-merge</Chip>}
          {e.group === 'blocked' && <Chip tone="danger">Blocked</Chip>}
        </span>
        <span className="mb-item__meta fx-small fx-muted">
          {e.id}{e.agent ? ` · ${e.agent}` : ''}{e.prNumber ? ` · PR #${e.prNumber}` : e.pr ? ` · ${e.pr}` : ''}
          {e.group === 'ask' ? ` · ${e.status}` : ''}{e.builtAt && e.group !== 'merged' && e.group !== 'ask' ? ` · built ${fmt(e.builtAt)}` : ''}{e.mergedAt ? ` · landed ${fmt(e.mergedAt)}` : ''}{e.commit ? ` · ${e.commit.slice(0, 8)}` : ''}
        </span>
        {(e.group === 'ready' || e.group === 'blocked') && (
          <span className="mb-item__line">
            <Chip tone={TEST_TONE[e.tests ?? '']}>Tests {e.tests}</Chip>
            <Chip tone={e.clash === 'clashes with main' ? 'danger' : e.clash === 'merges cleanly' ? 'success' : undefined}>{e.clash}</Chip>
            {e.landing && <Chip tone="accent">{e.autoMerge ? 'Lands by itself on green' : 'Approved: landing'}</Chip>}
          </span>
        )}
        {e.why && <span className="fx-small mb-item__why"><Icon name="alert" size={13} /> {e.why}</span>}
      </span>
      <span className="mb-item__acts" role="toolbar" aria-label={`${e.title}: actions`}>
        {e.group === 'ask' && <>
          <Button size="sm" tone="primary" icon="check" disabled={busy} title="Auto-merge this build when done: main merged in, tested, lands on green" onClick={() => void setAutoMerge([e.id], true, toast)}>On</Button>
          <Button size="sm" tone="neutral" icon="x" disabled={busy} title="Keep it off: it waits in Ready to merge for your Merge" onClick={() => void setAutoMerge([e.id], false, toast)}>Off</Button>
        </>}
        {e.group === 'ready' && !e.landing && <>
          <Button size="sm" tone={sure ? 'danger' : 'primary'} icon="branch" disabled={busy} title="Merge this one build: the merge queue tests it on current main and lands it on green" onClick={() => { if (!sure) { setSure(true); return; } setSure(false); void decide(e.id, 'merge', toast); }}>{sure ? 'Tap again to merge' : 'Merge'}</Button>
          <Button size="sm" tone="neutral" icon="package" disabled={busy} title="Never merge it: archive it" onClick={() => void decide(e.id, 'skip', toast)}>Skip</Button>
          <Button size="sm" tone="neutral" icon="refresh" disabled={busy} title="Rebuild it on current main (back in the Queue)" onClick={() => void decide(e.id, 'rebuild', toast)}>Rebuild</Button>
        </>}
        {e.group === 'blocked' && <>
          <Button size="sm" tone="primary" icon="refresh" disabled={busy} title="Rebuild it on current main (back in the Queue)" onClick={() => void decide(e.id, 'rebuild', toast)}>Rebuild</Button>
          <Button size="sm" tone="neutral" icon="package" disabled={busy} title="Never merge it: archive it" onClick={() => void decide(e.id, 'skip', toast)}>Skip</Button>
          {e.runUrl && <a className="fx-btn fx-btn--sm" href={e.runUrl} target="_blank" rel="noreferrer">Run</a>}
        </>}
        {e.group === 'merged' && <Button size="sm" tone="quiet" icon="x" disabled={busy} title="Clear it from the banner" onClick={() => void dismiss([e.id], toast)}>Dismiss</Button>}
      </span>
    </li>
  );
}

function Group({ g, list, toast }: { g: GroupId; list: Entry[]; toast: Toast }) {
  const s = useBanner();
  const [open, setOpen] = useState(g !== 'merged');
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const ids = list.map((e) => e.id);
  const chosen = ids.filter((id) => sel.has(id));
  useEffect(() => { setSel((cur) => new Set([...cur].filter((id) => ids.includes(id)))); }, [ids.join(',')]);
  if (!list.length) return null;
  const busy = s.busy === 'bulk';
  const done = () => setSel(new Set());
  return (
    <section className={`mb-group is-${g}`} aria-label={TITLE[g]}>
      <div className="mb-group__head">
        <Button size="sm" tone="quiet" icon={open ? 'chevron-down' : 'chevron-right'} aria-expanded={open} onClick={() => setOpen(!open)}>{TITLE[g]} <span className="oc-count">{list.length}</span></Button>
        <span className="fx-small fx-muted mb-group__hint">{HINT[g]}</span>
      </div>
      {open && <>
        <div className="mb-group__bar" role="toolbar" aria-label={`${TITLE[g]}: selected entries`}>
          <Checkbox label={chosen.length ? `${chosen.length} selected` : 'Select all'} checked={chosen.length === ids.length} indeterminate={chosen.length > 0 && chosen.length < ids.length} disabled={busy} onChange={(on) => setSel(on ? new Set(ids) : new Set())} />
          {g !== 'merged' && <>
            <Button size="sm" tone="primary" icon="check" disabled={!chosen.length || busy} title="Auto-merge every selected build when done" onClick={() => void setAutoMerge(chosen, true, toast).then((ok) => ok && done())}>Auto-merge on{chosen.length ? ` (${chosen.length})` : ''}</Button>
            <Button size="sm" tone="neutral" icon="x" disabled={!chosen.length || busy} title="Every selected build waits for your Merge" onClick={() => void setAutoMerge(chosen, false, toast).then((ok) => ok && done())}>Auto-merge off{chosen.length ? ` (${chosen.length})` : ''}</Button>
          </>}
          {g === 'merged' && <Button size="sm" tone="neutral" icon="x" disabled={!chosen.length || busy} onClick={() => void dismiss(chosen, toast).then(done)}>Dismiss{chosen.length ? ` (${chosen.length})` : ''}</Button>}
        </div>
        <ul className="mb-list">{list.map((e) => <Item key={e.id} e={e} toast={toast} selected={sel.has(e.id)} onSelect={(on) => setSel((cur) => { const n = new Set(cur); if (on) n.add(e.id); else n.delete(e.id); return n; })} />)}</ul>
      </>}
    </section>
  );
}

export function MergeBanner() {
  const rt = useRuntime();
  const s = useBanner();
  const [open, setOpen] = useBannerLaunchOpen();
  useEffect(() => { start(); }, []);
  const d = s.data;
  if (!d || !d.total) return null; // every banner hides when it has nothing to show
  const toast: Toast = (text, tone) => rt.toast(text, tone, 'Merge banner');
  const c = d.counts;
  const lead = ORDER.filter((g) => c[g]).map((g) => `${c[g]} ${TITLE[g].toLowerCase().replace('?', '')}`).join(' · ');
  return (
    <div className={`mb-banner${c.blocked ? ' is-blocked' : c.ready ? ' is-ready' : ''}`} role="status" aria-live="polite">
      <div className="mb-banner__row">
        <BannerIcon className="mb-banner__icon" icon="branch" working={!!s.busy} />
        <button type="button" data-fx-row className="mb-banner__main" aria-expanded={open} onClick={() => setOpen(!open)}>
          <strong>{c.ready ? `${c.ready} build${c.ready === 1 ? '' : 's'} ready to merge` : c.ask ? `${c.ask} build${c.ask === 1 ? '' : 's'}: auto-merge?` : c.blocked ? `${c.blocked} blocked` : `${c.merged} merged`}</strong>
          <span className="fx-small fx-muted">{lead}</span>
        </button>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </div>
      {open && (
        <div className="mb-banner__body">
          {ORDER.map((g) => <Group key={g} g={g} list={d.groups[g]} toast={toast} />)}
          {s.error && <p className="fx-small oc-flag">{s.error}</p>}
        </div>
      )}
    </div>
  );
}
