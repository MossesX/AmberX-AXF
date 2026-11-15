/**
 * The Open button of a shipped feature: opens the feature's screen, tab or setting in the live console (open.ts).
 * One shared component: every Shipped features grid row, the row context item and (through the `feature.open` slot)
 * the Gate's Pending features rows draw the same thing.
 *
 * Framework controls only (Button / IconButton, styled by the button asset); it sits in its own row toolbar
 * (role="toolbar" + aria-label). With no target it is disabled and says why (tooltip + aria-description): "not landed
 * yet", "no screen of its own", … console-control@1: the button registers itself as `button:open` under the row's
 * scope, so `view:shipped-features/grid:shipped-features/row:<id>/button:open` presses it (state reads disabled + label).
 *
 * Look (setting `shipped-features.openButton`, a UI Review choice, assets/settings/): `button` (the word),
 * `button-icon` (icon + word, the default) or `icon` (an icon button in the row toolbar).
 */
import { useEffect, useState } from 'react';
import { Button, IconButton, useRuntime } from '@console/axf/react';
import { openFeature, openTarget, type OpenTarget } from './open';

export const LOOK_KEY = 'shipped-features.openButton';
export const LOOKS = ['button', 'button-icon', 'icon'] as const;
export type OpenLook = (typeof LOOKS)[number];

function useLook(forced?: OpenLook): OpenLook {
  const rt = useRuntime();
  const read = () => { const v = rt.settings.get(LOOK_KEY); return (LOOKS as readonly unknown[]).includes(v) ? (v as OpenLook) : 'button-icon'; };
  const [look, setLook] = useState<OpenLook>(read);
  useEffect(() => rt.settings.onChange(LOOK_KEY, () => setLook(read())), [rt]); // eslint-disable-line react-hooks/exhaustive-deps
  return forced ?? look;
}

/** The target for one feature: given (the Gate hands it over), else read once from the batch. */
export function useOpenTarget(featureId: string, given?: OpenTarget | null): OpenTarget | null {
  const [t, setT] = useState<OpenTarget | null>(given ?? null);
  useEffect(() => {
    if (given) { setT(given); return undefined; }
    let on = true;
    void openTarget(featureId).then((r) => { if (on) setT(r); });
    return () => { on = false; };
  }, [featureId, given]);
  return t;
}

export interface FeatureOpenButtonProps {
  featureId: string;
  /** the feature's name (the toolbar's label and the toast) */
  name: string;
  /** a target already known (Gate rows); unset = read from the server */
  target?: OpenTarget | null;
  /** a reason that wins over the target (the Gate: "not landed yet" before the build lands) */
  blockedBy?: string;
  look?: OpenLook;
}

export function FeatureOpenButton({ featureId, name, target, blockedBy, look: forced }: FeatureOpenButtonProps) {
  const rt = useRuntime();
  const look = useLook(forced);
  const t = useOpenTarget(featureId, target);
  const [busy, setBusy] = useState(false);
  const reason = blockedBy || (t && !t.target ? t.reason || 'it has no screen' : '');
  const disabled = !t || !!reason;
  const tip = !t ? 'Finding where it opens…' : reason ? `Can't open: ${reason}` : `Open ${t.label ?? 'it'} in the app`;
  const press = async () => { setBusy(true); try { await openFeature(rt, featureId); } finally { setBusy(false); } };
  return (
    <span className="axp-shipped__rowbar" role="toolbar" aria-label={`${name}: actions`} title={tip} onClick={(e) => e.stopPropagation()}>
      {look === 'icon'
        ? <IconButton icon="external" label="Open" title={tip} disabled={disabled || busy} aria-description={reason || undefined} onClick={() => void press()} />
        : <Button size="sm" icon={look === 'button-icon' ? 'external' : undefined} title={tip} disabled={disabled} busy={busy} aria-description={reason || undefined} onClick={() => void press()}>Open</Button>}
    </span>
  );
}
