import type { AxfRuntime } from '@console/axf/core';
import { call } from './api';
import { previewVoice } from './voice-picker';
import { TAB_EVENT, matchAll, saveVoice, voiceLabel, type RosterRow } from './voices-tab';

/*
 * Agent voices without the UI: console actions (console_open / console_show target, MCP console actions, the
 * command palette) and AmberX voice phrases. Same REST routes as the UI, the CLI and the plugin commands.
 *
 *   agent-manager.voices                          open the Agent manager on the Voices tab
 *   agent-manager.voice.match:<agent|persona>:<id>   match one voice from its hint
 *   agent-manager.voice.match-all                 match every employee with a hint and no voice yet
 *   agent-manager.voice.set:<agent|persona>:<id>:<provider>:<voiceId>   pick a voice
 *   agent-manager.voice.tune:<agent|persona>:<id>:<speed %>:<pitch %>   speed and pitch
 *   agent-manager.voice.preview:<agent|persona>:<id>   say a line in that voice on this device
 *   agent-manager.voice.say:<id>                  tell me which voice an employee speaks with
 */

const kindOf = (k: string): 'agent' | 'persona' => (k === 'persona' ? 'persona' : 'agent');
const roster = () => call<{ roster: RosterRow[] }>('voices').then((r) => r.roster);
async function find(kind: string, id: string) {
  const r = (await roster()).find((x) => x.kind === kindOf(kind) && x.id === id);
  if (!r) throw new Error(`no ${kindOf(kind)} "${id}"`);
  return r;
}

export function openVoices(rt: AxfRuntime) {
  rt.navigate('agent-manager');
  setTimeout(() => window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: 'voices' })), 0);
}

export function registerVoiceActions(rt: AxfRuntime) {
  const run = (p: Promise<string>) => void p.then((t) => rt.toast(t, 'success')).catch((e: Error) => rt.toast(`Agent voice: ${e.message}`, 'danger'));
  const reg = (id: string, fn: (p: string[]) => void, label: string, params = false) => rt.actions.register(id, fn, { label, ...(params ? { params: true, searchable: false } : {}) });
  const d = decodeURIComponent;
  reg('agent-manager.voices', () => openVoices(rt), 'Agent manager: voices for every agent and persona');
  reg('agent-manager.tab', ([t = 'agents']) => { rt.navigate('agent-manager'); setTimeout(() => window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: t })), 0); }, 'Agent manager: open a section', true);
  reg('agent-manager.voice.match-all', () => run(matchAll().then((l) => (l.length ? `Matched ${l.length}: ${l.join(' · ')}` : 'Nobody has a hint without a voice.'))), 'Agent manager: match every voice from its hint');
  reg('agent-manager.voice.match', ([k = 'agent', id = '']) => run(saveVoice(kindOf(k), d(id), { match: true }).then((r) => r.match?.why ?? 'matched')), 'Agent manager: match a voice from its hint', true);
  reg('agent-manager.voice.set', ([k = 'agent', id = '', provider = 'browser', voiceId = '']) => run(saveVoice(kindOf(k), d(id), { provider: d(provider), voiceId: d(voiceId) }).then(() => `${d(id)} speaks with ${d(voiceId) || 'the default voice'}`)), 'Agent manager: pick a voice', true);
  reg('agent-manager.voice.tune', ([k = 'agent', id = '', rate = '100', pitch = '100']) => run(saveVoice(kindOf(k), d(id), { rate: Number(rate) / 100, pitch: Number(pitch) / 100 }).then(() => `${d(id)}: speed ${rate}%, pitch ${pitch}%`)), 'Agent manager: voice speed and pitch (percent)', true);
  reg('agent-manager.voice.preview', ([k = 'agent', id = '']) => run(find(k, d(id)).then(async (r) => (await previewVoice(r.speaks ?? {}, `Hi, I'm ${r.name}. This is how I sound.`, r.kind === 'agent' ? r.id : undefined)) || `${r.name}: ${voiceLabel(r.speaks)}`)), 'Agent manager: hear a voice', true);
  reg('agent-manager.voice.say', ([id = '']) => run(roster().then((rows) => { const r = rows.find((x) => x.id === d(id) || x.name.toLowerCase() === d(id).toLowerCase()); if (!r) throw new Error(`no agent "${d(id)}"`); return `${r.name} speaks with ${voiceLabel(r.speaks)}`; })), 'Agent manager: which voice an agent speaks with', true);
}

/** Phrases: general ones plus per employee ("how does Mosses sound", "match Molly's voice"). */
export function voiceCommands(rows: RosterRow[]) {
  const o = 'Agent voices';
  const cmds = [
    { id: 'agent-manager.voices', phrases: ['open agent voices', 'show agent voices', 'pick agent voices'], action: 'agent-manager.voices', owner: o },
    { id: 'agent-manager.voice.match-all', phrases: ['match all voices', 'give everyone a voice', 'match agent voices'], action: 'agent-manager.voice.match-all', reply: 'Matching voices from the hints.', owner: o },
  ];
  for (const r of rows) {
    const n = r.name.toLowerCase();
    const said = [...new Set([n, n.split(/\s+/)[0] ?? ''])].filter((w) => w.length > 1);
    const ref = `${r.kind}:${encodeURIComponent(r.id)}`;
    cmds.push({ id: `agent-manager.voice.preview.${r.kind}.${r.id}`, phrases: said.flatMap((w) => [`how does ${w} sound`, `preview ${w}'s voice`]), action: `agent-manager.voice.preview:${ref}`, owner: o });
    cmds.push({ id: `agent-manager.voice.match.${r.kind}.${r.id}`, phrases: said.map((w) => `match ${w}'s voice`), action: `agent-manager.voice.match:${ref}`, reply: `Matching ${r.name}'s voice.`, owner: o });
  }
  return cmds;
}

type VoiceRegistry = { register(module: string, commands: ReturnType<typeof voiceCommands>): () => void };
/** AmberX's voice plugin takes phrases from plugins it can't import through the page (generic, names no plugin). */
export async function registerVoicePhrases(module: string) {
  const v = (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice;
  if (!v) return;
  v.register(module, voiceCommands(await roster().catch(() => [])));
}
