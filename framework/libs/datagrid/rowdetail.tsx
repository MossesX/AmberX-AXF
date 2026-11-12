/**
 * The expanded row (grid-row@1, rowkinds.ts): what the screen supplies, every field of the record, the Related links
 * (each opens in place as a card of the referenced record, or on its own screen) and the row commands as a toolbar.
 * DataGrid draws it under every expanded row; lists and logs that aren't a DataGrid draw `<RowDetail>` themselves and
 * `<RowCommandButtons>` on their rows.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, IconButton, useRuntime } from '../../react';
import type { RowRef } from './datasets';
import {
  commandsFor, encodeRowIds, fieldText, fieldsFor, noteRecord, recordFor, relatedFor, relatedLabel, rowCommandAction, rowKind, rowKindsRevision,
  runRowCommand, subscribeRowKinds, targetIds, type RelatedLink, type RowCommand,
} from './rowkinds';

export const useRowKindsRevision = () => useSyncExternalStore(subscribeRowKinds, rowKindsRevision, rowKindsRevision);

type Rt = ReturnType<typeof useRuntime>;
/** Run a command from the UI: destructive ones ask (the behaviour theme decides), the outcome is a toast. */
export async function runRowCommandFromUi(rt: Rt, kind: string, c: RowCommand, ids: string[], dataset?: string) {
  const ask = (q: string) => !rt.confirmDelete(false) || (globalThis.confirm?.(q) ?? true);
  const r = await runRowCommand(kind, c.id, ids, { dataset, ask });
  if (!r.ok && r.error !== 'Cancelled.') rt.toast(r.error ?? `${c.label} failed.`, 'danger', c.label);
  else if (r.skipped.length && r.ok) rt.toast(`${c.label}: skipped ${r.skipped.join(', ')} (doesn't apply).`, 'warning', c.label);
}

/** How a command is reached without the screen: the console action (control@1) and the server form when there is one. */
export function commandHint(kind: string, c: RowCommand, id: string): string {
  const act = `control_act console.actions ${rowCommandAction(kind, c.id)} {args:["${id}"]}`;
  return c.control ? `${act} · ${c.control.replace(/\{id\}/g, id)}` : act;
}

/** The row's command buttons (commands marked `button`), multi-select aware. */
export function RowCommandButtons({ rowRef, record, dataset, size }: { rowRef: RowRef | null | undefined; record?: unknown; dataset?: string; size?: number }) {
  useRowKindsRevision();
  const rt = useRuntime();
  if (!rowRef) return null;
  const rec = record ?? recordFor(rowRef.kind, rowRef.id);
  const cs = commandsFor(rowRef, rec, { buttons: true });
  if (!cs.length) return null;
  return (
    <span className="axf-grid-hooks">
      {cs.map((c) => {
        const ids = c.multi ? targetIds(rowRef, dataset) : [rowRef.id];
        return <IconButton key={c.id} icon={c.icon ?? 'zap'} size={size} label={ids.length > 1 ? `${c.label} (${ids.length})` : `${c.label}: ${rowRef.id}`} title={c.label}
          onClick={(e) => { e.stopPropagation(); void runRowCommandFromUi(rt, rowRef.kind, c, ids, dataset); }} />;
      })}
    </span>
  );
}

function Fields({ rowRef, record }: { rowRef: RowRef | null; record: unknown }) {
  const fs = fieldsFor(rowRef, record);
  if (!fs.length) return null;
  return (
    <dl className="axf-rowd-fields">
      {fs.map((f) => (
        <div key={f.id} className="axf-rowd-field">
          <dt className="axf-rowd-key">{f.label}</dt>
          <dd className="axf-rowd-val">{fieldText(f.id, f.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function RelatedCard({ link, depth, dataset }: { link: RelatedLink; depth: number; dataset?: string }) {
  useRowKindsRevision();
  const k = rowKind(link.kind);
  const [rec, setRec] = useState<unknown>(() => recordFor(link.kind, link.id));
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  useEffect(() => {
    if (rec !== undefined || !k?.load) return;
    let live = true; setState('loading');
    k.load(link.id).then((r) => { if (live) { setRec(r ?? null); setState('idle'); } }, () => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [link.kind, link.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = { kind: k?.kind ?? link.kind, id: link.id };
  return (
    <div className="axf-rowd-card" role="group" aria-label={`${k?.label ?? link.kind} ${link.id}`}>
      <div className="axf-rowd-cardhead">
        <strong>{k?.label ?? link.kind}</strong><span className="fx-mono">{relatedLabel(link)}</span>
        {k?.open && <Button size="sm" icon="external" onClick={() => k.open!(link.id)}>Open</Button>}
      </div>
      {state === 'loading' && <p className="axf-rowd-muted">Loading…</p>}
      {state === 'failed' && <p className="axf-rowd-muted">Couldn't load it.</p>}
      {rec === undefined && !k?.load && state === 'idle' && <p className="axf-rowd-muted">{k ? 'Not on screen right now.' : 'No screen shows this kind yet.'}{k?.open ? ' Open shows it.' : ''}</p>}
      {rec != null && <RowDetail rowRef={ref} record={rec} dataset={dataset} depth={depth} />}
    </div>
  );
}

function Related({ rowRef, record, depth, dataset }: { rowRef: RowRef | null; record: unknown; depth: number; dataset?: string }) {
  const links = relatedFor(rowRef, record);
  const [open, setOpen] = useState<string | null>(null);
  if (!links.length) return null;
  const key = (l: RelatedLink) => `${l.kind}:${l.id}`;
  const shown = links.find((l) => key(l) === open);
  return (
    <section className="axf-rowd-section" aria-label="Related">
      <h4 className="axf-rowd-title">Related</h4>
      <div className="axf-rowd-links">
        {links.map((l) => {
          const k = rowKind(l.kind);
          return (
            <button key={key(l)} type="button" className={`fx-chip axf-rowd-link ${open === key(l) ? 'is-open' : ''}`} aria-expanded={open === key(l)}
              title={l.note ? `${k?.label ?? l.kind} · ${l.note}` : k?.label ?? l.kind}
              onClick={(e) => { e.stopPropagation(); setOpen((o) => (o === key(l) ? null : key(l))); }}>
              <span className="axf-rowd-linkkind">{k?.label ?? l.kind}</span> {relatedLabel(l)}
            </button>
          );
        })}
      </div>
      {shown && depth < 2 && <RelatedCard link={shown} depth={depth + 1} dataset={dataset} />}
      {shown && depth >= 2 && rowKind(shown.kind)?.open && <Button size="sm" icon="external" onClick={() => rowKind(shown.kind)!.open!(shown.id)}>Open {relatedLabel(shown)}</Button>}
    </section>
  );
}

function Commands({ rowRef, record, dataset }: { rowRef: RowRef; record: unknown; dataset?: string }) {
  const rt = useRuntime();
  const cs = commandsFor(rowRef, record);
  if (!cs.length) return null;
  return (
    <section className="axf-rowd-section" aria-label="Commands">
      <h4 className="axf-rowd-title">Commands</h4>
      <div className="axf-rowd-cmds" role="toolbar" aria-label="Row commands">
        {cs.map((c) => {
          const ids = c.multi ? targetIds(rowRef, dataset) : [rowRef.id];
          return (
            <Button key={c.id} size="sm" icon={c.icon ?? 'zap'} tone={c.effect === 'destructive' ? 'danger' : 'neutral'} title={commandHint(rowRef.kind, c, encodeRowIds(ids))}
              onClick={(e) => { e.stopPropagation(); void runRowCommandFromUi(rt, rowRef.kind, c, ids, dataset); }}>
              {ids.length > 1 ? `${c.label} (${ids.length})` : c.label}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The expanded row: the screen's own detail (children), every field, Related, Commands. `depth` > 0 = a related card
 * (its own related links open one more level, no further).
 */
export function RowDetail({ rowRef, record, dataset, children, depth = 0, fields = true }: { rowRef: RowRef | null | undefined; record: unknown; dataset?: string; children?: ReactNode; depth?: number; fields?: boolean }) {
  useRowKindsRevision();
  const ref = rowRef ?? null;
  if (ref && record !== undefined) noteRecord(ref, record);
  return (
    <div className={`axf-rowd ${depth ? 'is-nested' : ''}`} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {children != null && <div className="axf-rowd-own">{children}</div>}
      {ref && <Commands rowRef={ref} record={record} dataset={dataset} />}
      <Related rowRef={ref} record={record} depth={depth} dataset={dataset} />
      {fields && (
        <details className="axf-rowd-section" open={children == null || depth > 0}>
          <summary className="axf-rowd-title">All fields</summary>
          <Fields rowRef={ref} record={record} />
        </details>
      )}
    </div>
  );
}

/**
 * For card lists and logs that aren't a DataGrid: a "Details" toggle that opens the same expanded row (every field,
 * Related, Commands) in place, plus the row's command buttons. Notes the record so commands and related cards find it.
 */
export function RowExpander({ rowRef, record, dataset, children, label = 'Details' }: { rowRef: RowRef; record: unknown; dataset?: string; children?: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  noteRecord(rowRef, record);
  return (
    <div className="axf-rowx">
      <div className="axf-rowx-bar">
        <Button size="sm" tone="quiet" icon={open ? 'chevron-up' : 'chevron-down'} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{label}</Button>
        <RowCommandButtons rowRef={rowRef} record={record} dataset={dataset} />
      </div>
      {open && <div className="axf-grid-detail axf-rowx-detail"><RowDetail rowRef={rowRef} record={record} dataset={dataset}>{children}</RowDetail></div>}
    </div>
  );
}

/** Expanded rows of a hand-built table or list (ids). */
export function useExpandedRows(initial: string[] = []) {
  const [ids, setIds] = useState<string[]>(initial);
  return { isOpen: (id: string) => ids.includes(id), toggle: (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])), ids };
}
/** The chevron that opens a table row's detail (and the row's command buttons beside it). */
export function RowToggle({ open, onToggle, rowRef, record, dataset }: { open: boolean; onToggle: () => void; rowRef?: RowRef; record?: unknown; dataset?: string }) {
  if (rowRef) noteRecord(rowRef, record);
  return (
    <span className="axf-grid-tail">
      {rowRef && <RowCommandButtons rowRef={rowRef} record={record} dataset={dataset} />}
      <IconButton icon={open ? 'chevron-up' : 'chevron-down'} label={open ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.stopPropagation(); onToggle(); }} />
    </span>
  );
}
/** A `<tr>` under a table row holding the expanded row (every field, Related, Commands, and the screen's own children). */
export function DetailTableRow({ colSpan, rowRef, record, dataset, children }: { colSpan: number; rowRef: RowRef; record: unknown; dataset?: string; children?: ReactNode }) {
  return (
    <tr className="axf-grid-tdetail">
      <td colSpan={colSpan}><div className="axf-grid-detail axf-rowx-detail"><RowDetail rowRef={rowRef} record={record} dataset={dataset}>{children}</RowDetail></div></td>
    </tr>
  );
}
