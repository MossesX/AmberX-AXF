/**
 * Voice → console-control@1 (spec/CONSOLE-CONTROL.md → Voice). A spoken phrase ("scroll down", "open plugins settings",
 * "find <x>", "show step 3 of <build>", "disable plugin <y>", "press <button>") becomes one command through the shared
 * intent engine (core/engines/console-control-voice.mjs); words that name a target are resolved by the console's own
 * search (best hit first); the executor runs it, and the result is spoken back through the agent voice
 * (`axf:agent-voice.say`) and shown as a toast.
 *
 * Reach: the console action `console.control.voice:<phrase>` (so REST /do press function:console.control.voice, MCP
 * console_control_do, the CLI and the AmberX assistant all reach it), and POST /api/console-control/voice {text}, which
 * maps the phrase on the server with the Python twin and runs the same command.
 */
import type { AxfRuntime } from '../axf/core';
import { intentCommand, voiceIntent, voiceReply, type VoiceIntent } from '../axf/core/engines/console-control-voice.mjs';
import { executeControl, type ControlAnswer } from '../control/executor';
import { consoleSearch, type ConsoleSearchHit } from '../control/search';
import { controlRegistry } from '../axf/react/controlTargets';

export const VOICE_ACTION = 'console.control.voice';

export interface VoiceRun { heard: string; intent: VoiceIntent | null; hit?: ConsoleSearchHit; command?: Record<string, unknown>; answer?: ControlAnswer; say: string; ok: boolean }

/** The best hit for an intent's words: inside `within` first (a settings tab), then anywhere. */
export function resolveIntent(rt: AxfRuntime, intent: VoiceIntent): ConsoleSearchHit | null {
  if (!intent.find) return null;
  controlRegistry(rt).refreshNow(); // fields and buttons of the dialog in front (fieldControl.ts) are searchable now
  const hits = consoleSearch(rt, { q: intent.find.q, kinds: intent.find.kinds, limit: 10 });
  if (intent.within) return hits.find((h) => h.address.startsWith(`${intent.within}/`)) ?? hits[0] ?? null;
  return hits[0] ?? null;
}

/** Say a line through the agent voice (when it is on) — the voice plugin listens for this event. */
export function speak(text: string): void {
  if (typeof window === 'undefined' || !text) return;
  window.dispatchEvent(new CustomEvent('axf:agent-voice.say', { detail: { agentId: 'amber', agentName: 'Amber', text } }));
}

/** Run one phrase. Never throws. */
export async function runVoice(rt: AxfRuntime, text: string, opts: { speak?: boolean } = {}): Promise<VoiceRun> {
  const heard = String(text ?? '').trim();
  const intent = voiceIntent(heard);
  const done = (r: VoiceRun): VoiceRun => {
    if (opts.speak !== false) { speak(r.say); rt.toast(r.say, r.ok ? 'info' : 'warning', 'Voice'); }
    return r;
  };
  if (!intent) return done({ heard, intent, say: "That isn't a console command I know. Say: what can I say.", ok: false });
  if (intent.help) return done({ heard, intent, say: voiceReply(intent, { ok: true }), ok: true });
  let hit: ConsoleSearchHit | null = null;
  if (intent.find) {
    try { hit = resolveIntent(rt, intent); } catch { hit = null; }
    if (!hit) return done({ heard, intent, say: `I couldn't find ${intent.find.q}.`, ok: false });
  }
  const command = intentCommand(intent, hit?.address ?? null);
  // a function hit with an argument (a plan feature, a build) runs with it
  if (hit?.value !== undefined && (command.verb === 'open' || command.verb === 'press')) { command.verb = 'press'; command.value = hit.value; }
  const answer = await executeControl(rt, { ...command, by: 'voice', reason: `said: ${heard.slice(0, 160)}` });
  return done({ heard, intent, ...(hit ? { hit } : {}), command, answer, say: voiceReply(intent, answer as unknown as Record<string, unknown>, hit?.label), ok: answer.ok });
}

/** Register `console.control.voice:<phrase>`. Returns a remover. */
export function installVoiceControl(rt: AxfRuntime): () => void {
  return rt.actions.register(VOICE_ACTION, (args) => { void runVoice(rt, args.join(':')); return true; }, {
    label: 'Voice command for the console (scroll, open, find, show a build step, plugins on / off, press)', params: true, module: 'console.control',
  });
}
