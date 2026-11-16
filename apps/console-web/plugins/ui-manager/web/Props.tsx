/*
 * One element opened: every property and every token it reads (lib/core.mjs rows → ui-manager-rules propertyRows),
 * each changed only by choosing one of its predetermined values (asset ids, enum words, colour tokens, a range with
 * a step), never free text. Overridden rows are marked and reset to the skin / default value. Shown as the chosen view:
 * an expanding row under the element (default), a side panel, or a grid of cards.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, IconButton, Note, SelectField, Switch, useRuntime } from '@console/axf/react';
import type { PropRow, Scalar, UiElement } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { refreshLive } from './apply';
import { draftValue, dropPending, editDraft, getDraft, resetDraft, subscribeDraft } from './draft';
import { exportLibrary } from './bridge';
import { setUi, type UiState } from './state';
import { fetchJson } from './useElements';
import { queryProps } from '../lib/query.mjs';
import { PropFilters } from './Filters';

interface RowsAnswer { element?: UiElement; items?: PropRow[]; overrides?: number; error?: string }

const key = (v: Scalar) => JSON.stringify(v);
const SOURCE_LABEL: Record<PropRow['source'], string> = { override: 'changed here', skin: 'from the skin', asset: 'from the asset', default: 'default' };

export async function setProp(element: string, prop: string, value: Scalar): Promise<{ error?: string }> {
  const r = await fetchJson<{ error?: string }>('set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ element, prop, value }) });
  if (!r.error) { await refreshLive(); setUi((s) => ({ rev: s.rev + 1 })); }
  return r;
}
export async function resetProp(element: string, prop = ''): Promise<{ error?: string }> {
  const r = await fetchJson<{ error?: string }>('reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ element, ...(prop ? { prop } : {}) }) });
  if (!r.error) { await refreshLive(); setUi((s) => ({ rev: s.rev + 1 })); }
  return r;
}

/** The props of one element, searched / filtered / sorted by the property bar (web/Filters.tsx PropFilters). */
export const filterRows = (rows: PropRow[], ui: Pick<UiState, 'propQ' | 'propGroups' | 'propChanged'>): PropRow[] =>
  queryProps(rows, { q: ui.propQ, groups: ui.propGroups, changedOnly: ui.propChanged });

/** The window edits the draft (web/draft.ts): live at once, saved only by Apply. setProp / resetProp save directly (actions, voice). */
function Editor({ el, row }: { el: string; row: PropRow }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const run = async (v: Scalar) => { setBusy(true); const r = await editDraft(el, { ...row, source: row.source === 'asset' ? 'asset' : 'default' }, v); setBusy(false); if (r.error) rt.toast(r.error, 'warning'); };
  if (row.kind === 'bool') return <Switch label={row.label} hideLabel checked={row.value === true} disabled={busy} onChange={(v) => void run(v)} />;
  const options = row.options.map((o) => ({ value: key(o.value), label: o.label }));
  if (!options.some((o) => o.value === key(row.value))) options.unshift({ value: key(row.value), label: `${String(row.value)} (current)` });
  return <SelectField label={row.label} value={key(row.value)} options={options} disabled={busy} onChange={(v) => void run(JSON.parse(v) as Scalar)} />;
}

function Row({ el, row: saved }: { el: string; row: PropRow }) {
  const d = draftValue(el, saved.id, saved.value, saved.base);
  const row: PropRow = d.pending ? { ...saved, value: d.value, overridden: d.overridden ?? saved.overridden } : saved;
  const token = (row as { token?: string }).token;
  const swatch = row.kind === 'token' && typeof row.value === 'string' && row.value.startsWith('@') ? `--fx-${row.value.slice(1).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}` : token;
  return (
    <li className={`axp-uim__prop${row.overridden ? ' is-over' : ''}${d.pending ? ' is-pending' : ''}`} data-fx-row>
      <span className="axp-uim__propname">
        <span>{row.label} {d.pending ? <Chip tone="warning">pending</Chip> : row.overridden ? <Chip tone="accent">changed</Chip> : null}</span>
        <code className="fx-small axp-uim__muted">{token ?? row.id}</code>
        <span className="fx-small axp-uim__muted">{row.group} · {SOURCE_LABEL[row.source]}{row.overridden ? ` · was ${String(row.base)}` : ''}</span>
      </span>
      <span className="fx-row">
        {row.kind === 'token' && swatch ? <span className="axp-uim__swatch" style={{ background: `var(${swatch})` }} aria-hidden /> : null}
        <Editor el={el} row={row} />
      </span>
      {d.pending ? <IconButton icon="x" label={`Drop the pending change to ${row.label}`} onClick={() => void dropPending(el, row.id)} />
        : row.overridden ? <IconButton icon="undo" label={`Reset ${row.label}`} onClick={() => void resetDraft(el, row.id)} /> : <span />}
    </li>
  );
}

export function Props({ id, ui }: { id: string; ui: UiState }) {
  const rt = useRuntime();
  const [ans, setAns] = useState<RowsAnswer | null>(null);
  useSyncExternalStore(subscribeDraft, getDraft, getDraft); // pending values re-render the rows
  useEffect(() => { let live = true; setAns(null); fetchJson<RowsAnswer>(`element?id=${encodeURIComponent(id)}`).then((a) => live && setAns(a), () => live && setAns({ error: 'The UI Manager server part is not answering.' })); return () => { live = false; }; }, [id, ui.rev]);
  if (!ans) return <p className="fx-muted">Loading…</p>;
  if (ans.error) return <Note>{ans.error}</Note>;
  const rows = filterRows(ans.items ?? [], ui);
  return (
    <div className="axp-uim__expand" data-help="ui-manager.row">
      <div className="axp-uim__head">
        <span className="axp-uim__grow"><strong>{ans.element?.label}</strong> <code className="fx-small axp-uim__muted">{id}</code></span>
        <span className="fx-small axp-uim__muted">{rows.length} of {ans.items?.length ?? 0} properties · {ans.overrides ?? 0} changed</span>
        {ans.overrides ? <Button size="sm" tone="ghost" icon="undo" onClick={() => void resetDraft(id)}>Reset all</Button> : null}
        <Button size="sm" tone="ghost" icon="download" title="Export this element as an asset library: its asset with the changes written in, its token values and a manifest" onClick={() => void exportLibrary(rt, [id], { name: ans.element?.label ?? '' })}>Export</Button>
      </div>
      {(ans.items?.length ?? 0) > 6 ? <PropFilters ui={ui} /> : null}
      <ul className={ui.view === 'grid' ? 'axp-uim__grid' : 'axp-uim__props'}>{rows.map((r) => <Row key={r.id} el={id} row={r} />)}</ul>
    </div>
  );
}
