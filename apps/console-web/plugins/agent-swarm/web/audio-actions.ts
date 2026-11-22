import type { AxfRuntime } from '@console/axf/core';
import { writeLocal } from '@console/api';
import * as A from '../../../../../framework/core/engines/chat-audio.mjs';
import type { AudioSettings } from '../../../../../framework/core/engines/chat-audio.mjs';
import * as player from './chat-audio';
import { api } from './ui-types';

/*
 * Group chat audio without the UI: console actions (console_open / console_show target, MCP console actions, the
 * command palette) and AmberX voice phrases. Room settings go through the same `chat/audio` route the CLI and the
 * plugin commands use; playback (stop, skip, pause, resume, try a voice) is this device's player.
 *
 *   agent-swarm.chat-audio                  open the Breakroom on the group chat (the audio controls)
 *   agent-swarm.audio.on | off | toggle     Enable audio
 *   agent-swarm.audio.mode:<all|mentions|summaries> · agent-swarm.audio.volume:<0-100>
 *   agent-swarm.audio.mute:<agent|name|all> · agent-swarm.audio.unmute:<agent|name|all>
 *   agent-swarm.audio.stop | skip | pause | resume · agent-swarm.audio.sample:<agent>
 */

export const TAB_EVENT = 'agent-swarm:tab';
type Res = { ok: boolean; error?: string; audio?: AudioSettings; log?: string[] };

async function change(rt: AxfRuntime, c: Record<string, unknown>) {
  try {
    const r = await api.post<Res>('chat/audio', c);
    if (!r.ok || !r.audio) throw new Error(r.error ?? 'the change was refused');
    player.applySettings(r.audio);
    rt.toast(r.log?.join(' · ') || A.describe(r.audio), 'success');
  } catch (e) { rt.toast(`Group chat audio: ${(e as Error).message}`, 'danger'); }
}

export function openChat(rt: AxfRuntime) {
  writeLocal('swarm-tab', 'chat');
  rt.navigate('agent-swarm');
  setTimeout(() => window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: 'chat' })), 0);
}

export function registerAudioActions(rt: AxfRuntime) {
  const reg = (id: string, fn: (p: string[]) => void, label: string, params = false) => rt.actions.register(id, fn, { label, ...(params ? { params: true, searchable: false } : {}) });
  reg('agent-swarm.chat-audio', () => openChat(rt), 'Group chat audio: open the controls');
  reg('agent-swarm.audio.on', () => void change(rt, { enabled: true }), 'Group chat audio: turn on');
  reg('agent-swarm.audio.off', () => void change(rt, { enabled: false }), 'Group chat audio: turn off');
  reg('agent-swarm.audio.toggle', () => void change(rt, { enabled: !player.status().settings.enabled }), 'Group chat audio: on / off');
  reg('agent-swarm.audio.mode', ([m = 'all']) => void change(rt, { mode: m }), 'Group chat audio: read everything, only my mentions or summaries only', true);
  reg('agent-swarm.audio.volume', ([v = '80']) => void change(rt, { volume: Number(v) }), 'Group chat audio: volume', true);
  reg('agent-swarm.audio.mute', ([a = '']) => void change(rt, { mute: decodeURIComponent(a) }), 'Group chat audio: mute an agent', true);
  reg('agent-swarm.audio.unmute', ([a = '']) => void change(rt, { unmute: decodeURIComponent(a) }), 'Group chat audio: unmute an agent', true);
  reg('agent-swarm.audio.stop', () => player.stop(), 'Group chat audio: stop talking');
  reg('agent-swarm.audio.skip', () => player.skip(), 'Group chat audio: skip this line');
  reg('agent-swarm.audio.pause', () => player.pause(), 'Group chat audio: pause');
  reg('agent-swarm.audio.resume', () => player.resume(), 'Group chat audio: resume');
  reg('agent-swarm.audio.sample', ([a = '']) => player.sample(decodeURIComponent(a)), 'Group chat audio: try an agent\'s voice', true);
}

/** Phrases for the group chat audio; per-agent ones for every name on the crew ("mute Kat", "unmute Kotlin Kat"). */
export function voiceCommands(names: Record<string, string>) {
  const o = 'Group chat audio';
  const cmds = [
    { id: 'agent-swarm.audio.on', phrases: ['turn on group chat audio', 'group chat audio on', 'enable group chat audio', 'read the group chat', 'let me hear the crew'], action: 'agent-swarm.audio.on', reply: 'Group chat audio is on.', owner: o },
    { id: 'agent-swarm.audio.off', phrases: ['turn off group chat audio', 'group chat audio off', 'disable group chat audio', 'stop reading the group chat'], action: 'agent-swarm.audio.off', reply: 'Group chat audio is off.', owner: o },
    { id: 'agent-swarm.audio.stop', phrases: ['quiet crew', 'shut up crew', 'stop the chat audio'], action: 'agent-swarm.audio.stop', owner: o },
    { id: 'agent-swarm.audio.skip', phrases: ['skip that', 'next message', 'skip this message'], action: 'agent-swarm.audio.skip', owner: o },
    { id: 'agent-swarm.audio.pause', phrases: ['pause group chat audio', 'pause the crew'], action: 'agent-swarm.audio.pause', owner: o },
    { id: 'agent-swarm.audio.resume', phrases: ['resume group chat audio', 'resume the crew'], action: 'agent-swarm.audio.resume', owner: o },
    { id: 'agent-swarm.audio.mentions', phrases: ['only my mentions', 'only read my mentions'], action: 'agent-swarm.audio.mode:mentions', owner: o },
    { id: 'agent-swarm.audio.summaries', phrases: ['summaries only', 'only read summaries'], action: 'agent-swarm.audio.mode:summaries', owner: o },
    { id: 'agent-swarm.audio.all', phrases: ['read everything', 'read every message'], action: 'agent-swarm.audio.mode:all', owner: o },
    { id: 'agent-swarm.audio.mute-all', phrases: ['mute everyone', 'mute the crew'], action: 'agent-swarm.audio.mute:all', owner: o },
    { id: 'agent-swarm.audio.unmute-all', phrases: ['unmute everyone', 'unmute the crew'], action: 'agent-swarm.audio.unmute:all', owner: o },
    { id: 'agent-swarm.audio.open', phrases: ['open group chat audio', 'show the group chat'], action: 'agent-swarm.chat-audio', owner: o },
  ];
  for (const [id, name] of Object.entries(names)) {
    const said = [...new Set([name.toLowerCase(), name.toLowerCase().split(/\s+/)[0] ?? '', id])].filter((w) => w.length > 1);
    cmds.push({ id: `agent-swarm.audio.mute.${id}`, phrases: said.map((w) => `mute ${w}`), action: `agent-swarm.audio.mute:${id}`, reply: `${name} muted.`, owner: o });
    cmds.push({ id: `agent-swarm.audio.unmute.${id}`, phrases: said.map((w) => `unmute ${w}`), action: `agent-swarm.audio.unmute:${id}`, reply: `${name} unmuted.`, owner: o });
  }
  return cmds;
}

type VoiceRegistry = { register(module: string, commands: ReturnType<typeof voiceCommands>): () => void };
/** AmberX's voice plugin takes phrases from plugins it can't import through the page (generic, names no plugin). */
export async function registerAudioVoice(module: string) {
  const v = (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice;
  if (!v) return;
  const r = await api.call<{ ok: boolean; names?: Record<string, string> }>('chat/heard').catch(() => ({ ok: false, names: {} }));
  v.register(module, voiceCommands(r.names ?? {}));
}
