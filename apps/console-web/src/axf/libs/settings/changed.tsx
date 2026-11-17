/**
 * The changed-assets table (settings-reset@1): one DataGrid (lib-datagrid) for the rows `planSettingsReset` /
 * `changedAssets` give, used by the settings panel (Settings → Appearance → Changed here) and by the reset confirm dialog
 * (framework/react ResetConfirmDialog, through setResetTableRenderer). Rows the reset keeps (assets while the switch is
 * off) get the muted status edge and say "kept".
 *
 * `resetStateOf(rt)` gathers the engine's input from the runtime (saved values, registered tabs and groups, the app-look
 * document, slot picks and asset names), so every Reset in the app plans from the same state.
 */
import { useMemo } from 'react';
import { DataGrid, type GridColumn } from '../datagrid';
import { resetTableRows, type ResetTableRow } from '../../react/components/ResetConfirmDialog';
import { changedAssets, isLookKey, type AppLookLike, type ResetState } from '../../core/engines/settings-reset';
import { ASSET_TYPES, type AssetType, type AxfRuntime } from '../../core';

const COLUMNS: GridColumn<ResetTableRow>[] = [
  { id: 'label', label: 'What', width: 'minmax(calc(var(--fx-space) * 14), 3fr)', fixed: true, render: (r) => <span data-axf-reset-row={r.id} {...(r.cleared ? {} : { 'data-axf-reset-kept': '' })}>{r.label}</span> },
  { id: 'kind', label: 'Kind', width: 'minmax(calc(var(--fx-space) * 9), 1fr)', render: (r) => r.kindLabel },
  { id: 'current', label: 'Now', width: 'minmax(calc(var(--fx-space) * 9), 2fr)', render: (r) => r.current },
  { id: 'default', label: 'After reset', width: 'minmax(calc(var(--fx-space) * 9), 2fr)', render: (r) => (r.cleared ? r.default : 'kept') },
];

/** The table: every row in one group, no column menu, no drag; the caller's element scrolls it. */
export function ChangedAssetsTable({ rows, id }: { rows: ResetTableRow[]; id: string }) {
  const groups = useMemo(() => [{ id: 'changes', title: 'Changes', rows, groups: [], fixed: true }], [rows]);
  return (
    <DataGrid<ResetTableRow> id={id} label="Changed settings and assets" groups={groups} columns={COLUMNS} rowId={(r) => r.id} rowLabel={(r) => r.label}
      hidden={[]} rowTone={(r) => (r.cleared ? (r.kind === 'setting' ? 'accent' : 'warning') : 'muted')} compact dataset={false} />
  );
}

/** The engine's input, from the runtime now. */
export function resetStateOf(rt: AxfRuntime): ResetState {
  const tabs = rt.settings.listTabs();
  const seen = new Set<string>();
  const groups = tabs.flatMap((t) => rt.settings.groupsIn(t.id)).filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  const active: Record<string, string> = {};
  const defaults: Record<string, string> = {};
  const slots = rt.manifest.defaults as Record<string, string | undefined>;
  for (const t of ASSET_TYPES) {
    const a = rt.assetOrNull(t as AssetType);
    if (a) active[t] = a.id;
    const d = slots[t]; if (typeof d === 'string') defaults[t] = d;
  }
  const look = rt.appLook() as unknown as AppLookLike | null;
  const registered = new Set(groups.flatMap((g) => g.settings.filter((x) => x.kind !== 'action' && x.kind !== 'secret').map((x) => x.key)));
  return {
    // only what a person set: registered settings and look / asset keys. Unregistered keys are a module's own bookkeeping
    // (migration markers, the last reset's undo record) and a reset never clears them.
    values: Object.fromEntries(Object.entries(rt.settings.savedValues()).filter(([k]) => registered.has(k) || isLookKey(k))), tabs, groups, look, active, defaults,
    nameOf: (type, id) => rt.registry.list(type as AssetType).find((a) => a.id === id)?.name,
  };
}

/** Every changed asset in the app now, as table rows (the settings panel's list). */
export function changedAssetRows(rt: AxfRuntime): ResetTableRow[] {
  const rows = changedAssets(resetStateOf(rt));
  return resetTableRows({ contract: 'settings-reset@1', scope: { kind: 'console' }, includeAssets: true, settings: [], assets: rows, apply: { clear: [], look: null, scopes: [] }, empty: !rows.length, summary: '', tableRows: 8 });
}
