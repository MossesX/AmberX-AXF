/** What the hub's `/auth/api/approvals*` routes answer (axHub `approvals-web.ts`). */

export type ApprovalAction = 'approve' | 'decline' | 'postpone' | 'ignore' | 'revoke' | 'reopen';

export interface ApprovalItem {
  id: string;
  tool: string;
  summary: string;
  args: string;
  /** The summary fits on one line, so a row shows the complete call and may carry Approve. */
  whole: boolean;
  /** What is being approved: the caller's one-line title, else "Run <tool>" (axHub decision #99). */
  title: string;
  /** True when the title and description are the caller's own words (a claim: the code below is what runs). */
  reasonGiven: boolean;
  /** What it does and why, in the caller's words. */
  description?: string;
  /** The tool's own description, from the hub. */
  toolDescription?: string;
  effect: 'destructive' | 'read-only' | 'changes';
  /** The exact call: arguments pretty-printed (printable characters only), and the shell command when there is one. */
  code: { service: string; tool: string; qualified: string; arguments: string; command?: string };
  status: string;
  statusLabel: string;
  reviewRequired: boolean;
  actions: ApprovalAction[];
  revision: number;
  callerId: string;
  createdAt: string;
  expiresAt: string;
  showExpires: boolean;
  decidedBy?: string;
  postponed?: { kind: string; waitingFor: string; until?: string; since: string; lastCheck?: string; lastNote?: string; nextReminder?: string; reminders: number };
  /** Run unless blocked (axHub decision 102): the hub runs it by itself at `runAt` unless declined. */
  veto?: { alarmAt: string; runAt: string; alarmed: boolean; countdownSec: number; graceSec: number };
  /** The hub keeps the call and runs it itself once approved (axHub decision 101). */
  held?: boolean;
  history: { at: string; from: string; to: string; by: string; note?: string }[];
}

export interface AutoState {
  available: boolean;
  minutes: number[];
  window?: { id: string; until: string; minutes: number; by: string; approvedCount: number };
}

export interface ApprovalGrid {
  filters: { id: string; label: string }[];
  filter: string;
  page: number;
  pages: number;
  total: number;
  waiting: number;
  postponed: number;
  items: ApprovalItem[];
  auto: AutoState;
  log: boolean;
}

export interface PostponeOptions {
  item: ApprovalItem;
  allowed: boolean;
  deadline: string;
  maxDays: number;
  presets: { minutes: number; label: string }[];
  units: string[];
  conditions: { kind: string; label: string; built: boolean; params: { name: string; label: string; placeholder?: string }[] }[];
}

export interface ActionReply { ok: true; result: string; message: string; item: ApprovalItem }

export const ACTION_LABELS: Record<ApprovalAction, string> = {
  approve: 'Approve', decline: 'Decline', postpone: 'Postpone…', ignore: 'Ignore', revoke: 'Revoke', reopen: 'Reopen',
};

export const EFFECT_LABEL: Record<ApprovalItem['effect'], string> = { destructive: 'Can delete or break things', 'read-only': 'Only reads', changes: 'Changes things' };
export const EFFECT_TONE: Record<ApprovalItem['effect'], 'danger' | 'success' | 'warning'> = { destructive: 'danger', 'read-only': 'success', changes: 'warning' };

export const STATUS_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  pending: 'accent', approved: 'success', consumed: 'success', rejected: 'danger', revoked: 'danger', postponed: 'warning', ignored: undefined, expired: undefined,
};
