/**
 * Every phone tool of the console app's native bridge (native-bridge@1, apps/console-droid/BRIDGE.md) without the UI:
 * `device.*` console actions (REST `POST /api/console/action`, MCP `console_action`, CLI `axf console action …`,
 * voice) and the bridge's state on `panel:phone-bridge` (`state` verb: REST `/api/console/control`, MCP
 * `console_control`, `axf console control state panel:phone-bridge`). Outside the app every action answers that the
 * phone app isn't here. Mapping and wording: deviceActions.mjs (tested).
 */
import type { AxfRuntime } from '../axf/core';
import { controlRegistry } from '../axf/react';
import { BRIDGE_VERSION, callWithPermissions, nativeTool } from './bridgeClient.mjs';
import { DEVICE_ADDRESS, describeDevice, deviceCall } from './deviceActions.mjs';

type Snapshot = Record<string, unknown>;

export function installDeviceApi(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  const offs: Array<() => void> = [];
  const inApp = () => (window as unknown as { axfNative?: { version?: string } }).axfNative?.version === BRIDGE_VERSION;

  // last-known state, refreshed on load and on every native event (the control `state` verb is synchronous)
  let snapshot: Snapshot = { available: false };
  const refresh = async () => {
    if (!inApp()) { snapshot = { available: false, reason: 'The Android console app is not running this page.' }; return; }
    const get = (tool: string) => nativeTool(window, tool).catch((e: { code?: string; message?: string }) => ({ error: e?.code ?? 'unavailable', message: e?.message }));
    const [info, mic, permissions, notify, recorder, slots] = await Promise.all(['bridge.info', 'mic.status', 'permissions.status', 'notify.status', 'recorder.status', 'slots.status'].map(get));
    snapshot = { available: true, bridge: BRIDGE_VERSION, info, mic, permissions, notify, recorder, slots, at: new Date().toISOString() };
  };
  void refresh();
  const native = (window as unknown as { axfNative?: { on?: (e: string, fn: () => void) => () => void } }).axfNative;
  if (native?.on) offs.push(native.on('*', () => { void refresh(); }));

  const run = (id: string, args: string[]) => {
    const c = deviceCall(id, args);
    if ('error' in c) { rt.toast(c.error, 'warning', 'Phone'); return false; }
    if (!inApp()) { rt.toast('The Android console app is not running this page.', 'warning', 'Phone'); return false; }
    return callWithPermissions(window, c.tool, c.args).then(
      (data) => { rt.toast(describeDevice(c.tool, data), 'success', 'Phone'); void refresh(); return data; },
      (e: { code?: string; message?: string }) => { rt.toast(e?.message ?? 'The phone said no.', 'warning', 'Phone'); return { ok: false, error: e?.code, message: e?.message }; },
    );
  };

  offs.push(rt.actions.register('device.state', (a) => run('device.state', a), { label: 'Phone app: version, device and its native tools', module: 'console.native', effect: 'read' }));
  offs.push(rt.actions.register('device.tool', (a) => run('device.tool', a), { label: 'Run any phone tool by name (device.tool:<tool>[:<json args>])', params: true, module: 'console.native', effect: 'write' }));
  offs.push(rt.actions.register('device.mic', (a) => run('device.mic', a), { label: 'Phone mic switch: on, off, status (device.mic:<on|off|status>)', params: true, module: 'console.native', effect: 'write' }));
  offs.push(rt.actions.register('device.permission', (a) => run('device.permission', a), { label: 'Ask the phone for a permission: mic, notifications, overlay; or status', params: true, module: 'console.native', effect: 'write' }));
  offs.push(rt.actions.register('device.open', (a) => run('device.open', a), { label: 'Open one of your pages on the phone (device.open:[browser:]<https url>)', params: true, module: 'console.native', effect: 'write' }));
  offs.push(rt.actions.register('device.wake', (a) => run('device.wake', a), { label: 'Wake the console on the phone, at a console address (device.wake[:<target>])', params: true, module: 'console.native', effect: 'write' }));
  offs.push(rt.actions.register('device.notify', (a) => run('device.notify', a), { label: 'Phone notification (device.notify:<title>[:<text>])', params: true, module: 'console.native', effect: 'write' }));
  offs.push(rt.actions.register('device.notify-cancel', (a) => run('device.notify-cancel', a), { label: 'Clear a phone notification by id, or list them (device.notify-cancel[:<id>])', params: true, module: 'console.native', effect: 'write' }));
  offs.push(rt.actions.register('device.recorder', (a) => run('device.recorder', a), { label: 'Phone recorder: start[:<session>], stop, status (AmberX records until its capture service moves)', params: true, module: 'console.native', effect: 'write' }));

  offs.push(rt.actions.register('device.slots', (a) => run('device.slots', a), { label: 'Console slots on the phone, up to four at once: status, open:<target>[:<slot>], close:<slot>, focus:<slot>', params: true, module: 'console.native', effect: 'write' }));

  offs.push(controlRegistry(rt).register({
    address: DEVICE_ADDRESS, kind: 'panel', label: 'Phone native bridge', detail: 'Phone · mic, permissions, notifications, open_url, wake, recorder, four console slots',
    icon: 'smartphone', keywords: ['phone', 'android', 'native', 'bridge', 'mic', 'permissions', 'notifications', 'wake', 'recorder', 'slots', 'split', 'device'], can: ['state'],
    state: () => ({ device: snapshot }),
  }));
  return () => offs.forEach((f) => f());
}
