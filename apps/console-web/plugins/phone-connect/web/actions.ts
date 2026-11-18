/**
 * Console actions phone.* (voice, Ctrl+K, console_open, AmberX voice): the same routes as the settings tab, MCP
 * phone_connect_* and `axf phone`. None of them decides an approval; revoking stays the owner's tap in the settings tab.
 */
import type { AxfRuntime } from '@console/axf/core';
import { consoleSearch } from '@console/control/search';
import { executeControl } from '@console/control/executor';
import { phone } from './client';
import { showInPanel, TABS } from './settings';

const TITLE = 'Phone';
type Say = (text: string, kind?: 'success' | 'info' | 'warning') => void;

export function registerActions(rt: AxfRuntime, open: () => void): void {
  const say: Say = (text, kind = 'info') => rt.toast(text, kind, TITLE);
  const done = (r: { ok?: boolean; error?: { message: string } }, okText: string) => say(r.error ? r.error.message : okText, r.error ? 'warning' : 'success');
  rt.actions.register('phone.open', () => open(), { label: 'Phone Connect settings' });
  rt.actions.register('phone.tab', ([tab = 'pair']) => {
    const t = TABS.find((x) => x === tab) ?? 'pair';
    open();
    showInPanel(t);
  }, { label: 'Phone Connect: open a tab (phone.tab:<pair|phones|features|activity>)', params: true });
  rt.actions.register('phone.device', ([id = '']) => {
    open();
    showInPanel('phones', id);
  }, { label: 'Show one paired phone (phone.device:<deviceId>; console_show row:device/<id>)', params: true });
  rt.actions.register('phone.status', async () => {
    const s = await phone<{ presence: string; device: { name: string } | null }>('status');
    say(s.error ? s.error.message : `${s.device?.name ?? 'Phone'}: ${s.presence}`);
  }, { label: 'Phone status (is the phone online?)' });
  rt.actions.register('phone.pair', async () => {
    const r = await phone<{ pairing?: { code: string } }>('pair/start', {});
    if (!r.error) open();
    done(r, `Pairing code ${r.pairing?.code ?? ''}: enter it in the Phone Connect app.`);
  }, { label: 'Pair a phone (shows a pairing code)' });
  rt.actions.register('phone.devices', async () => {
    const r = await phone<{ devices?: { name: string; presence: string }[] }>('devices');
    say(r.error ? r.error.message : (r.devices ?? []).map((d) => `${d.name}: ${d.presence}`).join(' · ') || 'No phones paired');
  }, { label: 'List paired phones' });
  rt.actions.register('phone.url', async (args) => {
    const url = args.join(':').trim() || globalThis.location.href;
    done(await phone('open', { url }), 'Opening it on your phone');
  }, { label: 'Open a page on the phone (phone.url:<url>; no url = this page)', params: true });
  rt.actions.register('phone.notify', async (args) => {
    const title = args.join(':').trim();
    if (!title) { say('phone.notify:<text>', 'warning'); return; }
    done(await phone('notify', { title, kind: 'fyi' }), 'Sent to your phone');
  }, { label: 'Send a note to the phone (phone.notify:<text>)', params: true });
  rt.actions.register('phone.recorder', async ([what = 'status', ...rest]) => {
    if (what === 'stop') { done(await phone('recorder/stop', {}), 'Stopping the recorder'); return; }
    if (what === 'start') {
      // a start is confirm-policy: it needs Brett's approval id; from the console it goes through the settings tab's button
      say(`Starting the recorder needs your confirm: use Settings → Plugins → Phone Connect${rest.length ? ` (session "${rest.join(':')}")` : ''}.`);
      open();
      return;
    }
    const r = await phone<{ recorder?: { running?: boolean; session?: string } }>('recorder/status');
    say(r.error ? r.error.message : r.recorder?.running ? `Recording: ${r.recorder.session ?? ''}` : 'The recorder is stopped');
  }, { label: 'Phone recorder: status, stop, start (phone.recorder:<status|stop|start>)', params: true });
  // phone.voice:<phrase> — a phrase spoken on the phone, run like Ctrl+K: the best match opens (screens, tabs, rows) or
  // runs (console actions). Approve / deny are never console actions, so no phrase can decide.
  rt.actions.register('phone.voice', async (args) => {
    const q = args.join(':').trim();
    const hit = q ? consoleSearch(rt, { q, limit: 1 })[0] : undefined;
    if (!hit) { say(`Nothing matches "${q}"`, 'warning'); return; }
    if (hit.kind === 'function') { rt.dispatch(hit.value ? `${hit.address.replace(/^function:/, '')}:${hit.value}` : hit.address.replace(/^function:/, '')); return; }
    const r = await executeControl(rt, { verb: 'open', address: hit.address });
    say(r.ok ? `Opened ${hit.label}` : `Couldn't open ${hit.label}`, r.ok ? 'success' : 'warning');
  }, { label: 'Run a phrase spoken on the phone (phone.voice:<phrase>)', params: true, searchable: false });
  rt.actions.register('phone.say', async (args) => {
    const text = args.join(':').trim();
    if (!text) { say('phone.say:<text>', 'warning'); return; }
    done(await phone('voice', { mode: 'say', text }), 'Saying it on your phone');
  }, { label: 'Say a line on the phone (phone.say:<text>)', params: true });
}
