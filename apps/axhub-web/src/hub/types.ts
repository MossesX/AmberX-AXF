/** What the hub's `/auth/api/approvals*` routes answer (axHub `approvals-web.ts`). */

export type ApprovalAction = 'approve' | 'decline' | 'postpone' | 'ignore' | 'revoke' | 'reopen';

export interface ApprovalItem {
  id: string;
  tool: string;
  summary: string;
  args: string;
  /** The summary fits on one line, so a row shows the complete call and may carry Approve. */
  whole: boolean;
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

export const STATUS_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  pending: 'accent', approved: 'success', consumed: 'success', rejected: 'danger', revoked: 'danger', postponed: 'warning', ignored: undefined, expired: undefined,
};
