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
  history: { at: string; from: string; to: string; by: string; note?: string }[];
  /**
   * Held commands (veto@1): `status: "held"`, run by the hub when the countdown ends unless denied. Since axHub decision
   * 104 also Approve now (run at once) and Shelve (`state: "shelved"`: the countdown paused until he decides); `actions`
   * is what applies now (absent on an older hub: Deny only).
   */
  veto?: { runsAt: string; secondsLeft: number; countdownSeconds: number; state?: string; approvedNow?: boolean; actions?: ('deny' | 'approve-now' | 'shelve')[] };
  jobId?: string;
  denyUrl?: string;
  streamUrl?: string;
  /**
   * Who asked (axHub decision 108): `kind` + badge `label` (Claude.ai / Claude Code / Headless / Console / Agent /
   * System / Unknown), `who` (session, build or agent name), the MCP client. Absent on an older hub.
   */
  source?: ApprovalSourceView;
}

export interface ApprovalSourceView {
  kind: string;
  label: string;
  who: string;
  session?: string;
  client?: string;
  clientVersion?: string;
  auth?: string;
  oauthClient?: string;
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
  /** Pending requests only: held veto calls are `heldCount` (add both for what waits, `waitingCount`). */
  waiting: number;
  heldCount?: number;
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
  pending: 'accent', held: 'warning', running: 'accent', ran: 'success', failed: 'danger', denied: undefined, approved: 'success', consumed: 'success', rejected: 'danger', revoked: 'danger', postponed: 'warning', ignored: undefined, expired: undefined,
};

/** Source badge tones (axHub decision 108): people-driven sources accent, unattended ones warning, the console success. */
export const SOURCE_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  claude_ai: 'accent', claude_code: 'accent', headless: 'warning', console: 'success', agent: 'warning', system: undefined, unknown: undefined,
};
