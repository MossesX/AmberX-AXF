/**
 * lib-toolbars — the Toolbars plugin (Brett, Nov 3 2026, build toolbar-tap-confirm): one place that owns every toolbar in
 * the app, existing and future. Install it with the other libraries:
 *
 *   installLibraries(rt, [settingsLibrary, toolbarsLibrary, ...]);
 *
 * What it does today:
 *  - Settings → Plugins → Toolbars: tap-to-confirm on touch (follows label visibility by default: on where a toolbar,
 *    tab group, nav or menu bar shows icons only, off where it shows labels; or Always / Never) and its arm window (3 s by default). The
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
import { TAP_ARM_DEFAULT_MS, TAP_ARM_RANGE, TAP_KEYS, TAP_KINDS, TAP_KIND_LABELS, TAP_MODES, TAP_MODE_LABELS, TAP_OVERRIDES, tapConfig, tapKindKey, type TapOverride, type TapScope, type TapSource } from '../../core/engines/tapconfirm';
import { scopeOf, toolbarElementId } from '../../react/tapConfirm';
import './toolbars.css';

export const TOOLBARS_ID = 'ai.amberx.axf.toolbars';
export const TOOLBARS_TAB = 'toolbars';
export const ALL_TOOLBARS_PANEL = 'toolbars.all';

/** The settings key of one toolbar's tap-to-confirm override. */
export const tapOverrideKey = (toolbarId: string) => `${TAP_KEYS.perToolbar}${toolbarId}.tapConfirm`;

export interface ToolbarOnScreen { id: string; label: string; offInCode: string | null; count: number; scope: TapScope }

/** Every toolbar on the page now, one row per settings id (several bars may share one id, e.g. a list of cards). */
export function toolbarsOnScreen(doc: Document = document): ToolbarOnScreen[] {
  const out = new Map<string, ToolbarOnScreen>();
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[role="toolbar"]'))) {
    if (el.closest('[data-axf-toolbars-panel]')) continue; // this panel's own preview rows
    const id = toolbarElementId(el);
    const hit = out.get(id);
    if (hit) { hit.count++; continue; }
    const off = el.dataset.axfTapConfirm === 'off' ? el.dataset.axfTapConfirmReason || 'switched off in code' : null;
    out.set(id, { id, label: el.getAttribute('aria-label') || id, offInCode: off, count: 1, scope: scopeOf(el) });
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Arm windows offered in settings (stored as ms; tapArmMs clamps anything else to TAP_ARM_RANGE). */
const ARM_CHOICES = [1500, 2000, 3000, 4000, 5000, 7000, 10000].filter((ms) => ms >= TAP_ARM_RANGE[0] && ms <= TAP_ARM_RANGE[1]).map((ms) => ({ value: String(ms), label: `${ms / 1000} s${ms === TAP_ARM_DEFAULT_MS ? ' (default)' : ''}` }));

const OVERRIDE_LABEL: Record<TapOverride, string> = { inherit: 'Same as all', on: 'On', off: 'Off' };
const SOURCE_LABEL: Record<TapSource, string> = { toolbar: 'set here', instance: 'set in its settings', skin: 'set by the skin', global: 'set for all', labels: 'follows its labels' };

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
            <span className="fx-small fx-muted">{r.id}{r.count > 1 ? ` · ${r.count} on screen` : ''} · tap-to-confirm {r.offInCode ? 'off' : ((c) => `${c.enabled ? 'on' : 'off'} (${SOURCE_LABEL[c.source ?? 'labels']})`)(tapConfig(get, r.id, r.scope))}</span>
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
  settingsTabs: [{ id: TOOLBARS_TAB, label: 'Toolbars', icon: 'layout', order: 40, parent: 'plugins', description: 'Tap to confirm on touch for every toolbar, tab group, navigation and menu in this app (follows label visibility by default), and each toolbar’s own choice.' }],
  settings: [{
    id: 'toolbars.tap', tab: TOOLBARS_TAB, label: 'Tap to confirm (touch)', icon: 'smartphone', order: 10,
    description: 'On a phone or any touch screen, the first tap on a toolbar button, tab, navigation or menu item shows what it is and lights it up; a second tap confirms it. A mouse, trackpad or pen clicks once, as usual. Each one can choose for itself in its own settings (right-click or long-press it → Settings → Behaviour).',
    settings: [
      ...TAP_KINDS.map((kind) => ({ key: tapKindKey(kind), label: `Tap twice on touch: ${TAP_KIND_LABELS[kind].toLowerCase()}`, description: 'Follow labels: on where it shows icons only, off where it shows labels. Each one can still be set on or off in its own settings.', kind: 'choice' as const, default: 'labels', options: TAP_MODES.map((m) => ({ value: m, label: TAP_MODE_LABELS[m] })), scope: 'device' as const })),
      { key: TAP_KEYS.armMs, label: 'Ready for the second tap', description: 'How long an item stays lit after the first tap.', kind: 'choice', default: String(TAP_ARM_DEFAULT_MS), options: ARM_CHOICES, scope: 'device' },
    ],
  }],
  settingsPanels: [{ id: ALL_TOOLBARS_PANEL, tab: TOOLBARS_TAB, title: 'All toolbars', icon: 'list', order: 20, render: () => <AllToolbarsPanel /> }],
};

export default toolbarsLibrary;
