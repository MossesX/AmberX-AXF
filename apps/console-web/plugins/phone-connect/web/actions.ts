/**
 * Phone Connect's console actions (the actions registry: voice, console_action on MCP, the CLI and the command palette
 * run them the same way). Each one calls the same REST route the screens and plugin commands use.
 *   phone-connect.open [tab]        open the page (tab: phone, notifications, recorder, rules, overlay)
 *   phone.open <url>                open an https amberxai.com page on the phone
 *   phone.notify <kind> <title…>    fyi | fix-update | alert | approval
 *   phone.recorder.start <name…>    a straight approval on axHub, then Android's capture prompt
 *   phone.recorder.stop · phone.recorder.status
 *   phone.pair                      a new pairing code (shown on the Phone tab)
 *   phone.overlay.preset <id>       default | quiet | loud | minimal
 */
import { TAB_GROUP_LAST_KEY, type AxfRuntime } from '@console/axf/core';
import { api, errText, type RecorderStatus } from './api';

const say = (rt: AxfRuntime, text: string, tone: 'info' | 'success' | 'warning' | 'danger' = 'info') => rt.toast(text, tone, 'Phone Connect');
const run = (rt: AxfRuntime, p: Promise<unknown>, ok: string) => void p.then(() => say(rt, ok, 'success'), (e) => say(rt, errText(e), 'danger'));

export const PHONE_ACTIONS = ['phone-connect.open', 'phone.open', 'phone.notify', 'phone.recorder.start', 'phone.recorder.stop', 'phone.recorder.status', 'phone.pair', 'phone.overlay.preset'] as const;

export function registerPhoneActions(rt: AxfRuntime): void {
  rt.actions.register('phone-connect.open', ([tab]) => {
    if (tab) rt.settings.set(TAB_GROUP_LAST_KEY('phone-connect.tabs'), tab);
    rt.dispatch('nav:phone-connect');
  }, { label: 'Open Phone Connect', params: true });
  rt.actions.register('phone.open', ([url]) => run(rt, api.post('open', { url, via: 'voice' }), 'Opening it on the phone.'), { label: 'Open a page on the phone', params: true });
  rt.actions.register('phone.notify', ([kind, ...title]) => run(rt, api.post('notify', { kind, title: title.join(' '), via: 'voice' }), 'Sent to the phone.'), { label: 'Notify the phone', params: true });
  rt.actions.register('phone.recorder.start', (name) => run(rt, api.post('recorder/start', { session_name: name.join(' ') || 'Voice session', via: 'voice' }), 'Asked: approve it on axHub, then allow the capture prompt on the phone.'), { label: 'Start the phone recorder', params: true });
  rt.actions.register('phone.recorder.stop', () => run(rt, api.post('recorder/stop', { via: 'voice' }), 'Stop sent to the phone.'), { label: 'Stop the phone recorder' });
  rt.actions.register('phone.recorder.status', () => void api.call<RecorderStatus>('recorder/status').then(
    (s) => say(rt, s.running ? `Recording${s.session ? ` "${s.session}"` : ''}, part ${s.part || 1}, ${s.queue} waiting to upload.` : `The recorder is off (${s.presence}).`),
    (e) => say(rt, errText(e), 'danger')), { label: 'Phone recorder status' });
  rt.actions.register('phone.pair', () => void api.post<{ code: string }>('pair', {}).then((p) => { say(rt, `Pairing code ${p.code}: type it or scan the QR on the phone.`, 'success'); rt.dispatch('nav:phone-connect'); }, (e) => say(rt, errText(e), 'danger')), { label: 'Pair a phone' });
  rt.actions.register('phone.overlay.preset', ([id]) => run(rt, api.post(`overlay/presets/${encodeURIComponent(id ?? 'default')}`, {}), 'The phone picks it up on its next poll.'), { label: 'Phone overlay preset', params: true });
}
