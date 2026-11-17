/**
 * instance-look@1 in React (build own-look-per-grid-and-tab-group): one grid's / tab row's own look, live.
 *
 *   const look = useInstanceLook('tab-group', id);
 *   <div style={{ ...look.style }} {...look.attrs} />
 *
 * `style` = the scoped `--fx-inst-*` variables plus the family tokens bound to them (engines/instance-look.ts
 * instanceLookStyle); `attrs` = `data-fx-inst="<key> <key>"` listing the keys someone set, which the axf.css rules for the
 * kind read (a key nobody set emits nothing, so the skin cascade stands; no var() fallbacks). Re-renders on the app-wide
 * record, the instance record and any asset swap (a skin swap restyles every key the instance did not override).
 */
import { useEffect, useState } from 'react';
import { instanceLookSettingsKey, instanceLookStyle, kindLookSettingsKey, type InstanceLookKind, type ResolvedInstanceLook } from '../core/engines/instance-look';
import { useAxfState, useRuntime } from './AxfProvider';

export interface InstanceLookOut {
  resolved: ResolvedInstanceLook;
  style: Record<string, string>;
  attrs: { 'data-fx-inst'?: string };
}

/** The resolved look as root-element props (pure: what the hook returns, for hosts that already hold the resolution). */
export function instanceLookProps(resolved: ResolvedInstanceLook): InstanceLookOut {
  const keys = Object.keys(resolved.look);
  return { resolved, style: instanceLookStyle(resolved), attrs: keys.length ? { 'data-fx-inst': keys.join(' ') } : {} };
}

export function useInstanceLook(kind: InstanceLookKind, id: string | undefined): InstanceLookOut {
  const rt = useRuntime();
  useAxfState();
  const [, setTick] = useState(0);
  useEffect(() => {
    const keys = [kindLookSettingsKey(kind), ...(id ? [instanceLookSettingsKey(kind, id)] : [])];
    const offs = keys.map((k) => rt.settings.onChange(k, () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [rt, kind, id]);
  return instanceLookProps(rt.instanceLook(kind, id ?? ''));
}
