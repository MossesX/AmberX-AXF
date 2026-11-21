/** pass-approval@1 shared types (docs/contracts/pass-approval.md). Runtime: ./index.mjs (pure), ./node.mjs (signing). */

export type PassDecision = 'approve' | 'deny';
export type PassPushPhase = 'pending' | 'cleared';
export type PassActionId = 'pass.approve' | 'pass.deny' | 'pass.open';
export type PassActionCode = 'malformed' | 'unknown_pass' | 'wrong_pass' | 'expired' | 'not_pending' | 'decided' | 'bad_signature' | 'no_secret';
/** control-pass@1 states. */
export type PassState = 'pending' | 'active' | 'revoked' | 'expired' | 'lapsed' | 'denied';

export const PASS_APPROVAL_FRAME: 'pass-approval@1';
export const PASS_ACTION_TOKEN_FRAME: 'pass-action@1';
export const PASS_PUSH_FRAME: 'pass-push@1';
export const PASS_DECISIONS: readonly PassDecision[];
export const PASS_ACTION_IDS: { readonly approve: 'pass.approve'; readonly deny: 'pass.deny'; readonly open: 'pass.open' };
export const PASS_PUSH_PHASES: readonly PassPushPhase[];
export const PASS_TARGET_KIND: 'pass';
export const PASS_ROUTE: 'pass';
export const MOLLY_CONSOLE_APP: 'console';
export const DEFAULT_CONSOLE_URL: string;
export const DEFAULT_MOLLY_URL: string;
export const PASS_ID_RE: RegExp;
export const PASS_ACTION_TOKEN_PREFIX: 'pa1';
export const PASS_ACTION_NONCE_HEX: 16;
export const PASS_ACTION_SIG_HEX: 64;
export const PASS_ACTION_TOKEN_TTL_MS: number;
export const PASS_REQUEST_TTL_MS: number;
export const PASS_APPROVED_VIA_PUSH: 'push';
export const PASS_ACTION_CODES: Record<'malformed' | 'unknownPass' | 'wrongPass' | 'expired' | 'notPending' | 'decided' | 'badSignature' | 'noSecret', PassActionCode>;

/** The part of a control-pass@1 record / public view this contract reads. */
export interface PassLike {
  id: string;
  scope: string;
  state: PassState | string;
  minutes: number;
  reason?: string;
  requestedBy?: string;
  requestedAt?: string;
  label?: string;
  includeIrreversible?: boolean;
  include_irreversible?: boolean;
}

export interface LinkOptions { consoleUrl?: string; mollyUrl?: string }

/** The link fields every answer about a pass carries. No token in any of them. */
export interface PassLinks {
  deep_link: string;
  approve_url: string;
  deny_url: string;
  molly_url: string;
}

/** What pass_grant / POST pass/grant add to their result for a request. */
export interface PassGrantResultFields extends Partial<PassLinks> {
  /** `pass:<id>` for console_show / console_open */
  target?: string;
  /** one line Claude reads to Brett (pending only) */
  hand_over?: string;
}

export interface ActionTokenFields {
  id: string;
  decision: PassDecision;
  scope: string;
  minutes: number;
  includeIrreversible: boolean;
  /** epoch ms */
  exp: number;
  /** 16 hex */
  nonce: string;
}

export interface ParsedActionToken {
  id: string;
  decision: PassDecision;
  exp: number;
  nonce: string;
  /** 64 hex */
  sig: string;
}

/** Recorded on the pass when a token decided it (the replay guard's second half). */
export interface DecidedByToken { nonce: string; decision: PassDecision }

export interface PassPushAction {
  id: PassActionId;
  label: string;
  /** approve / deny: the action token (only place a token ever appears) */
  token?: string;
  /** open: the deep link */
  url?: string;
  /** true = post the token without opening the app */
  background: boolean;
}

/** pass-push@1 */
export interface PassPush {
  $axf: 'pass-push@1';
  type: 'pass';
  phase: PassPushPhase;
  id: string;
  scope: string;
  minutes: number;
  include_irreversible: boolean;
  requestedBy: string;
  requestedAt: string;
  deep_link: string;
  molly_url: string;
  target: string;
  title: string;
  body: string;
  state: string;
  /** pending only: when the tokens stop working */
  expiresAt?: string;
  actions: PassPushAction[];
}

export interface ParsedPassPush { phase: PassPushPhase; id: string; deep_link: string; title: string; body: string; actions: PassPushAction[] }

/** alert@1 input for the console's bell / notify gate. */
export interface PassAlertInput {
  source: 'pass';
  key: string;
  severity: 'warning';
  title: string;
  body: string;
  link: string;
  meta: Record<string, string | number>;
}

export interface ActionOk<P = unknown> { ok: true; $axf: 'pass-approval@1'; decision: PassDecision; already: boolean; pass: P | null; text: string }
export interface ActionFail<P = unknown> { ok: false; $axf: 'pass-approval@1'; code: PassActionCode; status: number; message: string; pass?: P }

export function isPassId(id: unknown): boolean;
export function isDecision(d: unknown): d is PassDecision;
export function passTarget(id: string): string;
export function parsePassTarget(target: string): string | null;
export function passDeepLink(id: string, opts?: LinkOptions): string;
export function passDecisionLink(id: string, decision: PassDecision, opts?: LinkOptions): string;
export function passMollyLink(id: string, opts?: LinkOptions, decision?: PassDecision | ''): string;
export function parsePassRoute(hash: string): { id: string; decision?: PassDecision } | null;
export function passLinks(id: string, opts?: LinkOptions): PassLinks;
export function passGrantResultFields(pass: PassLike, opts?: LinkOptions): PassGrantResultFields;
export function actionTokenExpiry(pass: PassLike, now: number): number;
export function actionTokenMessage(fields: ActionTokenFields): string;
export function actionTokenFields(pass: PassLike, decision: PassDecision, exp: number, nonce: string): ActionTokenFields;
export function formatActionToken(t: ParsedActionToken): string;
export function parseActionToken(token: string): ParsedActionToken | null;
export function actionTokenProblem(parsed: ParsedActionToken | null, pass: PassLike | null, now: number, stateAt?: string): PassActionCode | null;
export function actionTokenAlreadyUsed(parsed: ParsedActionToken | null, decidedBy: DecidedByToken | null | undefined): boolean;
export function passPushWords(pass: PassLike): { title: string; body: string };
export function passPushPayload(pass: PassLike, phase: PassPushPhase, tokens: { approve: string; deny: string } | null, opts?: LinkOptions): PassPush;
export function parsePassPush(raw: unknown): ParsedPassPush | null;
export function passAlertInput(pass: PassLike, opts?: LinkOptions): PassAlertInput;
export function actionResult<P>(decision: PassDecision, pass: P, already?: boolean, text?: string): ActionOk<P>;
export function actionProblem<P>(code: PassActionCode, pass?: P | null): ActionFail<P>;
