// The console actions that reach the phone's native bridge (native-bridge@1, apps/console-droid/BRIDGE.md), so every
// bridge tool is callable without the UI the same way everywhere:
//   REST   POST /api/console/action {"action":"device.recorder:status"}
//   MCP    console_action { action: "device.mic:off" }
//   CLI    axf console action device.open:https://console.amberxai.com/?axf-open=settings
//   voice  "phone mic off" (AmberX runs the same console action)
// and the bridge's state on the control address panel:phone-bridge (`axf console control state panel:phone-bridge`).
// Pure: deviceCall() turns an action id and its colon-split args into one bridge call; deviceApi.ts registers them.
import { toolOf } from './bridgeClient.mjs';

export const DEVICE_ADDRESS = 'panel:phone-bridge';

/** id → what it does (labels are repeated literally in deviceApi.ts for the control inventory). */
export const DEVICE_ACTIONS = [
  { id: 'device.state', params: false, effect: 'read' },
  { id: 'device.tool', params: true, effect: 'write' },
  { id: 'device.mic', params: true, effect: 'write' },
  { id: 'device.permission', params: true, effect: 'write' },
  { id: 'device.open', params: true, effect: 'write' },
  { id: 'device.wake', params: true, effect: 'write' },
  { id: 'device.notify', params: true, effect: 'write' },
  { id: 'device.notify-cancel', params: true, effect: 'write' },
  { id: 'device.recorder', params: true, effect: 'write' },
];

const PERMISSIONS = ['mic', 'notifications', 'overlay'];
const err = (error) => ({ error });

/**
 * One action → one bridge call: { tool, args } or { error }. Args arrive split on ':' (the console's action syntax),
 * so URLs and JSON are joined back.
 */
export function deviceCall(id, rawArgs = []) {
  const args = (rawArgs ?? []).map((a) => String(a ?? ''));
  const all = args.join(':').trim();
  switch (id) {
    case 'device.state': return { tool: 'bridge.info', args: {} };
    case 'device.tool': {
      const [name, ...rest] = args;
      const tool = toolOf(name);
      if (!tool) return err(`No phone tool called "${name ?? ''}". Try device.tool:bridge.capabilities.`);
      const json = rest.join(':').trim();
      if (!json) return { tool, args: {} };
      try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return err('The tool\'s arguments must be a JSON object.');
        return { tool, args: parsed };
      } catch { return err('The tool\'s arguments must be a JSON object.'); }
    }
    case 'device.mic': {
      const v = all.toLowerCase();
      if (v === '' || v === 'status') return { tool: 'mic.status', args: {} };
      if (v === 'on' || v === 'off') return { tool: 'mic.set', args: { on: v === 'on' } };
      return err('device.mic takes on, off or status.');
    }
    case 'device.permission': {
      const v = all.toLowerCase();
      if (v === '' || v === 'status') return { tool: 'permissions.status', args: {} };
      if (!PERMISSIONS.includes(v)) return err(`device.permission takes ${PERMISSIONS.join(', ')} or status.`);
      return { tool: 'permissions.request', args: { permission: v } };
    }
    case 'device.open': {
      // device.open:<url> or device.open:browser:<url>
      let where = 'app', url = all;
      if (/^browser:/i.test(url)) { where = 'browser'; url = url.slice('browser:'.length); }
      if (!/^https:\/\//i.test(url)) return err('device.open takes an https URL on Brett\'s own sites.');
      return { tool: 'browser.open', args: { url, where } };
    }
    case 'device.wake': return { tool: 'console.wake', args: all ? { target: all } : {} };
    case 'device.notify': {
      const [title, ...text] = args;
      if (!title || !title.trim()) return err('device.notify takes <title>[:<text>].');
      return { tool: 'notify.show', args: { title: title.trim(), text: text.join(':').trim() } };
    }
    case 'device.notify-cancel': {
      if (!all) return { tool: 'notify.status', args: {} };
      return { tool: 'notify.cancel', args: { id: all } };
    }
    case 'device.recorder': {
      const [verb = 'status', ...rest] = args;
      const v = verb.trim().toLowerCase();
      if (v === 'status' || v === 'state') return { tool: 'recorder.status', args: {} };
      if (v === 'stop') return { tool: 'recorder.stop', args: {} };
      if (v === 'start') {
        const session = rest.join(':').trim();
        return { tool: 'recorder.start', args: { session_name: session || 'Console recording' } };
      }
      return err('device.recorder takes start[:<session>], stop or status.');
    }
    default: return err(`Unknown device action ${id}.`);
  }
}

/** A one-line answer for the toast (and the voice reply). */
export function describeDevice(tool, data) {
  const d = data ?? {};
  switch (tool) {
    case 'bridge.info': return `Console app ${d.version ?? ''} · ${d.device ?? ''} · ${(d.tools ?? []).length} phone tools`.trim();
    case 'mic.status': case 'mic.set': return `Phone mic ${d.on ? 'on' : 'off'}${d.reason && d.reason !== 'ok' ? ` (${String(d.reason).replace(/_/g, ' ')})` : ''}`;
    case 'permissions.status': return `Phone permissions: ${PERMISSIONS.map((p) => `${p} ${d[p] ? 'yes' : 'no'}`).join(', ')}`;
    case 'permissions.request': return d.granted ? `${d.permission} allowed` : `Asked the phone for ${d.permission}`;
    case 'browser.open': return d.opened ? `Opened ${d.url}` : d.notified ? 'Sent a notification to open it' : `Couldn't open ${d.url ?? 'it'}`;
    case 'console.wake': return d.opened ? 'Console is up on the phone' : d.notified ? 'Sent a wake notification' : 'The phone didn\'t wake';
    case 'notify.show': return 'Notification sent';
    case 'notify.cancel': return 'Notification cleared';
    case 'notify.status': return `Phone notifications ${d.enabled ? 'on' : 'off'}, ${(d.shown ?? []).length} shown`;
    case 'recorder.status': return d.running ? `Recording: ${d.session ?? ''}` : 'Not recording';
    case 'recorder.start': return d.awaitingConsent ? 'Recording waits for your yes on the phone' : 'Recording';
    case 'recorder.stop': return 'Recording stopped';
    default: return 'Done on the phone';
  }
}
