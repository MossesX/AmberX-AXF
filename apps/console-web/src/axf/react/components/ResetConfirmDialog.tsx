/**
 * ResetConfirmDialog (settings-reset@1, spec/PLUGIN-SETTINGS.md §4; Brett, Nov 17 2026: "Reset asks in a confirm dialog
 * with a switch to include assets and a scrollable table of changed assets.").
 *
 * The body of the framework dialog `RESET_CONFIRM_DIALOG` (DialogHost): the plan's one-line summary, the "Include assets"
 * switch (off by default), a scrollable table of everything the reset changes (the settings it clears, and the changed
 * assets, greyed and marked "kept" while the switch is off), and a role="toolbar" row with Reset (danger) and Cancel.
 * The plan comes from `planSettingsReset` (core/engines/settings-reset.ts) through the caller, so the dialog lists exactly
 * what the action does afterwards. Reset is disabled while the plan is empty.
 *
 * The table is the settings panel's changed-assets table (`ChangedAssetsTable`, a DataGrid in the settings library),
 * handed in through `setResetTableRenderer`, so framework/react never imports a library; without it the framework table
 * (.fx-table) draws the same rows.
 *
 *   address  dialog:settings-reset?scope=<console|plugin id> (console-control@1, data-axf-target on the root)
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from './Controls';
import { Switch } from './Forms';
import { SETTINGS_RESET_INCLUDE_ASSETS_DEFAULT, type ChangedAssetRow, type ResetPlan, type ResetSettingRow } from '../../core/engines/settings-reset';

/** Dialog id (props: `scope` = `console` or `plugin:<id>`). */
export const RESET_CONFIRM_DIALOG = 'axf.settings.reset';
/** console-control@1 address of the dialog for one scope. */
export const resetDialogTarget = (scope: string): string => `dialog:settings-reset?scope=${scope.replace(/^plugin:/, '')}`;

/** One table row: a setting the reset clears, or a changed asset (cleared only with the switch). */
export interface ResetTableRow {
  id: string;
  kind: 'setting' | ChangedAssetRow['kind'];
  /** Setting, Asset, Skin… */
  kindLabel: string;
  label: string;
  current: string;
  default: string;
  /** false = listed but kept (an asset while the switch is off) */
  cleared: boolean;
}

const show = (v: unknown): string => (v === null || v === undefined ? 'default' : typeof v === 'string' ? v : JSON.stringify(v));
const KIND_LABEL: Record<string, string> = {
  setting: 'Setting', slot: 'Asset', hidden: 'Hidden chrome', spacing: 'Spacing', skin: 'Skin', 'skin-override': 'Skin override',
  'scope-skin': 'Skin at a scope', 'scope-override': 'Override at a scope', 'plugin-look': 'Plugin look', 'look-setting': 'Look setting',
};

/** The plan as table rows: settings first, then the changed assets. */
export function resetTableRows(plan: ResetPlan): ResetTableRow[] {
  const settings = plan.settings.map((r: ResetSettingRow) => ({ id: `setting:${r.key}`, kind: 'setting' as const, kindLabel: KIND_LABEL.setting!, label: r.label ?? r.key, current: show(r.current), default: show(r.default), cleared: true }));
  const assets = plan.assets.map((r) => ({ id: `${r.kind}:${r.scope}:${r.type}`, kind: r.kind, kindLabel: KIND_LABEL[r.kind] ?? r.kind, label: r.label, current: r.current, default: r.default, cleared: plan.includeAssets }));
  return [...settings, ...assets];
}

/** Draws the changed-assets table (the settings library's DataGrid). */
export type ResetTableRenderer = (rows: ResetTableRow[], opts: { id: string; maxRows: number }) => ReactNode;
let tableRenderer: ResetTableRenderer | null = null;
export function setResetTableRenderer(r: ResetTableRenderer | null): void { tableRenderer = r; }

/** The framework table, when no library gives one. Scrolls past `maxRows` (the --axf-reset-rows custom property). */
function PlainTable({ rows }: { rows: ResetTableRow[] }) {
  return (
    <table className="fx-table">
      <thead><tr><th>What</th><th>Kind</th><th>Now</th><th>After reset</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.cleared ? '' : 'axf-reset__kept'} data-axf-reset-row={r.id}>
            <td>{r.label}</td><td>{r.kindLabel}</td><td>{r.current}</td><td>{r.cleared ? r.default : 'kept'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The changed-assets table on its own (the dialog's, and anywhere the plan should be listed). */
export function ResetPlanTable({ plan, id = 'settings-reset' }: { plan: ResetPlan; id?: string }) {
  const rows = useMemo(() => resetTableRows(plan), [plan]);
  if (!rows.length) return <p className="fx-muted axf-reset__empty">Nothing has changed here: there is nothing to reset.</p>;
  return (
    <div className="axf-reset__table" data-axf-reset-table={id} data-axf-reset-rows={rows.length} style={{ ['--axf-reset-rows' as string]: String(plan.tableRows) }} tabIndex={0} role="region" aria-label="What the reset changes">
      {tableRenderer ? tableRenderer(rows, { id, maxRows: plan.tableRows }) : <PlainTable rows={rows} />}
    </div>
  );
}

export interface ResetConfirmDialogProps {
  /** `console` or `plugin:<id>` */
  scope: string;
  /** what is reset, for the question ("the console", "Gate & rules") */
  name: string;
  /** the plan for the switch's position (planSettingsReset over the state now) */
  plan: (includeAssets: boolean) => ResetPlan;
  /** run the reset with the switch's position (the caller applies the same plan) */
  onReset: (includeAssets: boolean) => void;
  onCancel: () => void;
  /** start with the switch on (a caller that only resets assets) */
  includeAssets?: boolean;
}

export function ResetConfirmDialog({ scope, name, plan, onReset, onCancel, includeAssets }: ResetConfirmDialogProps) {
  const [assets, setAssets] = useState(includeAssets ?? SETTINGS_RESET_INCLUDE_ASSETS_DEFAULT);
  const p = useMemo(() => plan(assets), [plan, assets]);
  return (
    <div className="fx-stack axf-reset" data-axf-target={resetDialogTarget(scope)} data-axf-reset-scope={scope} data-axf-reset-assets={assets ? 'on' : 'off'}>
      <p className="axf-reset__question">Reset {name}’s settings to their defaults? <span className="fx-muted">{p.summary}.</span></p>
      <Switch label="Include assets" checked={assets} onChange={setAssets}
        hint={assets ? 'Changed assets and skins in this scope go back to their defaults too.' : 'Only settings are cleared; changed assets stay as they are.'} />
      <ResetPlanTable plan={p} id={`settings-reset.${scope}`} />
      <div className="fx-row axf-reset__actions" role="toolbar" aria-label="Reset settings">
        <Button tone="danger" icon="refresh" data-axf-destructive="" disabled={p.empty} onClick={() => onReset(assets)}>Reset</Button>
        <Button tone="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
