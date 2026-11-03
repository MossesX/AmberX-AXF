/**
 * lib-toolbars — the Toolbars plugin (Brett, Nov 3 2026, build toolbar-tap-confirm): one place that owns every toolbar in
 * the app, existing and future. Install it with the other libraries:
 *
 *   installLibraries(rt, [settingsLibrary, toolbarsLibrary, ...]);
 *
 * What it does today:
 *  - Settings → Plugins → Toolbars: tap-to-confirm on touch (on by default) and its arm window (3 s by default). The
 *    behaviour itself is the framework's (framework/react/tapConfirm.ts, installed by <AxfProvider>) and reads these
 *    keys, so it works the same with or without this library; the library is where a person changes them.
 *  - All toolbars: every toolbar on the current screen (any element with role="toolbar") with its settings id and its
 *    own tap-to-confirm override (inherit / on / off), stored per toolbar id. Overrides are settings, never code.
 *
 * Still to come in the same build (see _claude/builds/reports/toolbar-tap-confirm.md): per-toolbar look and layout
 * settings, the toolbar context-menu hooks (Toolbar settings / Edit toolbar / All toolbars), the Toolbar editor and
 * dropped hooks (hook@1 / drop-target@1).
 */
import { useEffect, useState } from 'react';
import type { AxfWebLibrary } from '../../react/library';
import { useAxfState, useRuntime } from '../../react/AxfProvider';
import { SelectField, Note } from '../../react/components/Forms';
import { Button } from '../../react/components/Controls';
import { TAP_ARM_DEFAULT_MS, TAP_ARM_RANGE, TAP_KEYS, TAP_OVERRIDES, tapConfig, type TapOverride } from '../../core/engines/tapconfirm';
import { toolbarElementId } from '../../react/tapConfirm';
import './toolbars.css';

export const TOOLBARS_ID = 'ai.amberx.axf.toolbars';
export const TOOLBARS_TAB = 'toolbars';
export const ALL_TOOLBARS_PANEL = 'toolbars.all';

/** The settings key of one toolbar's tap-to-confirm override. */
export const tapOverrideKey = (toolbarId: string) => `${TAP_KEYS.perToolbar}${toolbarId}.tapConfirm`;

export interface ToolbarOnScreen { id: string; label: string; offInCode: string | null; count: number }

/** Every toolbar on the page now, one row per settings id (several bars may share one id, e.g. a list of cards). */
export function toolbarsOnScreen(doc: Document = document): ToolbarOnScreen[] {
  const out = new Map<string, ToolbarOnScreen>();
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[role="toolbar"]'))) {
    if (el.closest('[data-axf-toolbars-panel]')) continue; // this panel's own preview rows
    const id = toolbarElementId(el);
    const hit = out.get(id);
    if (hit) { hit.count++; continue; }
    const off = el.dataset.axfTapConfirm === 'off' ? el.dataset.axfTapConfirmReason || 'switched off in code' : null;
    out.set(id, { id, label: el.getAttribute('aria-label') || id, offInCode: off, count: 1 });
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const OVERRIDE_LABEL: Record<TapOverride, string> = { inherit: 'As set for all toolbars', on: 'On for this toolbar', off: 'Off for this toolbar' };

function AllToolbarsPanel() {
  const rt = useRuntime();
  useAxfState();
  const [rows, setRows] = useState<ToolbarOnScreen[]>([]);
  const scan = () => setRows(toolbarsOnScreen());
  useEffect(() => { scan(); }, []);
  const get = (k: string) => rt.settings.get(k);
  return (
    <div className="fx-stack" data-axf-toolbars-panel="">
      <Note tone="info">Toolbars on the screen behind this one. Open a page, come back and press Refresh to see its toolbars. A toolbar's choice here beats the switch for all toolbars.</Note>
      <div className="fx-row"><Button size="sm" icon="refresh" onClick={scan}>Refresh</Button><span className="fx-small fx-muted">{rows.length} toolbar{rows.length === 1 ? '' : 's'}</span></div>
      {rows.map((r) => (
        <div key={r.id} className="axf-toolbars__row">
          <div className="axf-toolbars__name">
            <strong>{r.label}</strong>
            <span className="fx-small fx-muted">{r.id}{r.count > 1 ? ` · ${r.count} on screen` : ''} · tap-to-confirm {r.offInCode ? 'off' : tapConfig(get, r.id).enabled ? 'on' : 'off'}</span>
          </div>
          {r.offInCode
            ? <span className="fx-small fx-muted">Off in code: {r.offInCode}</span>
            : <SelectField label="Tap-to-confirm" className="axf-toolbars__pick" value={(get(tapOverrideKey(r.id)) as string) || 'inherit'}
                options={TAP_OVERRIDES.map((v) => ({ value: v, label: OVERRIDE_LABEL[v] }))}
                onChange={(v) => { if (v === 'inherit') rt.settings.clear(tapOverrideKey(r.id)); else rt.settings.set(tapOverrideKey(r.id), v); }} />}
        </div>
      ))}
    </div>
  );
}

export const toolbarsLibrary: AxfWebLibrary = {
  id: TOOLBARS_ID,
  label: 'Toolbars',
  version: '0.1.0',
  settingsTabs: [{ id: TOOLBARS_TAB, label: 'Toolbars', icon: 'layout', order: 40, parent: 'plugins', description: 'Every toolbar in this app: tap-to-confirm on touch, and each toolbar’s own choice.' }],
  settings: [{
    id: 'toolbars.tap', tab: TOOLBARS_TAB, label: 'Tap to confirm (touch)', icon: 'smartphone', order: 10,
    description: 'On a phone or any touch screen, the first tap on a toolbar button shows what it does and lights it up; a second tap runs it. A mouse, trackpad or pen clicks once, as usual.',
    settings: [
      { key: TAP_KEYS.enabled, label: 'Tap twice to run toolbar buttons on touch', kind: 'toggle', default: true, scope: 'device' },
      { key: TAP_KEYS.armMs, label: 'How long a button stays ready for the second tap (ms)', kind: 'slider', default: TAP_ARM_DEFAULT_MS, min: TAP_ARM_RANGE[0], max: TAP_ARM_RANGE[1], step: 500, scope: 'device' },
    ],
  }],
  settingsPanels: [{ id: ALL_TOOLBARS_PANEL, tab: TOOLBARS_TAB, title: 'All toolbars', icon: 'list', order: 20, render: () => <AllToolbarsPanel /> }],
};

export default toolbarsLibrary;
