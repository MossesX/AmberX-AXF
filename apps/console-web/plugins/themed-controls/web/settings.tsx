/**
 * Settings → Plugins → Themed controls (themed-controls@1, spec/THEMED-CONTROLS.md → Settings). The switches are plain
 * settings groups (the settings library draws them with its level toolbar, and every one is a console-control
 * `setting:<key>` target): the master switch, the phone bottom sheet, one switch per family. The panel below says what
 * each family replaces and what is themed on this page right now.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Slider, useRuntime } from '@console/axf/react';
import type { SettingsGroup } from '@console/axf/core';
import { TC_KEYS, THEMED_FAMILIES, THEMED_FAMILY_LABELS, THEMED_FAMILY_NATIVE, activeFamilies, themedControlsConfig, type ThemedFamily } from '@console/axf/core/engines/themed-controls';
import { liveHost } from './host';
import { TOKEN_SETTINGS, setToken, tokenValue } from './tokens';

export const FOLDER = 'themed-controls';
export const TAB = 'themed-controls';

const FAMILY_HINT: Record<ThemedFamily, string> = {
  checkbox: 'Tick boxes drawn from the theme: Space ticks, the focus ring and colours are tokens.',
  radio: 'Round choices drawn from the theme: arrow keys move inside a group.',
  range: 'Sliders with a themed track, fill and thumb; arrow keys, Home and End move them.',
  number: 'Number fields with − and + buttons (hold to repeat), min, max and step kept.',
  datetime: 'A calendar and hour / minute columns instead of the browser picker; a bottom sheet on a phone.',
  color: 'Theme swatches, recent colours, a hue / saturation area and a hex field.',
  dialogs: 'Alert, confirm and prompt open as the app\'s own dialog instead of the browser box.',
  file: 'A drop zone: click to browse or drop files, with a file list and progress.',
  tooltip: 'Hover and focus tips drawn from the theme instead of the browser\'s title tip; long-press on touch.',
  scrollbar: 'Scrollbars coloured and sized from the theme on desktop; phones keep their own.',
};

/** The switches: master + sheet, then one per family (keys from the engine, never written here twice). */
export function settingsGroups(): SettingsGroup[] {
  return [
    {
      id: 'themed-controls.main', label: 'Themed controls', icon: 'sliders', tab: TAB, order: 1,
      description: 'Swap the controls the browser draws itself for themed ones. Off = every control is the browser\'s own again; nothing a form holds is lost.',
      settings: [
        { key: TC_KEYS.on, label: 'Themed controls', kind: 'toggle', default: true, description: 'The master switch. Off brings back every native control at once.' },
        { key: TC_KEYS.sheet, label: 'Bottom sheet on a phone', kind: 'toggle', default: true, description: 'Date, time and colour pickers and dialogs open as a bottom sheet on a phone-sized screen; off = a pop-over everywhere.' },
      ],
    },
    {
      id: 'themed-controls.families', label: 'Control families', icon: 'layers', tab: TAB, order: 2,
      description: 'One switch per kind of browser element. A family works only while the master switch is on.',
      settings: THEMED_FAMILIES.map((f) => ({ key: TC_KEYS.family(f), label: `Themed ${THEMED_FAMILY_LABELS[f].toLowerCase()}`, kind: 'toggle' as const, default: true, description: FAMILY_HINT[f] })),
    },
  ];
}

/** What each family replaces, and how many of each are themed on the page right now. */
export function FamiliesPanel() {
  const rt = useRuntime();
  const cfg = themedControlsConfig((k) => rt.settings.get(k));
  const active = new Set(activeFamilies(cfg));
  const [counts, setCounts] = useState<Record<string, number>>(() => liveHost()?.counts() ?? {});
  useEffect(() => {
    const t = globalThis.setInterval(() => setCounts(liveHost()?.counts() ?? {}), 1500);
    return () => globalThis.clearInterval(t);
  }, []);
  return (
    <div className="fx-stack" data-axf-target="panel:themed-controls.families">
      <p className="fx-small fx-muted">Each switch above replaces one browser element. Add <code>data-axf-native</code> to an element (or a form around it) to keep it native whatever the switches say.</p>
      <ul className="fx-stack fx-stack--sm axp-themed-controls__list">
        {THEMED_FAMILIES.map((f) => (
          <li key={f} className="fx-row fx-row--wrap">
            <strong>{THEMED_FAMILY_LABELS[f]}</strong>
            <span className="fx-small fx-muted"><code>{THEMED_FAMILY_NATIVE[f]}</code></span>
            <Chip tone={active.has(f) ? 'success' : undefined}>{active.has(f) ? `themed${counts[f] ? ` · ${counts[f]} here` : ''}` : 'native'}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tooltip and scrollbar timing and size (tokens of the themed-controls asset, the control@1 override store). */
export function TipScrollPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack" data-axf-target="panel:themed-controls.tokens">
      {TOKEN_SETTINGS.map((t) => (
        <Slider key={t.path} label={t.label} value={tokenValue(rt, t.path)} min={t.min} max={t.max} step={t.step} unit={` ${t.unit}`} onChange={(v) => setToken(rt, t.path, v)} />
      ))}
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="undo" onClick={() => { for (const t of TOKEN_SETTINGS) setToken(rt, t.path, null); }}>Back to the theme&apos;s values</Button>
      </div>
      <p className="fx-small fx-muted">These are tokens of the themed controls asset: <code>axf token controls set tooltip.delayMs 300</code> changes the same value.</p>
    </div>
  );
}
