/**
 * Tap to confirm for one item (build add-a-tap-to-confirm-option-to-every-settings-in): the same choice the chrome
 * settings dialog offers (Behaviour → Tap to confirm), for a settings page of its own (a plugin's nav settings, a tab
 * group's page …). It edits the item's `tapConfirm` field (`axf.chrome.<kind>.<instance>`), so the dialog, this
 * control, the `tapconfirm.item` action and the tap itself all read one setting.
 */
import { useEffect, useState } from 'react';
import { CHROME_INSTANCE_KEY, CHROME_TAP_FIELD, CHROME_TAP_OPTIONS, normalizeInstanceOverride } from '../../core/engines/chrome-settings-rules.mjs';
import { TAP_KIND_LABELS, tapConfigFor, tapKindKey, type TapKind } from '../../core/engines/tapconfirm';
import { useRuntime } from '../AxfProvider';
import { setChromeField } from './ChromeContext';
import { SelectField } from './Forms';

const LABELS: Record<string, string> = { inherit: 'Same as all', on: 'On', off: 'Off' };

export function TapConfirmChoice({ kind, instance = 'app' }: { kind: TapKind; instance?: string }) {
  const rt = useRuntime();
  const key = CHROME_INSTANCE_KEY(kind, instance);
  const [, tick] = useState(0);
  useEffect(() => {
    const offs = [key, tapKindKey(kind)].map((k) => rt.settings.onChange(k, () => tick((n) => n + 1)));
    return () => offs.forEach((f) => f());
  }, [rt, key, kind]);
  const own = (normalizeInstanceOverride(kind, rt.settings.get(key)) as Record<string, unknown>)[CHROME_TAP_FIELD];
  const value = typeof own === 'string' ? own : 'inherit';
  const on = tapConfigFor((k) => rt.settings.get(k), kind, instance).enabled;
  return (
    <SelectField label="Tap to confirm (touch)" value={value}
      hint={`First tap shows what it is, second tap confirms. Now ${on ? 'on' : 'off'}${value === 'inherit' ? ` (same as all ${TAP_KIND_LABELS[kind].toLowerCase()})` : ''}.`}
      options={CHROME_TAP_OPTIONS.map((v) => ({ value: v, label: LABELS[v] ?? v }))}
      onChange={(v) => setChromeField(rt, kind, instance, CHROME_TAP_FIELD, v)} />
  );
}
