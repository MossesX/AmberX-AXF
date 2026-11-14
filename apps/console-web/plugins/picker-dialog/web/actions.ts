/**
 * The picker actions (one set of handlers for every door: console actions over REST / MCP / the CLI, and voice). Each
 * goes through the framework's picker registry, the same calls a tap makes, and every change is reported to the
 * plugin server (POST state), which is what REST `GET state` and the CLI read back.
 *
 *   picker.open:<id>                 open a picker (id = its `data-fx-picker-id`, `button:picker-<id>` or `picker:<id>`)
 *   picker.choose:<id>:<name|value>  choose by value, else by spoken name / position ("the third one"); '-' = the open one
 *   picker.toggle:<id>:<value>       same as choose (multiple mode toggles)
 *   picker.search:<id>:<text>        type into its search field (opens it)
 *   picker.clear:<id>                empty its value
 *   picker.close                     close the open picker
 *   picker.list                      report every picker on the screen
 */
import type { AxfRuntime } from '@console/axf/core/runtime';
import { pickerApi, type PickerResult } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { FOLDER } from './settings';

let lastSent = '';
let timer: ReturnType<typeof setTimeout> | null = null;

/** Send what the screen's pickers look like now (debounced, only when it changed). */
export function reportState(last?: PickerResult & { action?: string }): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const body = JSON.stringify({ pickers: pickerApi.list(), open: pickerApi.openId(), last: last ?? null, at: new Date().toISOString() });
    const key = body.replace(/"at":"[^"]*"/, '');
    if (key === lastSent && !last) return;
    lastSent = key;
    void pluginFetch(FOLDER, 'state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => undefined);
  }, last ? 0 : 150);
}

const target = (id: string | undefined) => (!id || id === '-' ? null : id);

export function registerPickerActions(rt: AxfRuntime): () => void {
  const done = (action: string, r: PickerResult) => {
    if (!r.ok && r.error) rt.toast(r.error, 'warning', 'Picker');
    reportState({ ...r, action });
  };
  const offs = [
    rt.actions.register('picker.open', ([id]) => done('open', id ? pickerApi.open(id) : { ok: false, error: 'Which picker? picker.open:<id>' }), { label: 'Open a picker' }),
    rt.actions.register('picker.choose', ([id, ...rest]) => done('choose', pickerApi.choose(target(id), rest.join(':'))), { label: 'Choose an option in a picker' }),
    rt.actions.register('picker.toggle', ([id, ...rest]) => done('toggle', pickerApi.choose(target(id), rest.join(':'))), { label: 'Toggle an option in a picker' }),
    rt.actions.register('picker.search', ([id, ...rest]) => done('search', pickerApi.search(target(id), rest.join(':'))), { label: 'Search in a picker' }),
    rt.actions.register('picker.clear', ([id]) => done('clear', pickerApi.clear(target(id))), { label: 'Clear a picker' }),
    rt.actions.register('picker.close', ([id]) => done('close', pickerApi.close(target(id))), { label: 'Close the picker' }),
    rt.actions.register('picker.list', () => reportState({ ok: true, action: 'list' }), { label: 'List the pickers on this screen' }),
  ];
  const unsub = pickerApi.subscribe(() => reportState());
  return () => { unsub(); for (const off of offs) off(); };
}
