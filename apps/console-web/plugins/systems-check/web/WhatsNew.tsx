/*
 * What's new banner: what changed since an admin last cleared it (commits on the console's clone, plugins added /
 * updated / removed), with a plain-English summary by Mosses when "Use AI for What's new" is on (saved, so it stays when
 * AI is off). The seen point lives on the server and is shared by every viewer; only an admin (console token or hub
 * admin) gets "Got it", which clears it for everyone. Everyone else sees the banner until an admin clears it.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Button, Icon, Markdown, useBannerLaunchOpen } from '@console/axf/react';
import * as api from '@console/api';
import { SourceBadge } from './SystemCheck';

interface Commit { sha: string; short: string; subject: string; author: string; at: number }
interface Plugin { folder: string; name: string; version: string }
interface Seen { sha: string; at: number; plugins: Record<string, string>; by?: string }
interface Resp { head: string; commits: Commit[]; truncated?: boolean; known: boolean; plugins: Plugin[]; banner: boolean; aiOn: boolean; seen?: Seen | null; canClear?: boolean; summary?: { text: string; agent?: string; cached?: boolean }; summaryError?: string; error?: string }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const headers = new Headers();
  const t = api.getToken();
  if (t) headers.set('authorization', `Bearer ${t}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const r = await fetch(`/api/plugins/systems-check/${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
  return j;
}

/* shared state: loaded once per console load */
interface State { data: Resp | null; seen: Seen | null; summarizing: boolean; dismissed: boolean }
let st: State = { data: null, seen: null, summarizing: false, dismissed: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useWN = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st, () => st);

export async function loadWhatsNew() {
  if (!api.isBackendUp()) return;
  try {
    const d = await call<Resp>('whats-new');
    const seen = d.seen ?? null;
    set({ data: d, seen });
    if (seen && d.known && d.commits.length) {
      set({ summarizing: d.aiOn });
      try { const s = await call<Resp>('whats-new?summary=1'); if (s.summary || s.summaryError) set({ data: { ...d, summary: s.summary, summaryError: s.summaryError } }); }
      catch { /* the commit list still shows */ }
      set({ summarizing: false });
    }
  } catch { /* plugin off or backend down: no banner */ }
}

function pluginChanges(d: Resp, seen: Seen) {
  const now = Object.fromEntries(d.plugins.map((p) => [p.folder, p]));
  const added = d.plugins.filter((p) => !(p.folder in seen.plugins));
  const updated = d.plugins.filter((p) => p.folder in seen.plugins && seen.plugins[p.folder] !== p.version);
  const removed = Object.keys(seen.plugins).filter((f) => !(f in now));
  return { added, updated, removed };
}

export function WhatsNewBanner() {
  const s = useWN();
  const [open, setOpen] = useBannerLaunchOpen(); // launches expanded unless its Banner settings say minimized
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  const d = s.data;
  const seen = s.seen;
  if (!d || !seen || s.dismissed || !d.banner || !d.head) return null;
  const pc = pluginChanges(d, seen);
  const nCommits = d.head === seen.sha ? 0 : d.commits.length;
  const nPlugins = pc.added.length + pc.updated.length + pc.removed.length;
  if (!nCommits && !nPlugins) return null;
  const markSeen = async () => {
    try { const r = await call<{ seen: Seen }>('whats-new/seen', { head: d.head }); set({ dismissed: true, seen: r.seen }); }
    catch (e) { set({ data: { ...d, summaryError: `Couldn't clear: ${(e as Error).message}` } }); }
  };
  const since = new Date(seen.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const bits = [nCommits ? `${nCommits}${d.truncated ? '+' : ''} change${nCommits === 1 ? '' : 's'}` : '', nPlugins ? `${nPlugins} plugin update${nPlugins === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  return (
    <div className="axp-systems-check-banner axp-systems-check-new" role="status">
      <div className="axp-systems-check-banner__row">
        <Icon name="sparkles" />
        <button type="button" data-fx-row className="axp-systems-check-banner__text" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="axp-systems-check-banner__title">What’s new</span>
          {d.summary?.text
            ? <SourceBadge ai title={`Made by AI: summary written by ${d.summary.agent ?? 'Mosses'}${d.summary.cached && !d.aiOn ? ' (saved earlier)' : ''}`} />
            : <SourceBadge ai={false} title="Not AI: straight from the commit history and plugin versions" />}
          <span className="axp-systems-check-banner__sum">{bits} since an admin last cleared it ({since}){d.known ? '' : ' (recent changes shown)'}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
        {d.canClear && <Button tone="primary" icon="check" onClick={() => void markSeen()} title="Clears it for everyone">Got it</Button>}
      </div>
      {open && (
        <div className="axp-systems-check-new__body">
          {s.summarizing && <p className="fx-small fx-muted">Mosses is writing a summary…</p>}
          {d.summary?.text && (
            <div className="axp-systems-check-new__summary">
              <Markdown compact text={d.summary.text} />
              <span className="fx-small fx-muted"><SourceBadge ai title="Made by AI" /> Summary by {d.summary.agent ?? 'Mosses'}{d.summary.cached && !d.aiOn ? ' (saved earlier; AI is off now)' : ''}</span>
            </div>
          )}
          {d.summaryError && <p className="fx-small fx-muted">No AI summary: {d.summaryError}</p>}
          {nPlugins > 0 && (
            <ul className="axp-systems-check-new__list">
              {pc.added.map((p) => <li key={`a${p.folder}`}><Icon name="plus" size={12} /> New plugin: <strong>{p.name}</strong> {p.version}</li>)}
              {pc.updated.map((p) => <li key={`u${p.folder}`}><Icon name="refresh" size={12} /> Updated: <strong>{p.name}</strong> {seen.plugins[p.folder]} → {p.version}</li>)}
              {pc.removed.map((f) => <li key={`r${f}`}><Icon name="minus" size={12} /> Removed: {f}</li>)}
            </ul>
          )}
          {nCommits > 0 && (
            <details open={!d.summary?.text}>
              <summary className="fx-small">{d.summary?.text ? 'Every change' : 'Changes'} ({nCommits}{d.truncated ? '+' : ''})</summary>
              <ul className="axp-systems-check-new__list">
                {d.commits.map((c) => (
                  <li key={c.sha}><span className="fx-mono fx-small fx-muted">{c.short}</span> {c.subject} <span className="fx-small fx-muted">· {new Date(c.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
