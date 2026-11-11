/**
 * The assistant inside a host app (build ai-assistant-in-molly-console-drives-by-api-open, Nov 10 2026): Molly runs the
 * console in a frame and has an AI assistant plugin of its own that frames this plugin's chat page
 * (`?axf-embed=molly&axf-embed-page=view:ai-assistant`). The host owns the assistant there, so the console never draws a
 * second copy: the host says so with an `owned` message, and from then on "open the assistant" here (the action, the
 * app menu, the nav item, ai.chat.start) asks the host instead of opening the dialog in this frame.
 *
 * Plugin-to-plugin protocol over postMessage, `ai-assistant-host@1`; neither side imports the other:
 *   host → console frame   { $axf, type: 'owned', on }                      the host shows the assistant itself
 *   console frame → host   { $axf, type: 'open', start?, note? }           open it there (start = ai.chat.start payload)
 *   host → chat page       { $axf, type: 'start', start?, note? }          the page the host frames: start that chat
 *   host → chat page       { $axf, type: 'hands-free', toggle?, on? }      flip the hands-free switch
 * Only messages from `window.parent` count, and the host's origin is remembered from its first `owned` message.
 */
import { useSyncExternalStore } from 'react';
import { setHandsFree } from './handsfree';

export const HOST_MESSAGE = 'ai-assistant-host@1';
export const PAGE_MARKER = 'axf-embed-page=view:ai-assistant';

export interface HostStart { agentId?: string; message: string; title?: string; profileId?: string; model?: string }
export type HostMessage =
  | { $axf: typeof HOST_MESSAGE; type: 'owned'; on: boolean }
  | { $axf: typeof HOST_MESSAGE; type: 'open'; start?: HostStart; note?: string }
  | { $axf: typeof HOST_MESSAGE; type: 'start'; start?: HostStart; note?: string }
  | { $axf: typeof HOST_MESSAGE; type: 'hands-free'; toggle?: boolean; on?: boolean };

/** Is this page the assistant page a host frames on its own? (then it is the owned copy and never asks the host) */
export const isAssistantPage = (): boolean => typeof location !== 'undefined' && location.search.includes(PAGE_MARKER);

let owned = false;
let hostOrigin = '';
const subs = new Set<() => void>();
export const hostOwned = (): boolean => owned;
export function onHostOwned(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
export const useHostOwned = (): boolean => useSyncExternalStore(onHostOwned, hostOwned, hostOwned);

/** Parse a message from the host; null when it isn't one. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.$axf !== HOST_MESSAGE || typeof o.type !== 'string') return null;
  switch (o.type) {
    case 'owned': return { $axf: HOST_MESSAGE, type: 'owned', on: o.on !== false };
    case 'open': case 'start': {
      const out: HostMessage = { $axf: HOST_MESSAGE, type: o.type };
      const s = o.start as Record<string, unknown> | undefined;
      if (s && typeof s.message === 'string' && s.message) {
        out.start = { message: s.message.slice(0, 8000) };
        for (const k of ['agentId', 'title', 'profileId', 'model'] as const) if (typeof s[k] === 'string' && s[k]) out.start[k] = (s[k] as string).slice(0, 200);
      }
      if (typeof o.note === 'string' && o.note) out.note = o.note.slice(0, 2000);
      return out;
    }
    case 'hands-free': return { $axf: HOST_MESSAGE, type: 'hands-free', ...(o.toggle === true ? { toggle: true } : {}), ...(typeof o.on === 'boolean' ? { on: o.on } : {}) };
    default: return null;
  }
}

/** Ask the host to open the assistant (returns false when no host owns it: open it here). */
export function openInHost(payload: { start?: HostStart; note?: string } = {}): boolean {
  if (!owned || isAssistantPage() || typeof window === 'undefined' || window.parent === window) return false;
  window.parent.postMessage({ $axf: HOST_MESSAGE, type: 'open', ...payload }, hostOrigin || '*');
  return true;
}

let started = false;
/**
 * Listen to the host (once per page). `onStart` runs on the chat page when the host hands it a chat to start;
 * the hands-free message flips the server switch from here (the page that has the microphone).
 */
export function startHostBridge(onStart: (m: { start?: HostStart; note?: string }) => void): void {
  if (started || typeof window === 'undefined' || window.parent === window) return;
  started = true;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const m = parseHostMessage(e.data);
    if (!m) return;
    if (m.type === 'owned') {
      hostOrigin = e.origin;
      if (owned !== m.on) { owned = m.on; subs.forEach((f) => f()); }
    } else if (m.type === 'start' && isAssistantPage()) onStart({ start: m.start, note: m.note });
    else if (m.type === 'hands-free' && isAssistantPage()) void setHandsFree(m.toggle ? { toggle: true } : { on: m.on !== false }).catch(() => undefined);
  });
}
