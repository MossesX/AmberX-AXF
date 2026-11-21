/**
 * Approval rules (approval-rules@1, approval-rules.mjs) for VPS Configuration → Approval rules: one read, the staged
 * draft and the save, shared by the tab, the console-control targets and the `vps.approvals.*` actions. Same REST as
 * MCP (vps_approval_rules, vps_approval_rules_stage) and `axf gate approvals`.
 *
 * Reading and staging are open to every surface. Saving is not a command: the draft reaches axHub only from a real
 * click in Brett's own signed-in console (`saveApprovals` wants the trusted click), sent from this browser on his own
 * hub session. The console server, a session, MCP, the CLI and voice cannot write axHub's policy.
 * console-control@1 (registered at start, refreshed on every read): `setting:vps.approvals.<service>.rules | clearOwn`
 * and, per rule, `setting:vps.approvals.<service>.<n>.match | policy | vetoSeconds` (n from 1; a set stages the edit).
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { ownerFetch } from '@console/plugins';
import { FOLDER, showTab, type Answer } from './api';
import { lines, putRules, type ApprovalRules, type StageOp } from './approval-core.mjs';

export const OWNER_ONLY = 'Only Brett saves approval rules, with his own click in his signed-in console.';
export const RULE_FIELDS = ['match', 'policy', 'vetoSeconds'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

let cache: ApprovalRules | null = null;
const listeners = new Set<(v: ApprovalRules) => void>();
const keep = (v: ApprovalRules) => { cache = v; for (const l of listeners) l(v); return v; };
export const cachedApprovals = () => cache;
export function onApprovals(l: (v: ApprovalRules) => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

/** The read goes out on Brett's session first (so `canSave` is his), then with the console token like every other caller. */
async function call(path: string, init: RequestInit = {}): Promise<ApprovalRules> {
  const r = await ownerFetch(FOLDER, path, init);
  let j: ApprovalRules & Answer;
  try { j = (await r.json()) as ApprovalRules & Answer; } catch { throw new Error(r.status === 404 ? 'The VPS Configuration plugin is off or its server part is not running.' : `The console answered ${r.status}.`); }
  if (!j.ok) throw new Error(String(j.message || `The console answered ${r.status}.`));
  return j;
}
export async function loadApprovals(): Promise<ApprovalRules> { return keep(await call('approval-rules')); }
export async function stageApproval(op: StageOp): Promise<ApprovalRules> {
  return keep(await call('approval-rules/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) }));
}

/** A real click by the person at this screen: a console-control press (el.click()) or a scripted event is not one. */
export const ownClick = (e: { nativeEvent?: Event; isTrusted?: boolean } | undefined): boolean => !!e && (e.nativeEvent ? e.nativeEvent.isTrusted === true : e.isTrusted === true);

/**
 * Save the draft on axHub. Only from Brett's own click: `click` is the click event, and anything else (a remote press,
 * an action, a script) is refused before any request is made.
 */
export async function saveApprovals(click: { nativeEvent?: Event; isTrusted?: boolean } | undefined, reason?: string): Promise<ApprovalRules> {
  if (!ownClick(click)) throw new Error(OWNER_ONLY);
  const cur = await loadApprovals();
  if (!cur.canSave) throw new Error(`${OWNER_ONLY} Sign in to the console as Brett first.`);
  if (!cur.save) return cur;
  const r = await putRules(cur.hub, { ...cur.save, reason: reason || cur.save.reason });
  if (!r.ok) throw new Error(r.message || 'axHub refused.');
  return stageApproval({ op: 'discard' });
}

export const approvalsLine = (v: ApprovalRules) => lines(v).join(' ');

export function registerApprovals(rt: AxfRuntime): void {
  const T = 'Approval rules';
  const reg = controlRegistry(rt);
  const open = () => { rt.navigate('gate'); showTab('approvals'); };
  const keywords = ['vps configuration', 'approval rules', 'veto', 'countdown', 'hold', 'policy', 'axhub'];
  let offs: (() => void)[] = [];
  const stageOr = async (op: StageOp) => { await stageApproval(op); return undefined; };
  // the targets follow what axHub has: a service or a rule that appears gets its address on the next read
  onApprovals((v) => {
    for (const off of offs) off();
    offs = [];
    for (const s of v.services) {
      const base = `setting:vps.approvals.${s.service}`;
      const find = () => cache?.services.find((x) => x.service === s.service);
      offs.push(reg.register({
        address: `${base}.rules`, kind: 'setting', label: `Approval rules: ${s.displayName}`, detail: 'The ordered rules (match, policy, vetoSeconds). A set stages them; Brett saves.', keywords: [...keywords, s.service],
        get: () => find()?.rules.map(({ match, policy, vetoSeconds }) => ({ match, policy, vetoSeconds })) ?? null,
        set: (rules: unknown) => stageOr({ op: 'set', service: s.service, rules: rules as never }), open,
      }));
      offs.push(reg.register({
        address: `${base}.clearOwn`, kind: 'setting', label: `Approval rules: let the rules decide for ${s.displayName}`, detail: "On save, clear the tools' own entries so the rules decide. A set stages it; Brett saves.", keywords: [...keywords, s.service],
        get: () => find()?.clearOwn ?? null,
        set: (on: unknown) => stageOr({ op: 'clear-own', service: s.service, on: on === true || on === 'true' || on === 'on' }), open,
      }));
      s.rules.forEach((_, i) => {
        for (const f of RULE_FIELDS) {
          offs.push(reg.register({
            address: `${base}.${i + 1}.${f}`, kind: 'setting', label: `Approval rule ${i + 1} of ${s.displayName}: ${f === 'vetoSeconds' ? 'hold seconds' : f === 'policy' ? 'decision' : 'match'}`, keywords: [...keywords, s.service, f],
            get: () => find()?.rules[i]?.[f] ?? null,
            set: (value: unknown) => stageOr({ op: 'edit', service: s.service, index: i, rule: { [f]: value as string | number | null } }), open,
          }));
        }
      });
    }
  });
  void loadApprovals().catch(() => { /* the server part may be off: no targets until it answers */ });
  const told = (p: Promise<ApprovalRules>, done: (v: ApprovalRules) => string) => { void p.then((v) => rt.toast(done(v), 'success', T), (e: Error) => rt.toast(e.message, 'danger', T)); };
  const staged = 'Staged. Brett saves it from the Approval rules tab.';
  rt.actions.register('vps.approvals.open', open, { label: 'Open the approval rules', effect: 'navigate' });
  rt.actions.register('vps.approvals.status', () => {
    void loadApprovals().then((v) => rt.toast(approvalsLine(v), v.pending ? 'warning' : 'info', T), (e: Error) => rt.toast(e.message, 'danger', T));
  }, { label: 'What the approval rules are', effect: 'read' });
  rt.actions.register('vps.approvals.add', ([service = '', match = '', policy = '', seconds = '']) => {
    if (!service || !match || !policy) { rt.toast('Say a service, a match and a decision, for example vps.approvals.add:vps:run:veto:60.', 'warning', T); return; }
    told(stageApproval({ op: 'add', service, rule: { match, ...(policy === 'hold' ? {} : { policy }), ...(seconds ? { vetoSeconds: seconds } : {}) } }), () => `${service}: ${match} → ${policy}. ${staged}`);
  }, { label: 'Stage a new approval rule', params: true, effect: 'write' });
  rt.actions.register('vps.approvals.edit', ([service = '', n = '', field = '', value = '']) => {
    if (!service || !n || !(RULE_FIELDS as readonly string[]).includes(field)) { rt.toast('Say a service, a rule number, a field and a value, for example vps.approvals.edit:vps:1:vetoSeconds:30.', 'warning', T); return; }
    told(stageApproval({ op: 'edit', service, index: Number(n) - 1, rule: { [field]: value } }), () => `${service} rule ${n}: ${field} ${value || 'cleared'}. ${staged}`);
  }, { label: 'Stage a change to an approval rule', params: true, effect: 'write' });
  rt.actions.register('vps.approvals.remove', ([service = '', n = '']) => {
    if (!service || !n) { rt.toast('Say a service and a rule number, for example vps.approvals.remove:vps:2.', 'warning', T); return; }
    told(stageApproval({ op: 'remove', service, index: Number(n) - 1 }), () => `${service} rule ${n} removed in the draft. ${staged}`);
  }, { label: 'Stage removing an approval rule', params: true, effect: 'write' });
  rt.actions.register('vps.approvals.move', ([service = '', n = '', to = '']) => {
    if (!service || !n || !to) { rt.toast('Say a service, a rule number and its new place, for example vps.approvals.move:vps:3:1.', 'warning', T); return; }
    told(stageApproval({ op: 'move', service, index: Number(n) - 1, to: Number(to) - 1 }), () => `${service} rule ${n} moved to ${to} in the draft. ${staged}`);
  }, { label: 'Stage moving an approval rule', params: true, effect: 'write' });
  rt.actions.register('vps.approvals.clear-own', ([service = '', on = 'on']) => {
    if (!service) { rt.toast('Say a service, for example vps.approvals.clear-own:axf-console.', 'warning', T); return; }
    told(stageApproval({ op: 'clear-own', service, on: on !== 'off' }), () => `${service}: let the rules decide ${on !== 'off' ? 'on' : 'off'}. ${staged}`);
  }, { label: 'Stage letting the rules decide for a service', params: true, effect: 'write' });
  rt.actions.register('vps.approvals.discard', ([service = '']) => {
    told(stageApproval({ op: 'discard', ...(service ? { service } : {}) }), () => 'Draft dropped. axHub was never changed.');
  }, { label: 'Drop the approval rules draft', params: true, effect: 'write' });
}
