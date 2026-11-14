/**
 * The plugin's console actions and control targets (themed-controls@1 → API). Every action is also a console-control
 * `function:<id>` target, so REST (/api/console-control), MCP (console_action), the CLI (`axf console action …`) and
 * voice reach it; the server's routes push to these when a console is open.
 *
 *   themed-controls.open                         Settings → Plugins → Themed controls (the deep link)
 *   themed-controls.toggle[:on|off]              master switch (no argument = flip)
 *   themed-controls.family:<family>:on|off       one family
 *   themed-controls.sheet:on|off                 bottom sheet on a phone
 *   themed-controls.state                        say what is on (toast); the full state is `panel:themed-controls`
 *   themed-controls.set:<ref>:<value>            set one themed control (ref = element id, name or label words)
 *   themed-controls.get:<ref>                    say one themed control's value (toast); `setting:field.<ref>` reads it
 *   themed-controls.open:[<family>:]<ref>        open the picker of a date / time / colour control (the deep link)
 *   themed-controls.close[:<ref>]                close the open picker (or that control's)
 *   themed-controls.pick:<value>                 set the open picker's control and close it
 *   themed-controls.answer:ok|cancel[:<text>]    answer the open themed alert / confirm / prompt (OK on a destructive
 *                                                confirm is refused here: press button:themed-controls.dialog.ok with confirm)
 * The open dialog: `panel:themed-controls.dialogs` (state: open dialog + waiting; set: the prompt's text),
 * `button:themed-controls.dialog.ok` (press, value = prompt text; destructive while the open confirm is) and
 * `button:themed-controls.dialog.cancel`.
 * Pop-up families are also targets `panel:themed-controls.<family>`: open (the first such control, or `value` = ref),
 * state (the open picker: ref, value, view), set (value, or `<ref>=<value>`), press ok | cancel.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { ConsoleControlError, CONSOLE_CONTROL_WIRE } from '@console/axf/core/engines/console-control';
import { TC_KEYS, THEMED_FAMILIES, THEMED_FAMILY_LABELS, activeFamilies, isThemedFamily, themedControlsConfig, type ThemedFamily } from '@console/axf/core/engines/themed-controls';
import { TAB } from './settings';
import { liveHost, type SwapRecord } from './host';

const ON = /^(on|true|1|yes|enable|enabled)$/i;
const OFF = /^(off|false|0|no|disable|disabled)$/i;
/** on / off / flip from an action argument. */
export function switchArg(arg: string | undefined, current: boolean): boolean {
  if (arg && ON.test(arg)) return true;
  if (arg && OFF.test(arg)) return false;
  return !current;
}

/** Find a family from its id or words ("checkboxes", "date pickers"). */
export function familyFrom(words: string | undefined): ThemedFamily | null {
  const w = String(words ?? '').trim().toLowerCase();
  if (!w) return null;
  if (isThemedFamily(w)) return w;
  return THEMED_FAMILIES.find((f) => THEMED_FAMILY_LABELS[f].toLowerCase().includes(w) || w.includes(f) || (f === 'datetime' && /date|time|calendar/.test(w)) || (f === 'color' && /colou?r/.test(w)) || (f === 'dialogs' && /alert|confirm|prompt|dialog/.test(w)) || (f === 'range' && /slider/.test(w))) ?? null;
}

export function stateOf(rt: AxfRuntime): Record<string, unknown> {
  const cfg = themedControlsConfig((k) => rt.settings.get(k));
  return { on: cfg.on, sheet: cfg.sheet, families: cfg.families, active: activeFamilies(cfg), live: liveHost()?.report() ?? null };
}

export function sayState(rt: AxfRuntime): string {
  const cfg = themedControlsConfig((k) => rt.settings.get(k));
  if (!cfg.on) return 'Themed controls are off: every control is the browser\'s own.';
  const act = activeFamilies(cfg);
  const off = THEMED_FAMILIES.filter((f) => !act.includes(f));
  return `Themed controls are on${off.length ? `; native: ${off.map((f) => THEMED_FAMILY_LABELS[f].toLowerCase()).join(', ')}` : ' for every family'}.`;
}

/** Register the actions and the panel target; returns the remover. */
export function registerApi(rt: AxfRuntime): () => void {
  const offs: (() => void)[] = [];
  const reg = (id: string, fn: (args: string[]) => void, label: string, params = false) => offs.push(rt.actions.register(id, (args) => fn(args), { label, ...(params ? { params: true } : {}) }));
  reg('themed-controls.open', () => rt.dispatch(`settings.open:${TAB}`), 'Themed controls settings');
  reg('themed-controls.toggle', ([v]) => rt.settings.set(TC_KEYS.on, switchArg(v, rt.settings.get(TC_KEYS.on) !== false)), 'Turn themed controls on or off', true);
  reg('themed-controls.family', ([f, v]) => {
    const fam = familyFrom(f);
    if (!fam) { rt.toast(`No themed control family "${f ?? ''}". Families: ${THEMED_FAMILIES.join(', ')}.`, 'warning', 'Themed controls'); return; }
    rt.settings.set(TC_KEYS.family(fam), switchArg(v, rt.settings.get(TC_KEYS.family(fam)) !== false));
  }, 'Turn one themed control family on or off', true);
  reg('themed-controls.sheet', ([v]) => rt.settings.set(TC_KEYS.sheet, switchArg(v, rt.settings.get(TC_KEYS.sheet) !== false)), 'Bottom sheet on a phone on or off', true);
  reg('themed-controls.state', () => rt.toast(sayState(rt), 'info', 'Themed controls'), 'Are themed controls on');
  reg('themed-controls.set', ([ref, ...rest]) => {
    const r = liveHost()?.find(ref ?? '');
    if (!r?.swap.set) { rt.toast(`No themed control "${ref ?? ''}" on this screen.`, 'warning', 'Themed controls'); return; }
    void r.swap.set(rest.join(':'));
  }, 'Set a themed control', true);
  reg('themed-controls.get', ([ref]) => {
    const r = liveHost()?.find(ref ?? '');
    rt.toast(r ? `${ref}: ${JSON.stringify(r.swap.state?.() ?? { value: r.input.value })}` : `No themed control "${ref ?? ''}" on this screen.`, r ? 'info' : 'warning', 'Themed controls');
  }, 'Read a themed control', true);
  const popups = (): SwapRecord[] => (liveHost()?.swaps() ?? []).filter((r) => r.swap.open && (r.family === 'datetime' || r.family === 'color'));
  const openOne = (): SwapRecord | null => popups().find((r) => r.swap.state?.().open) ?? null;
  const resolve = (args: string[]): SwapRecord | null => {
    const [a, ...rest] = args;
    const ref = a && isThemedFamily(a) ? rest.join(':') : args.join(':');
    const fam = a && isThemedFamily(a) ? a : null;
    if (!ref && fam) return popups().find((r) => r.family === fam) ?? null;
    return liveHost()?.find(ref) ?? null;
  };
  reg('themed-controls.open', (args) => {
    if (!args.length) { rt.dispatch(`settings.open:${TAB}`); return; }
    const r = resolve(args);
    if (!r?.swap.open) { rt.toast(`No date, time or colour control "${args.join(':')}" on this screen.`, 'warning', 'Themed controls'); return; }
    r.swap.el.scrollIntoView({ block: 'nearest' });
    r.swap.open();
  }, 'Open a themed picker (or the Themed controls settings)', true);
  reg('themed-controls.close', (args) => {
    const r = args.length ? resolve(args) : openOne();
    for (const x of r ? [r] : popups()) x.swap.close?.();
  }, 'Close the open themed picker', true);
  reg('themed-controls.pick', (args) => {
    const r = openOne();
    if (!r?.swap.set) { rt.toast('No themed picker is open.', 'warning', 'Themed controls'); return; }
    void Promise.resolve(r.swap.set(args.join(':'))).then(() => r.swap.close?.(), (e: Error) => rt.toast(e.message, 'warning', 'Themed controls'));
  }, 'Pick a value in the open themed picker', true);
  for (const fam of ['datetime', 'color'] as const) {
    offs.push(controlRegistry(rt).register({
      address: `panel:themed-controls.${fam}`, kind: 'panel', label: fam === 'datetime' ? 'Date and time picker' : 'Colour picker', detail: 'Themed controls · pop-up', icon: fam === 'datetime' ? 'calendar' : 'palette',
      keywords: fam === 'datetime' ? ['date', 'time', 'calendar', 'picker'] : ['colour', 'color', 'picker', 'swatch'],
      can: ['open', 'state', 'set', 'press'],
      open: () => { const r = popups().find((x) => x.family === fam); r?.swap.open?.(); },
      get: () => { const r = popups().find((x) => x.family === fam && x.swap.state?.().open); return r ? { ref: r.ref, ...r.swap.state?.() } : { open: false }; },
      state: () => {
        const r = popups().find((x) => x.family === fam && x.swap.state?.().open);
        return r ? { open: true, ref: r.ref, ...r.swap.state?.() } : { open: false, controls: popups().filter((x) => x.family === fam).map((x) => x.ref) };
      },
      set: async (v) => {
        const s = String(v ?? '');
        const eq = s.indexOf('=');
        const r = eq > 0 ? liveHost()?.find(s.slice(0, eq)) : popups().find((x) => x.family === fam && x.swap.state?.().open);
        if (!r?.swap.set) throw new Error(eq > 0 ? `no ${fam} control ${s.slice(0, eq)}` : `no ${fam} picker is open: open one first or send <ref>=<value>`);
        await r.swap.set(eq > 0 ? s.slice(eq + 1) : s);
        if (eq <= 0) r.swap.close?.();
      },
      invoke: (v) => {
        const r = popups().find((x) => x.family === fam && x.swap.state?.().open);
        if (!r) return false;
        if (String(v ?? 'ok').toLowerCase() === 'ok') r.swap.el.ownerDocument.querySelector<HTMLButtonElement>('.fx-tc-pop .fx-btn--primary')?.click() ?? r.swap.close?.();
        else r.swap.close?.();
        return true;
      },
    }));
  }
  // the themed alert / confirm / prompt
  type DialogsApi = { openDialogs: () => { open: Record<string, unknown> | null; waiting: number }; currentDialog: () => { destructive: boolean; kind: string; answer(ok: boolean, text?: string): void } | null };
  const dlg = () => liveHost()?.global<DialogsApi>('dialogs') ?? null;
  const noDialog = () => new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, 'no themed dialog is open', { because: 'none open' });
  reg('themed-controls.answer', ([a, ...rest]) => {
    const d = dlg()?.currentDialog();
    if (!d) { rt.toast('No themed dialog is open.', 'warning', 'Themed controls'); return; }
    const ok = /^(ok|yes|true|1|confirm)$/i.test(a ?? 'ok');
    if (ok && d.destructive) { rt.toast('That confirm deletes or resets something: answer it on screen, or press button:themed-controls.dialog.ok with confirm.', 'warning', 'Themed controls'); return; }
    d.answer(ok, rest.length ? rest.join(':') : undefined);
  }, 'Answer the open themed dialog', true);
  offs.push(controlRegistry(rt).register({
    address: 'panel:themed-controls.dialogs', kind: 'panel', label: 'Themed dialog', detail: 'Themed controls · alert, confirm, prompt', icon: 'help',
    keywords: ['dialog', 'alert', 'confirm', 'prompt', 'answer'], can: ['state', 'set'],
    get: () => dlg()?.openDialogs() ?? { open: null, waiting: 0 },
    state: () => ({ ...(dlg()?.openDialogs() ?? { open: null, waiting: 0 }) }),
    set: (v) => {
      const field = document.querySelector<HTMLInputElement>('.fx-tc-dlg__field');
      if (!field) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, 'no themed prompt is open', { because: 'none open' });
      field.value = String(v ?? '');
    },
  }));
  offs.push(controlRegistry(rt).register({
    address: 'button:themed-controls.dialog.ok', kind: 'button', label: 'OK (themed dialog)', icon: 'check', keywords: ['ok', 'yes', 'confirm', 'dialog'],
    can: ['state', 'press'],
    get destructive() { return dlg()?.currentDialog()?.destructive === true; },
    element: () => document.querySelector('.fx-tc-dlg__ok'),
    state: () => ({ open: !!dlg()?.currentDialog(), destructive: dlg()?.currentDialog()?.destructive === true }),
    invoke: (v) => { const d = dlg()?.currentDialog(); if (!d) throw noDialog(); d.answer(true, v === undefined || v === null || v === '' ? undefined : String(v)); return true; },
  }));
  offs.push(controlRegistry(rt).register({
    address: 'button:themed-controls.dialog.cancel', kind: 'button', label: 'Cancel (themed dialog)', icon: 'x', keywords: ['cancel', 'no', 'dialog'],
    can: ['state', 'press'],
    element: () => document.querySelector('.fx-tc-dlg__cancel'),
    state: () => ({ open: !!dlg()?.currentDialog() }),
    invoke: () => { const d = dlg()?.currentDialog(); if (!d) throw noDialog(); d.answer(false); return true; },
  }));
  offs.push(controlRegistry(rt).register({
    address: 'panel:themed-controls', kind: 'panel', label: 'Themed controls', detail: 'Plugin · switches and live themed controls', icon: 'sliders',
    keywords: ['themed', 'controls', 'native', 'checkbox', 'slider', 'picker', 'tooltip', 'scrollbar'],
    can: ['open', 'state'], open: () => rt.dispatch(`settings.open:${TAB}`), get: () => stateOf(rt), state: () => stateOf(rt),
  }));
  return () => { for (const off of offs.splice(0)) off(); };
}
