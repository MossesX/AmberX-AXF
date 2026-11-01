/**
 * Who asked (axHub decision 108): every approval the hub lists carries `source` — where the call came from (Claude.ai,
 * Claude Code, a headless build, the console, an agent, the hub itself) and who (the session, build or agent name).
 * Brett, Nov 1 2026: "every approval just says vps.run" — this is the WHO next to the WHAT (the reason title).
 *
 * The hub sends `source: { kind, label, who, session?, client?, clientVersion?, auth?, oauthClient? }`; it is the caller's
 * word (shown, never used for access). Older hubs send none: {@link parseSource} answers null and nothing is drawn.
 * Pure: Node tests import this file directly (`framework/spec/check-approvals.mts`).
 */

export type HubSourceKind = 'claude_ai' | 'claude_code' | 'headless' | 'console' | 'agent' | 'system' | 'unknown';

export interface HubSource {
  kind: HubSourceKind;
  /** Badge words: Claude.ai, Claude Code, Headless, Console, Agent, System, Unknown. */
  label: string;
  /** Session, build or agent name; else the client; else the label. */
  who: string;
  /** "claude-code 2.1.3" ('' when the hub didn't say). */
  client: string;
}

export const HUB_SOURCE_KINDS: readonly HubSourceKind[] = ['claude_ai', 'claude_code', 'headless', 'console', 'agent', 'system', 'unknown'];

export const HUB_SOURCE_LABELS: Record<HubSourceKind, string> = {
  claude_ai: 'Claude.ai', claude_code: 'Claude Code', headless: 'Headless', console: 'Console', agent: 'Agent', system: 'System', unknown: 'Unknown',
};

/** Chip tone per source (theme tokens through the framework Chip): people-driven sources neutral, unattended ones marked. */
export const HUB_SOURCE_TONE: Record<HubSourceKind, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  claude_ai: 'accent', claude_code: 'accent', headless: 'warning', console: 'success', agent: 'warning', system: undefined, unknown: undefined,
};

/** Icons from the framework icon pack. */
export const HUB_SOURCE_ICON: Record<HubSourceKind, string> = {
  claude_ai: 'sparkles', claude_code: 'terminal', headless: 'hammer', console: 'monitor', agent: 'user', system: 'settings', unknown: 'help',
};

const CAP = 60;
const line = (v: unknown, cap: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap) : '');

/** The `source` of one feed or API entry, made safe to show; null when there is none or its kind is unknown to us. */
export function parseSource(v: unknown): HubSource | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const kind = typeof o.kind === 'string' && (HUB_SOURCE_KINDS as readonly string[]).includes(o.kind) ? (o.kind as HubSourceKind) : null;
  if (!kind) return null;
  const label = HUB_SOURCE_LABELS[kind];
  const client = [line(o.client, 80), line(o.clientVersion, 40)].filter(Boolean).join(' ');
  const who = line(o.who, CAP) || line(o.session, CAP) || line(o.oauthClient, CAP) || line(o.client, CAP) || label;
  return { kind, label, who, client };
}

/** "Headless · approval-source", or just the label when `who` adds nothing. */
export const sourceText = (s: HubSource | null | undefined): string => (!s ? '' : s.who && s.who !== s.label ? `${s.label} · ${s.who}` : s.label);

/** Sort key for a source column: label then who (so every Headless row sits together, by build name). */
export const sourceSortKey = (s: HubSource | null | undefined): string => (s ? `${s.label}\u0000${s.who.toLowerCase()}` : '\uffff');
