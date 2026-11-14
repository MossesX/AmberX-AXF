/**
 * Claude mode in the page (wake-listener; build voice-listener-use-claude-when-connected, Nov 14 2026).
 *
 * Brett: "can we have a setting to make it use Claude if Claude's connected". With the setting on, a command goes to
 * the plugin's understand route first (server/claude_intent.py: Claude through axf.llm@1 picks the catalog entry and
 * fills its fields). Its question or confirm prompt is spoken and the answers loop back with `pending`. Offline, a
 * timeout or any error hands the same transcript to the scripted matcher and wizard (web/flow.ts), unchanged.
 *
 * Never here: approve / deny. Those words keep the scripted approvals path (the review, lib-approvals and the
 * approvals-banner relay); the server refuses them too.
 */
import { pluginFetch } from '@console/plugins';
import { FOLDER } from '../core.mjs';

export type Mode = 'claude' | 'scripted';
/** Why the scripted matcher handled a command while Claude mode was on (the server's reasons plus the page's own). */
export type FallbackReason = 'off' | 'approvals' | 'no-llm' | 'not-claude' | 'cooldown' | 'timeout' | 'error' | 'no-credit' | 'no-command' | 'refused' | 'unknown-command' | 'network' | '';

export interface Pending { command: string; tool: string; args: Record<string, string>; missing: string[]; ask?: string; confirm?: boolean; first: string }
export interface ClaudeAnswer {
  ok: boolean;
  mode: 'claude' | 'offline';
  reason?: FallbackReason;
  message?: string;
  command?: string;
  args?: Record<string, string>;
  missing?: string[];
  ask?: string;
  confirm?: boolean;
  cancelled?: boolean;
  run?: boolean;
  prompt?: string;
  pending?: Pending;
}

export { APPROVAL_WORDS, claudeGate } from '../core.mjs';

export const REASON_LABEL: Record<string, string> = {
  off: 'Claude mode off', approvals: 'approvals stay spoken', 'no-llm': 'no AI assistant', 'not-claude': 'not a Claude model', cooldown: 'Claude failed a moment ago',
  timeout: 'Claude too slow', error: 'Claude unreachable', 'no-credit': 'Claude out of credits', 'no-command': 'Claude picked nothing', refused: 'Claude pick refused',
  'unknown-command': 'Claude picked an unknown command', network: 'console unreachable', untested: 'not tried yet',
};

const offline = (reason: FallbackReason, message = ''): ClaudeAnswer => ({ ok: true, mode: 'offline', reason, message });

/**
 * One call to the understand route. The page waits a little longer than the server's own timeout (the server answers
 * `timeout` itself); past that, or on any error, the answer is offline and the caller goes scripted.
 */
export async function understand(text: string, opts: { timeoutSec: number; pending?: Pending | null; context?: Record<string, unknown> }): Promise<ClaudeAnswer> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), (Math.max(2, opts.timeoutSec) + 3) * 1000);
  try {
    const r = await pluginFetch(FOLDER, 'understand', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...(opts.pending ? { pending: opts.pending } : {}), ...(opts.context ? { context: opts.context } : {}) }), signal: ctl.signal });
    const j = (await r.json().catch(() => ({}))) as ClaudeAnswer;
    if (!r.ok || !j || (j.mode !== 'claude' && j.mode !== 'offline')) return offline('error', (j as { message?: string })?.message || `The console answered ${r.status}.`);
    return j;
  } catch (e) {
    return offline((e as Error).name === 'AbortError' ? 'timeout' : 'network', (e as Error).message);
  } finally { clearTimeout(timer); }
}

/** Where Brett is, for Claude's context (the screen only; nothing else from the page). */
export function pageContext(): Record<string, unknown> {
  if (typeof location === 'undefined') return {};
  return { screen: `${location.pathname}${location.hash}`.slice(0, 120) };
}
