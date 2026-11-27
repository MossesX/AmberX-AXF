/**
 * Model triage (model-triage@1, framework/cli/model-triage.mjs on the VPS): one read and one write, shared by the Model
 * triage tab, the console-control targets (`setting:vps.modelTriage.…`, registered once the rules are read, so voice
 * and remote callers reach them with the tab closed) and the `vps.model-triage.*` actions. Same REST as MCP
 * (vps_model_triage, vps_model_triage_set) and `axf gate model-triage`. Nothing is decided or checked here: every
 * label, limit and rule comes from the VPS and every edit is sent to it as typed.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { gateCall, showTab } from './api';

export interface TriageField { key: string; kind: 'number' | 'list' | 'toggle'; label: string; hint: string; min?: number; max?: number }
export interface TriageRule { id: string; title: string; text: string; enabled: boolean; model: string; lanes: string[]; settings: Record<string, number | boolean | string[]> }
export interface TriageDecision { at: string; model: string; rule: string; why: string; lane: string; build?: string; step?: string; name?: string; title?: string; held?: boolean; wanted?: string; from?: string }
export interface TriageConfig { rev: number; at: string; by: string; enabled: boolean; defaults: { model: string; handRequest: string; briefWords: boolean }; rules: TriageRule[] }
export interface Triage {
  config: TriageConfig; path: string; stored: boolean; approvalRequired: boolean; buildPin: { model: string; by: string } | null; decisions: TriageDecision[];
  registry: { lanes: string[]; laneLabels: Record<string, string>; handRequest: string[]; models: { value: string; label: string }[]; fields: Record<string, TriageField[]> };
}
export type TriageEdit = { op: 'rule'; id: string; enabled?: boolean; model?: string; lanes?: string[]; settings?: Record<string, unknown> } | { op: 'move'; id: string; to: number }
  | { op: 'defaults'; model?: string; handRequest?: string; briefWords?: boolean } | { op: 'enabled'; enabled: boolean } | { op: 'reset' };

let cache: Triage | null = null;
const listeners = new Set<(t: Triage) => void>();
const keep = (t: Triage) => { cache = t; for (const l of listeners) l(t); return t; };
export const cachedTriage = () => cache;
export function onTriage(l: (t: Triage) => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export async function loadTriage(): Promise<Triage> { return keep(await gateCall<Triage>('model-triage')); }
/** Send one edit to the VPS, then read the gate again (the answer the tab draws is always the VPS's). */
export async function editTriage(edit: TriageEdit, reason = ''): Promise<Triage> {
  await gateCall('model-triage', 'POST', { ...edit, ...(reason ? { reason: { title: reason, description: '' } } : {}) });
  return loadTriage();
}
export const modelLabel = (t: Triage, value: string) => t.registry.models.find((m) => m.value === value.toLowerCase())?.label ?? value;
export const triageLine = (t: Triage) => `Model triage is ${t.config.enabled ? 'on' : 'off'}: ${t.config.rules.filter((r) => r.enabled).length} of ${t.config.rules.length} rules on, ${modelLabel(t, t.config.defaults.model)} when no rule matches.${t.approvalRequired ? ' Fable upgrades wait for Brett.' : ''}`;

let registered = false;
function registerTargets(rt: AxfRuntime, t: Triage): void {
  if (registered) return;
  registered = true;
  const reg = controlRegistry(rt);
  const open = () => { rt.navigate('gate'); showTab('model-triage'); };
  const keywords = ['vps configuration', 'model triage', 'fable', 'opus', 'model'];
  reg.register({ address: 'setting:vps.modelTriage.enabled', kind: 'setting', label: 'Model triage: gate on', detail: 'Off: every lane gets the default model; explicit overrides still win.', keywords,
    get: () => cache?.config.enabled ?? null, set: async (v: unknown) => (await editTriage({ op: 'enabled', enabled: v === true || v === 'true' || v === 'on' })).config.enabled, open });
  reg.register({ address: 'setting:vps.modelTriage.default', kind: 'setting', label: 'Model triage: model when no rule matches', detail: t.registry.models.map((m) => m.value).join(' or '), keywords,
    get: () => cache?.config.defaults.model ?? null, set: async (v: unknown) => (await editTriage({ op: 'defaults', model: String(v) })).config.defaults.model, open });
  reg.register({ address: 'setting:vps.modelTriage.handRequest', kind: 'setting', label: 'Model triage: a hand launch\'s own model', detail: t.registry.handRequest.join(', '), keywords,
    get: () => cache?.config.defaults.handRequest ?? null, set: async (v: unknown) => (await editTriage({ op: 'defaults', handRequest: String(v) })).config.defaults.handRequest, open });
  for (const r of t.config.rules) {
    const rule = () => cache?.config.rules.find((x) => x.id === r.id);
    reg.register({ address: `setting:vps.modelTriage.${r.id}.enabled`, kind: 'setting', label: `Model triage: ${r.title} on`, detail: r.text, keywords: [...keywords, r.id],
      get: () => rule()?.enabled ?? null, set: async (v: unknown) => (await editTriage({ op: 'rule', id: r.id, enabled: v === true || v === 'true' || v === 'on' })).config.rules.find((x) => x.id === r.id)?.enabled, open });
    reg.register({ address: `setting:vps.modelTriage.${r.id}.model`, kind: 'setting', label: `Model triage: ${r.title} model`, detail: r.text, keywords: [...keywords, r.id],
      get: () => rule()?.model ?? null, set: async (v: unknown) => (await editTriage({ op: 'rule', id: r.id, model: String(v) })).config.rules.find((x) => x.id === r.id)?.model, open });
    for (const f of t.registry.fields[r.id] ?? []) {
      reg.register({ address: `setting:vps.modelTriage.${r.id}.${f.key}`, kind: 'setting', label: `Model triage: ${r.title}, ${f.label.toLowerCase()}`, detail: f.hint, keywords: [...keywords, r.id, f.key],
        get: () => rule()?.settings[f.key] ?? null, set: async (v: unknown) => (await editTriage({ op: 'rule', id: r.id, settings: { [f.key]: v } })).config.rules.find((x) => x.id === r.id)?.settings[f.key], open });
    }
  }
}

export function registerModelTriage(rt: AxfRuntime): void {
  const T = 'Model triage';
  const open = () => { rt.navigate('gate'); showTab('model-triage'); };
  onTriage((t) => registerTargets(rt, t));
  void loadTriage().catch(() => { /* the server part may be off: the targets are registered on the first read */ });
  rt.actions.register('vps.model-triage.open', open, { label: 'Open model triage', effect: 'navigate' });
  rt.actions.register('vps.model-triage.status', () => {
    void loadTriage().then((t) => rt.toast(triageLine(t), 'info', T), (e: Error) => rt.toast(e.message, 'danger', T));
  }, { label: 'What the model triage rules are', effect: 'read' });
  rt.actions.register('vps.model-triage.rule', ([id = '', value = '']) => {
    if (!id || !['on', 'off'].includes(value)) { rt.toast('Say a rule and on or off, for example vps.model-triage.rule:size:off.', 'warning', T); return; }
    void editTriage({ op: 'rule', id, enabled: value === 'on' }).then(() => rt.toast(`Rule ${id} is ${value}.`, 'success', T), (e: Error) => rt.toast(e.message, 'danger', T));
  }, { label: 'Switch a model triage rule on or off', params: true, effect: 'write' });
  rt.actions.register('vps.model-triage.default', ([model = '']) => {
    void editTriage({ op: 'defaults', model }).then((t) => rt.toast(`${modelLabel(t, t.config.defaults.model)} when no rule matches.`, 'success', T), (e: Error) => rt.toast(e.message, 'danger', T));
  }, { label: 'Set the model for work no rule matched', params: true, effect: 'write' });
}
