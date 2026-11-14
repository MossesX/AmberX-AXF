import { useEffect, useState } from 'react';
import { Button, Chip, SelectField, TextField, useRuntime } from '@console/axf/react';
import { api, fmtTime, type Res } from './ui-types';

/*
 * HR (hr.mjs): builder hire requests Brett approves or denies, and website training on an employee's profile.
 * REST /api/plugins/agent-swarm/hr/*, the same as plugin commands (MCP), `agent-job.mjs hire-*|train|knowledge|forget`
 * (CLI) and the hire notification (AmberX, deep link agent-swarm.hire-request:<id>).
 */

type HireRequest = { id: string; job: string; build: string; why: string; at: string; state: string; decidedBy: string; hired: string };
type Page = { id: string; url: string; title: string; chars: number; fetchedAt: string };
export const HIRE_EVENT = 'axf-swarm:hire-request';

/** Open builder hire requests with Approve / Deny (only Brett's own click decides: the server checks). */
export function HireRequests({ reload }: { reload?: () => void }) {
  const rt = useRuntime();
  const [list, setList] = useState<HireRequest[]>([]);
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => { try { const r = await api.call<Res<{ requests: HireRequest[] }>>('hr/hire-requests'); if (r.ok) setList(r.requests); } catch { /* the bar stays hidden */ } };
  useEffect(() => { void load(); const on = (e: Event) => { setFocus(String((e as CustomEvent).detail ?? '')); void load(); }; window.addEventListener(HIRE_EVENT, on); return () => window.removeEventListener(HIRE_EVENT, on); }, []);
  const decide = async (id: string, d: 'approve' | 'deny') => {
    setBusy(id);
    try {
      const r = await api.post<Res<{ agent?: { name: string }; assigned?: string }>>(`hr/hire-requests/${id}/${d}`, {});
      if (!r.ok) throw new Error(r.error);
      rt.toast(d === 'approve' ? `Hired ${r.agent?.name ?? 'a builder'}${r.assigned ? `; ${r.assigned} is theirs` : ''}` : 'Hire denied', d === 'approve' ? 'success' : 'info');
      await load(); reload?.();
    } catch (e) { rt.toast(String((e as Error).message), 'danger'); } finally { setBusy(''); }
  };
  const open = list.filter((r) => r.state === 'open');
  if (!open.length) return null;
  return (
    <section className="sw-roster sw-hire" aria-label="Hire requests">
      {open.map((r) => (
        <div key={r.id} className="sw-bar" data-focus={r.id === focus || undefined}>
          <b>Hire a new builder?</b>
          <span>{r.why}{r.build ? ` · waiting: ${r.build}` : ''} <span className="fx-muted">{fmtTime(r.at)}</span></span>
          <Button size="sm" tone="primary" icon="check" busy={busy === r.id} onClick={() => decide(r.id, 'approve')}>Approve</Button>
          <Button size="sm" tone="neutral" icon="x" busy={busy === r.id} onClick={() => decide(r.id, 'deny')}>Deny</Button>
        </div>
      ))}
    </section>
  );
}

const CRAWL = [0, 3, 5, 10, 20].map((n) => ({ value: String(n), label: n ? `This page + up to ${n} more on the site` : 'This page only' }));

/** Website training on an employee's profile: add a URL (or a site to crawl), see what is stored, remove it. */
export function TrainingSection({ agentId }: { agentId: string }) {
  const rt = useRuntime();
  const [pages, setPages] = useState<Page[]>([]);
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState('0');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const r = await api.call<Res<{ pages: Page[] }>>(`hr/knowledge/${agentId}`); if (r.ok) setPages(r.pages); } catch { setPages([]); } };
  useEffect(() => { void load(); }, [agentId]);
  const train = async () => {
    setBusy(true);
    try {
      const r = await api.post<Res<{ pages: Page[]; errors: string[]; total: number }>>(`hr/knowledge/${agentId}`, { url: url.trim(), crawl: Number(crawl) });
      if (!r.ok) throw new Error(r.error);
      rt.toast(`${r.pages.length} page(s) trained${r.errors.length ? `, ${r.errors.length} failed` : ''}`, r.errors.length ? 'warning' : 'success');
      setUrl(''); await load();
    } catch (e) { rt.toast(String((e as Error).message), 'danger'); } finally { setBusy(false); }
  };
  const forget = async (id: string) => {
    try { const r = await api.del<Res<{ total: number }>>(`hr/knowledge/${agentId}/${id}`); if (!r.ok) throw new Error(r.error); await load(); }
    catch (e) { rt.toast(String((e as Error).message), 'danger'); }
  };
  return (
    <section className="fx-stack sw-training" aria-label="Training">
      <h3 className="sw-wave">Training: website data</h3>
      <p className="fx-muted">Pages fetched here are stored as this employee&apos;s knowledge and go into their job briefs.</p>
      <div className="sw-bar" role="toolbar" aria-label="Train on a website">
        <TextField label="Page or site URL" value={url} onChange={setUrl} placeholder="https://…" type="url" />
        <SelectField label="Crawl" value={crawl} onChange={setCrawl} options={CRAWL} />
        <Button tone="primary" icon="download" busy={busy} disabled={!/^https?:\/\/\S+$/.test(url.trim())} onClick={train}>Train</Button>
      </div>
      {pages.length === 0 ? <p className="fx-muted">Not trained on any website yet.</p> : (
        <ul className="sw-feed">
          {pages.map((p) => (
            <li key={p.id}>
              <b>{p.title || p.url}</b> <span className="fx-muted">{p.url} · {p.chars.toLocaleString()} chars · {fmtTime(p.fetchedAt)}</span>
              <Button size="sm" tone="quiet" icon="trash" confirm={`Remove ${p.title || p.url} from this employee's training?`} onClick={() => forget(p.id)}>Remove</Button>
            </li>
          ))}
          <li><Button size="sm" tone="danger" icon="trash" confirm="Remove every trained page?" onClick={() => forget('all')}>Remove all</Button> <Chip>{pages.length} page(s)</Chip></li>
        </ul>
      )}
    </section>
  );
}
