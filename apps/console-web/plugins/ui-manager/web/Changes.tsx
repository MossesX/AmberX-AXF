/*
 * Pending changes and the change log (step s12).
 *
 *   PendingBar   N pending · Discard · Apply…; Apply opens the exit summary (element, property / token, old -> new) and
 *                only Save writes it (one ui-change@1 entry). Discard, or closing the window, puts the saved look back.
 *   ChangeLog    every applied change set (GET changes), newest first, each with its own Undo (POST undo {id}).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Note, useRuntime } from '@console/axf/react';
import type { ChangeEntry } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { refreshLive } from './apply';
import { applyDraft, askApply, cancelApply, discardDraft, getDraft, subscribeDraft } from './draft';
import { setUi } from './state';
import { fetchJson } from './useElements';

export const useDraft = () => useSyncExternalStore(subscribeDraft, getDraft, getDraft);

export function PendingBar() {
  const rt = useRuntime();
  const d = useDraft();
  const n = d.summary.length;
  if (!d.draft) return null;
  const save = async () => {
    const r = await applyDraft();
    if (r.error) { rt.toast(r.error, 'warning', 'UI Manager'); return; }
    rt.toast(`Applied ${n} change(s). Undo it from the change log.`, 'success', 'UI Manager');
    setUi((s) => ({ rev: s.rev + 1 }));
  };
  return (
    <div className="axp-uim__pending" data-help="ui-manager.pending">
      <div className="axp-uim__bar" role="toolbar" aria-label="Pending changes">
        <Chip tone="warning">{n} pending</Chip>
        <span className="axp-uim__grow fx-small fx-muted">Shown live. Close without Apply and they are dropped.</span>
        <Button size="sm" tone="ghost" icon="x" disabled={d.busy} onClick={() => { void discardDraft(); setUi((s) => ({ rev: s.rev + 1 })); }}>Discard</Button>
        <Button size="sm" tone="primary" icon="check" disabled={d.busy || !n || d.errors.length > 0} onClick={askApply}>Apply…</Button>
      </div>
      {d.errors.length ? <Note>{d.errors.join(' · ')}</Note> : null}
      {d.confirming ? (
        <section className="axp-uim__summary" aria-label="Exit summary">
          <strong>Apply {n} change(s)?</strong>
          <ul className="axp-uim__props">
            {d.summary.map((l) => (
              <li key={`${l.element}|${l.prop}`} className="axp-uim__line">
                <span className="axp-uim__grow"><strong>{l.elementLabel}</strong> · {l.propLabel} <code className="fx-small axp-uim__muted">{l.prop}</code></span>
                <span className="fx-small"><span className="axp-uim__muted">{l.from}</span> → <strong>{l.to}</strong></span>
              </li>
            ))}
          </ul>
          <div className="axp-uim__bar" role="toolbar" aria-label="Confirm apply">
            <span className="axp-uim__grow" />
            <Button size="sm" tone="ghost" disabled={d.busy} onClick={cancelApply}>Back</Button>
            <Button size="sm" tone="primary" icon="check" disabled={d.busy} onClick={() => void save()}>Save {n} change(s)</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface ChangesAnswer { items?: ChangeEntry[]; total?: number; error?: string }

export function ChangeLog({ rev }: { rev: number }) {
  const rt = useRuntime();
  const [ans, setAns] = useState<ChangesAnswer | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { let live = true; fetchJson<ChangesAnswer>('changes?limit=50').then((a) => live && setAns(a), () => live && setAns({ error: 'The UI Manager server part is not answering.' })); return () => { live = false; }; }, [rev]);
  if (!ans) return <p className="fx-muted">Loading…</p>;
  if (ans.error) return <Note>{ans.error}</Note>;
  const items = ans.items ?? []; // newest first
  if (!items.length) return <p className="fx-muted">Nothing applied yet.</p>;
  const undo = async (id: string) => {
    setBusy(id);
    const r = await fetchJson<{ error?: string }>('undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, by: 'window' }) });
    setBusy('');
    if (r.error) { rt.toast(r.error, 'warning', 'UI Manager'); return; }
    await refreshLive();
    setUi((s) => ({ rev: s.rev + 1 }));
  };
  return (
    <ul className="axp-uim__props" aria-label="Change log" data-help="ui-manager.changes">
      {items.map((e) => (
        <li key={e.id} className="axp-uim__entry">
          <div className="axp-uim__head">
            <span className="axp-uim__grow fx-small"><strong>{e.changes.length} change(s)</strong> · {e.by} · {new Date(e.at).toLocaleString()} {e.undone ? <Chip>undone</Chip> : null}{e.undoes ? <Chip>undo</Chip> : null}</span>
            {!e.undone && !e.undoes ? <Button size="sm" tone="ghost" icon="undo" disabled={!!busy} onClick={() => void undo(e.id)}>Undo</Button> : null}
          </div>
          <ul className="axp-uim__list">
            {e.changes.map((c) => <li key={`${c.element}|${c.prop}`} className="fx-small"><code>{c.element}</code> · {c.prop}: <span className="axp-uim__muted">{c.from === undefined ? 'default' : String(c.from)}</span> → {c.to === undefined ? 'default' : String(c.to)}</li>)}
          </ul>
        </li>
      ))}
    </ul>
  );
}
