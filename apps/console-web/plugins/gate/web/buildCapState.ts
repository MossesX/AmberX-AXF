/**
 * The build cap (build-cap@1, build-cap.mjs): one read and one write, shared by the Build cap tab, the console-control
 * targets (`setting:vps.buildCap.<key>`, registered at start so voice and remote callers reach them with the tab
 * closed) and the `vps.build-cap.*` actions. Same REST as MCP (vps_build_cap, vps_build_cap_set) and `axf gate build-cap`.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { gateCall, showTab } from './api';

export type CapKey = 'maxBuilds' | 'emergencySlots' | 'stepsInParallel';
export interface BuildCap {
  hardCap: number | null; live: number | null; free: number | null; emergencySlots: number | null; emergencyLive: number | null;
  stepsInParallel: number | null; effective: number | null; note: string; setBy: string; setAt: string; canEdit: boolean;
  ranges: Record<CapKey, [number, number]>; ownerOnly: CapKey[];
}
export const CAP_FIELDS: { key: CapKey; label: string; hint: string; read: (c: BuildCap) => number | null }[] = [
  { key: 'maxBuilds', label: 'Builds at once', hint: 'The most builds the VPS ever runs at once. The same setting as Settings → Plugins → Agent cap.', read: (c) => c.hardCap },
  { key: 'emergencySlots', label: 'Emergency slots', hint: 'Extra places only an emergency build may take, counted apart from Builds at once.', read: (c) => c.emergencySlots },
  { key: 'stepsInParallel', label: 'Steps in parallel', hint: 'How many steps of one build the orchestrator sends at once.', read: (c) => c.stepsInParallel },
];
export const OWNER_ONLY = 'Only Brett changes this, from his own signed-in console.';

let cache: BuildCap | null = null;
const listeners = new Set<(c: BuildCap) => void>();
const keep = (c: BuildCap) => { cache = c; for (const l of listeners) l(c); return c; };
export const cachedBuildCap = () => cache;
export function onBuildCap(l: (c: BuildCap) => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export async function loadBuildCap(): Promise<BuildCap> { return keep(await gateCall<BuildCap>('build-cap')); }
export async function saveBuildCap(patch: Partial<Record<CapKey, number>>): Promise<BuildCap> { return keep(await gateCall<BuildCap>('build-cap', 'POST', patch)); }
export const capLine = (c: BuildCap) => `Builds at once ${c.hardCap} (${c.live ?? '?'} running), emergency slots ${c.emergencySlots}, steps in parallel ${c.stepsInParallel}.${c.note ? ` ${c.note}` : ''}`;

export function registerBuildCap(rt: AxfRuntime): void {
  const T = 'Build cap';
  const reg = controlRegistry(rt);
  const open = () => { rt.navigate('gate'); showTab('build-cap'); };
  for (const f of CAP_FIELDS) {
    reg.register({
      address: `setting:vps.buildCap.${f.key}`, kind: 'setting', label: `Build cap: ${f.label.toLowerCase()}`, detail: f.hint,
      keywords: ['vps configuration', 'build cap', 'slots', 'parallel', f.key],
      get: () => (cache ? f.read(cache) : null),
      set: async (v: unknown) => f.read(await saveBuildCap({ [f.key]: Number(v) })),
      open,
    });
  }
  void loadBuildCap().catch(() => { /* the server part may be off: the targets answer null */ });
  rt.actions.register('vps.build-cap.open', open, { label: 'Open the build cap', effect: 'navigate' });
  rt.actions.register('vps.build-cap.status', () => {
    void loadBuildCap().then((c) => rt.toast(capLine(c), c.note ? 'warning' : 'info', T), (e: Error) => rt.toast(e.message, 'danger', T));
  }, { label: 'What the build cap is', effect: 'read' });
  rt.actions.register('vps.build-cap.set', ([key = '', value = '']) => {
    const f = CAP_FIELDS.find((x) => x.key === key);
    if (!f || !value) { rt.toast(`Say a setting and a number, for example vps.build-cap.set:stepsInParallel:4 (${CAP_FIELDS.map((x) => x.key).join(', ')}).`, 'warning', T); return; }
    void saveBuildCap({ [f.key]: Number(value) }).then((c) => rt.toast(`${f.label}: ${String(f.read(c))}.${c.note ? ` ${c.note}` : ''}`, 'success', T), (e: Error) => rt.toast(e.message, 'danger', T));
  }, { label: 'Change the build cap', params: true, effect: 'write' });
}
