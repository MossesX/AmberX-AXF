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
import { INSTANCE_LOOK_KEYS, instanceLookSettingsKey, instanceLookStyle, kindLookSettingsKey, type InstanceLookKind, type ResolvedInstanceLook } from '../core/engines/instance-look';
import { useAxfState, useRuntime } from './AxfProvider';
import { useControlTargets } from './controlTargets';

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
  // console-control@1: every look key of this instance is `setting:chrome.<kind>.<id>.look.<key>` (get = its own value,
  // set = a token / step, '' or skin drops it); the instance's root is what focus highlights
  const attr = kind === 'grid' ? 'data-axf-grid' : 'data-axf-tab-group';
  useControlTargets(id ? INSTANCE_LOOK_KEYS.map((k) => ({
    address: `setting:chrome.${kind}.${id}.look.${k.key}`, kind: 'setting' as const, label: `${k.label} (own look)`, detail: `${kind} ${id}`, keywords: ['look', k.key, kind],
    element: () => (typeof document === 'undefined' ? null : Array.from(document.querySelectorAll(`[${attr}]`)).find((el) => el.getAttribute(attr) === id) ?? null),
    get: () => rt.instanceLookRecord(kind, id)[k.key] ?? null,
    set: (v: unknown) => { try { rt.setInstanceLook(kind, id, k.key, v === null || v === undefined || v === '' || v === 'skin' ? null : String(v)); return undefined; } catch (e) { return (e as Error).message; } },
    state: () => { const r = rt.instanceLook(kind, id); return { value: r.look[k.key] ?? null, source: r.source[k.key] ?? null, followsSkin: r.followsSkin }; },
  })) : [], `look:${kind}:${id ?? ''}`);
  return instanceLookProps(rt.instanceLook(kind, id ?? ''));
}
