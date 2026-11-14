/**
 * `console.control.*` console actions (console-control@1 by address, spec/CONSOLE-CONTROL.md): the verbs as actions on the
 * action bus, so menus, toolbars, search, control@1 (`console.actions run console.control.focus:<address>`), MCP
 * console_action, the CLI and voice reach them like any other action. Each runs through the executor and toasts its result.
 *
 *   console.control.open:<address>          bring it onto the screen
 *   console.control.focus:<address>         open it, scroll it into view and highlight it
 *   console.control.scroll:<dir>[:<amount>] scroll the active pane (up, down, page-up, page-down, top, bottom)
 *   console.control.search:<words>          search everything (the palette opens with the words when it is installed)
 *   console.control.state[:<address>]       where the console is, or one target's state
 *   console.control.press:<address>         press a button or run a function (a destructive one answers confirmation_required)
 *   console.control.set:<address>:<value>   set a setting, a tab row or a grid selection (the value is after the last colon)
 *   console.control.plugin:<plugin>:on|off  turn a plugin on or off
 * Any of them also takes a whole JSON command as its argument.
 */
import type { AxfRuntime } from '../axf/core';
import { describeAnswer, executeControl } from '../control/executor';

export const CONSOLE_CONTROL_ACTIONS = {
  open: { label: 'Console control: open a place by address (screen, tab, setting, row, step)', effect: 'navigate' },
  focus: { label: 'Console control: pull a place into focus by address (opens, scrolls to and highlights it)', effect: 'navigate' },
  scroll: { label: 'Console control: scroll the active pane (up, down, page-up, page-down, top, bottom)', effect: 'navigate' },
  search: { label: 'Console control: search screens, tabs, settings, buttons, plugins, help and loaded rows', effect: 'read' },
  state: { label: 'Console control: read where the console is, or one target\'s state', effect: 'read' },
  press: { label: 'Console control: press a button or run a function by address', effect: 'write' },
  set: { label: 'Console control: set a setting, tab or selection by address (address:value)', effect: 'write' },
  plugin: { label: 'Console control: turn a plugin on or off (plugin:on|off)', effect: 'write' },
} as const;

type Verb = keyof typeof CONSOLE_CONTROL_ACTIONS;

/** An action's arguments → the console-control command it is. */
export function actionCommand(verb: Verb, args: string[]): Record<string, unknown> | null {
  const text = args.join(':').trim();
  if (text.startsWith('{')) { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } }
  const lastColon = text.lastIndexOf(':');
  switch (verb) {
    case 'open': case 'focus': case 'press': return text ? { verb, address: text } : null;
    case 'state': return text ? { verb, address: text } : { verb };
    case 'search': return text ? { verb, query: { q: text } } : null;
    case 'scroll': { const [dir = 'down', amount] = args; return { verb, scroll: { dir, ...(amount && Number.isFinite(Number(amount)) ? { amount: Number(amount) } : {}) } }; }
    case 'set': return lastColon > 0 ? { verb, address: text.slice(0, lastColon), value: text.slice(lastColon + 1) } : null;
    case 'plugin': {
      if (lastColon <= 0) return null;
      const on = /^(on|true|enable|enabled|1)$/i.test(text.slice(lastColon + 1));
      const id = text.slice(0, lastColon);
      return { verb: on ? 'plugin.enable' : 'plugin.disable', address: id.startsWith('plugin:') ? id : `plugin:${id}` };
    }
    default: return null;
  }
}

/** Register every console.control.* action. Returns a remover. */
export function installConsoleControlActions(rt: AxfRuntime): () => void {
  const offs = (Object.keys(CONSOLE_CONTROL_ACTIONS) as Verb[]).map((verb) => rt.actions.register(`console.control.${verb}`, (args) => {
    const cmd = actionCommand(verb, args);
    if (!cmd) { rt.toast(`console.control.${verb} needs an argument`, 'warning', 'Console control'); return false; }
    // the search palette answers a bare search itself (it listens for this event)
    if (verb === 'search' && typeof window !== 'undefined' && !window.dispatchEvent(new CustomEvent('axf:console-control.search', { detail: { q: (cmd.query as { q: string }).q }, cancelable: true }))) return true;
    void executeControl(rt, { ...cmd, by: 'action' }).then((a) => rt.toast(describeAnswer(a), a.ok ? 'info' : 'warning', 'Console control'));
    return true;
  }, { label: CONSOLE_CONTROL_ACTIONS[verb].label, params: true, module: 'console.control', effect: CONSOLE_CONTROL_ACTIONS[verb].effect }));
  return () => offs.forEach((off) => off());
}
