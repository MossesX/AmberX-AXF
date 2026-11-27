/**
 * Functions and buttons as console-control@1 targets (framework/spec/CONSOLE-CONTROL.md).
 *
 * Every action registered on the runtime right now is `function:<id>` (press = run it, `value` = its argument), and
 * every item of the console's toolbar, context-menu and app-menu assets is `button:<asset>.<item>` (press = its action).
 * Rules for remote callers:
 *   - a destructive one (effect `destructive`, or an id that deletes / resets) needs `confirm` (confirmation_required);
 *   - a deciding one (an approval, a veto: `personOnly`) is never pressed by a command (denied: Brett's own tap only).
 * The list follows the runtime: it re-syncs when actions come and go (plugins switch on / off).
 */
import type { AxfRuntime } from '../axf/core';
import { ConsoleControlError, CONSOLE_CONTROL_WIRE } from '../axf/core/engines/console-control';
import { controlRegistry, type ControlTargetDef } from '../axf/react';
import { inventory } from './inventory';

/** Same rules as scripts/control-inventory.mjs. */
export const DESTRUCTIVE_RE = /(^|[.:_-])(delete|remove|purge|wipe|reset|uninstall|drop|clear|discard|revoke|destroy|erase|kill|force-?push|hard-?delete)([.:_-]|$)/i;
export const DECIDING_RE = /(^|[.:_-])(approve|deny|reject|veto|shelve|decide|sign-?off)([.:_-]|$)/i;

interface InventoryButton { address: string; id: string; label: string; action: string; detail?: string; icon?: string; keywords?: string[]; destructive?: boolean; personOnly?: boolean }

const personOnlyError = (label: string) => new ConsoleControlError(CONSOLE_CONTROL_WIRE.DENIED, `${label} is a decision only Brett makes with his own tap`, { requires: 'person', personOnly: true });

/** Whether an action is destructive / deciding, from its meta and its id. */
export function actionRules(id: string, meta: { effect?: string; personOnly?: boolean }): { destructive: boolean; personOnly: boolean } {
  return { destructive: meta.effect === 'destructive' || DESTRUCTIVE_RE.test(id), personOnly: meta.personOnly === true || DECIDING_RE.test(id) };
}

function functionDef(rt: AxfRuntime, id: string, meta: { label: string; requires?: string; params?: boolean; effect?: string; personOnly?: boolean; module?: string }): ControlTargetDef {
  const r = actionRules(id, meta);
  return {
    address: `function:${id.replace(/%/g, '%25').replace(/\//g, '%2F')}`, kind: 'function', label: meta.label || id,
    detail: meta.module ? `Action · ${meta.module}` : 'Action', icon: 'zap', keywords: [id, ...id.split(/[.:-]/)],
    ...(meta.requires ? { requires: meta.requires } : {}), can: ['state', 'press'], ...(r.destructive ? { destructive: true } : {}),
    invoke: (value) => {
      if (r.personOnly) throw personOnlyError(meta.label || id);
      const spec = value === undefined || value === null || value === '' ? id : `${id}:${Array.isArray(value) ? value.join(':') : String(value)}`;
      if (!rt.dispatch(spec)) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, `${meta.label || id} did not run here (no handler, or this role cannot)`, { because: 'not run' });
      return true;
    },
    state: () => ({ action: id, ...(meta.params ? { takesArgument: true } : {}), ...(meta.effect ? { effect: meta.effect } : {}), ...(r.personOnly ? { personOnly: true } : {}) }),
  };
}

function buttonDef(rt: AxfRuntime, b: InventoryButton): ControlTargetDef {
  return {
    address: b.address, kind: 'button', label: b.label, detail: b.detail, icon: b.icon, keywords: b.keywords,
    can: ['state', 'press', 'open', 'focus'], ...(b.destructive ? { destructive: true } : {}),
    element: () => document.querySelector(`[data-axf-action="${CSS.escape(b.action)}"]`) ?? document.querySelector(`[aria-label="${CSS.escape(b.label)}"]`),
    invoke: () => {
      if (b.personOnly) throw personOnlyError(b.label);
      if (!rt.dispatch(b.action)) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, `${b.label} did not run here`, { because: 'not run' });
      return true;
    },
    state: () => ({ action: b.action }),
  };
}

/**
 * Keep `function:` targets in step with the action bus and register the asset buttons. Returns a remover.
 * `sync()` is exported through the returned handle so the executor can re-sync right before a command.
 */
export function installActionTargets(rt: AxfRuntime): { off: () => void; sync: () => void } {
  const reg = controlRegistry(rt);
  const owned = new Map<string, () => void>();
  let sig = '';
  const sync = () => {
    const list = rt.actions.list();
    const next = list.map((a) => a.id).sort().join('|');
    if (next === sig) return;
    sig = next;
    const want = new Set(list.map((a) => a.id));
    for (const [id, off] of owned) if (!want.has(id)) { off(); owned.delete(id); }
    for (const a of list) if (!owned.has(a.id)) owned.set(a.id, reg.register(functionDef(rt, a.id, a.meta)));
  };
  const buttons = ((inventory as unknown as { buttons?: InventoryButton[] }).buttons ?? []).map((b) => reg.register(buttonDef(rt, b)));
  sync();
  const timer = setInterval(sync, 4000);
  return { sync, off: () => { clearInterval(timer); for (const off of owned.values()) off(); owned.clear(); buttons.forEach((off) => off()); } };
}
