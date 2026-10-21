/* Fable rebuilds — the view, the report dialog and the small hooks shown in other views. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { pendingPost } from '@console/api';
import { call, getData, onData, opusNow, park, refresh, setFocus, takeFocus, type Rebuild } from './api';

const useData = () => useSyncExternalStore(onData, getData, getData);
const STATUS: Record<string, string> = { pending: 'Pending', unsafe: 'Unsafe', broken: 'Broken', failed: 'Failed', complete: 'Rebuilt' };
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

export function FableView() {
  const rt = useRuntime();
  const d = useData();
  const [filter, setFilter] = useState('open');
  const [open, setOpen] = useState<string>(() => takeFocus());
  const [err, setErr] = useState('');
  useEffect(() => { void refresh().then((x) => { if (!x) setErr('Couldn’t load the pending list.'); }); }, []);
  useEffect(() => onData(() => { const f = takeFocus(); if (f) setOpen(f); }), []);
  useEffect(() => { if (open) document.getElementById(`axp-fable-${open}`)?.scrollIntoView({ block: 'center' }); }, [open, d]);
  const items = useMemo(() => (d?.items ?? []).filter((i) => filter === 'all' || (filter === 'open' ? i.status !== 'complete' : i.status === filter)), [d, filter]);
  const copy = (r: Rebuild) => navigator.clipboard?.writeText(r.brief).then(() => rt.toast(`Brief for "${r.title}" copied — paste it into a Fable session`, 'success'), () => rt.toast('Clipboard blocked', 'warning'));
  const done = async (r: Rebuild) => {
    try {
      await pendingPost({ action: 'status', id: r.id, status: 'complete' });
      await refresh(); rt.toast(`${r.title}: marked rebuilt`, 'success');
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  const c = d?.counts ?? {};
  return (
    <div className="fx-page axp-fable">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">{(d?.items ?? []).length} on the list · {c.pending ?? 0} pending · {c.unsafe ?? 0} unsafe · {c.complete ?? 0} rebuilt</p>
          <h1>Fable rebuilds</h1>
          <p className="fx-muted">Builds parked until Fable runs them: what each replaces, its branch, report and screenshots, and a brief to paste into a Fable session.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void refresh()}>Refresh</Button>
          <Button icon="list" onClick={() => rt.navigate('pending')}>Pending builds</Button>
        </div>
      </header>
      {err && <p className="fx-small">{err}</p>}
      <div className="axp-fable__filters" role="tablist" aria-label="Status">
        {['open', 'pending', 'unsafe', 'complete', 'all'].map((f) => <button key={f} type="button" role="tab" aria-selected={filter === f} className={`fx-chip ${filter === f ? 'is-selected' : ''}`} onClick={() => setFilter(f)}>{f === 'open' ? 'Not rebuilt' : f === 'all' ? 'All' : STATUS[f]}</button>)}
      </div>
      {items.length === 0 ? <div className="fx-empty">{d ? 'Nothing here.' : 'Loading…'}</div> : (
        <ul className="axp-fable__list">
          {items.map((r) => {
            const isOpen = open === r.id;
            return (
              <li key={r.id} id={`axp-fable-${r.id}`} className={`axp-fable__row is-${r.status} ${isOpen ? 'is-open' : ''}`} data-fx-ctx-target="axf-pending-item" data-fx-ctx-payload={r.id}>
                <button type="button" className="axp-fable__hit" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : r.id)}>
                  <span className={`axp-fable__badge is-${r.status}`}>{STATUS[r.status] ?? r.status}</span>
                  <span className="axp-fable__main">
                    <span className="axp-fable__title">{r.title}</span>
                    <span className="axp-fable__meta">{r.id}{r.replaces ? ` · replaces ${r.replaces.name}` : ''}{r.planId ? ` · ${r.planId}` : ''} · {r.status === 'complete' && r.builtAt ? `rebuilt ${day(r.builtAt)}` : `parked ${day(r.createdAt)}`}</span>
                  </span>
                  <span className="axp-fable__flags">
                    {r.report && <Icon name="file" size={14} />}{r.android && <Icon name="smartphone" size={14} />}
                    <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                  </span>
                </button>
                {isOpen && (
                  <div className="axp-fable__body">
                    {r.detail && <p className="axp-fable__detail">{r.detail}</p>}
                    <dl className="axp-fable__kv">
                      <dt>Replaces</dt><dd>{r.replaces ? <>{r.replaces.name} <code>{r.replaces.uninstall}</code></> : 'nothing (new build)'}</dd>
                      <dt>Branch</dt><dd><code>{r.branch}</code> (Android before/after screenshots run when it’s pushed)</dd>
                      <dt>Report</dt><dd>{r.report ? 'written' : 'not yet'}{r.android ? ' · Android screenshots' : ''}</dd>
                      {r.log.length > 0 && <><dt>Log</dt><dd>{r.log.map((l, i) => <div key={i} className="fx-small fx-mono">{l}</div>)}</dd></>}
                      {r.notes.length > 0 && <><dt>Notes</dt><dd>{r.notes.map((n, i) => <div key={i} className="fx-small">{n.text}</div>)}</dd></>}
                    </dl>
                    <div className="fx-row fx-row--wrap">
                      <Button tone="primary" icon="copy" onClick={() => copy(r)}>Copy Fable brief</Button>
                      {r.report && <Button icon="file" onClick={() => rt.openDialog('fable-rebuilds.report', { id: r.id, title: r.title })}>Differences report</Button>}
                      {r.replaces && <Button icon="package" onClick={() => rt.dispatch(`plugin-manager.open:${r.replaces!.folder}`)}>Open {r.replaces.name}</Button>}
                      {r.status !== 'complete' && <Button icon="check" onClick={() => void done(r)}>Mark rebuilt</Button>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(d?.log.length ?? 0) > 0 && (
        <section className="fx-card axp-fable__logcard">
          <h3 style={{ marginTop: 0 }}>Rebuild log</h3>
          {d!.log.map((l, i) => <div key={i} className="fx-small fx-mono axp-fable__logline">{l}</div>)}
        </section>
      )}
    </div>
  );
}

export function ReportDialog({ id }: { id: string }) {
  const [r, setR] = useState<{ markdown: string; android: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call<{ markdown: string; android: string }>(`report/${encodeURIComponent(id)}`).then(setR, (e) => setErr((e as Error).message)); }, [id]);
  if (err) return <p className="fx-small">{err}</p>;
  if (!r) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <pre className="axp-fable__report">{r.markdown}</pre>
      {r.android && <><h3>Android screenshots</h3><pre className="axp-fable__report">{r.android}</pre></>}
    </div>
  );
}

/** Small hook shown on a Plan feature or a Pending builds row. */
export function FableChip({ rebuildId, park: parkBody, label }: { rebuildId?: string; park?: { plugin?: string; planId?: string; title?: string }; label?: string }) {
  const rt = useRuntime();
  const d = useData();
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const r = rebuildId ? d.items.find((x) => x.id === rebuildId) : undefined;
  if (r) {
    return (
      <button type="button" className={`axp-fable__chip is-${r.status}`} onClick={() => { setFocus(r.id); rt.navigate('fable-rebuilds'); }} title="Open in Fable rebuilds">
        <Icon name="sparkles" size={12} /> {label ?? 'Fable rebuild'}: {STATUS[r.status] ?? r.status}
      </button>
    );
  }
  if (!parkBody) return null;
  return (
    <button type="button" className="axp-fable__chip" disabled={busy} onClick={() => { setBusy(true); void park(parkBody).then((it) => { rt.toast(`Parked for Fable: ${it.title}`, 'success'); }, (e) => rt.toast((e as Error).message, 'danger')).finally(() => setBusy(false)); }}>
      <Icon name="sparkles" size={12} /> {busy ? 'Parking…' : 'Rebuild on Fable'}
    </button>
  );
}

/** Pending builds row: a Fable-waiting build, built on Opus now; the Fable rebuild is queued unless it already is. */
export function OpusNow({ id }: { id: string }) {
  const rt = useRuntime();
  const d = useData();
  const [busy, setBusy] = useState(false);
  const it = d?.items.find((x) => x.id === id);
  if (!it || it.isRebuild || it.status === 'complete') return null;
  const listed = it.rebuildListed;
  const go = () => {
    setBusy(true);
    void opusNow(id).then((r) => rt.toast(r.rebuildAdded ? `Now on Opus. Fable rebuild added (${r.rebuildId}).` : `Now on Opus. Fable rebuild ${r.rebuildId} was already listed.`, 'success'),
      (e) => rt.toast((e as Error).message, 'danger')).finally(() => setBusy(false));
  };
  return (
    <div className="fx-row fx-row--wrap">
      <Button tone="primary" icon="play" disabled={busy} onClick={go}>{busy ? 'Switching…' : listed ? 'Build on Opus' : 'Build on Opus now + Fable later'}</Button>
      <span className="fx-muted fx-small">{listed ? `Fable rebuild already listed (${listed})` : 'Adds a Fable rebuild to the pending list'}</span>
    </div>
  );
}
