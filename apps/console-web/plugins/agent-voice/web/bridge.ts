/**
 * The Assistant bridge (assistant-voice events, Oct 29 2026). The AI assistant and this plugin never import each other:
 * they talk through window events, so either can be removed.
 *
 * The assistant sends (ai-assistant/web/chat.tsx):
 *   axf:assistant.agent   {agentId, agentName, open}        the selected agent changed / a chat window opened or closed
 *   axf:assistant.reply   {agentId, agentName, text, convId, viaVoice}   a reply finished
 * This plugin sends:
 *   axf:assistant.input   {text, send, partial}              put words in the composer (and send them)
 *   axf:assistant.focus   {agentId}                           open the assistant on an agent
 *
 * The assistant also answers `axf:assistant.hello` with its current agent, so a plugin loaded after it catches up.
 */
import { useSyncExternalStore } from 'react';

export const EV = {
  agent: 'axf:assistant.agent',
  reply: 'axf:assistant.reply',
  input: 'axf:assistant.input',
  hello: 'axf:assistant.hello',
} as const;

export interface AssistantAgent { agentId: string; agentName: string; open: boolean }
export interface AssistantReply { agentId: string; agentName: string; text: string; convId?: string; viaVoice?: boolean }

let current: AssistantAgent = { agentId: '', agentName: '', open: false };
const subs = new Set<() => void>();
const windows = new Map<string, AssistantAgent>();

function recompute() {
  // The most recently reported open window wins; else the last one reported.
  const open = [...windows.values()].filter((w) => w.open);
  const next = open[open.length - 1] ?? [...windows.values()].pop() ?? { agentId: '', agentName: '', open: false };
  if (next.agentId !== current.agentId || next.agentName !== current.agentName || next.open !== current.open) {
    current = { ...next };
    subs.forEach((f) => f());
  }
}

let started = false;
export function startBridge(onReply: (r: AssistantReply) => void): () => void {
  if (started || typeof window === 'undefined') return () => undefined;
  started = true;
  const onAgent = (e: Event) => {
    const d = (e as CustomEvent<AssistantAgent & { window?: string }>).detail ?? ({} as AssistantAgent & { window?: string });
    const key = d.window || 'main';
    windows.delete(key); // re-insert so the newest report is last
    windows.set(key, { agentId: String(d.agentId || ''), agentName: String(d.agentName || d.agentId || ''), open: d.open !== false });
    if (d.open === false) windows.delete(key);
    recompute();
  };
  const onRep = (e: Event) => { const d = (e as CustomEvent<AssistantReply>).detail; if (d?.text) onReply(d); };
  window.addEventListener(EV.agent, onAgent);
  window.addEventListener(EV.reply, onRep);
  window.dispatchEvent(new CustomEvent(EV.hello));
  return () => { window.removeEventListener(EV.agent, onAgent); window.removeEventListener(EV.reply, onRep); started = false; };
}

export const assistantAgent = (): AssistantAgent => current;
export function onAssistantAgent(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
export const useAssistantAgent = (): AssistantAgent => useSyncExternalStore(onAssistantAgent, assistantAgent, assistantAgent);

/** Put words in the open assistant's composer; `send` presses Send; `partial` = live text (replaced by the next). */
export function toComposer(text: string, opts: { send?: boolean; partial?: boolean } = {}): void {
  window.dispatchEvent(new CustomEvent(EV.input, { detail: { text, send: !!opts.send, partial: !!opts.partial } }));
}
