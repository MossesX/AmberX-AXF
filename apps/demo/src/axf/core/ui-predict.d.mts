/** Types for ui-predict.mjs (ui-prediction@1 + ui-mockup@1). Objects keep unknown fields. */
export type LookStatus = 'waiting' | 'approved' | 'changes' | 'rejected';
export type PredictionState = 'predicted' | 'real';
export type Role = 'before' | 'predicted' | 'real';
export interface MockupRow { label: string; on?: boolean; hint?: string }
export interface MockupBlock { type: 'settings' | 'toolbar' | 'chips' | 'actions' | 'list' | 'card' | 'dialog'; title: string; text?: string; items?: string[]; rows?: MockupRow[]; actions?: string[]; columns?: string[] }
export interface MockupScreen { id: string; app: string; title: string; search: string; blocks: MockupBlock[] }
export interface MockupSpec { $axf: 'ui-mockup@1'; build: string; title: string; screens: MockupScreen[]; demo: { rows: { name: string; status: string; updated: string }[] }; files?: number; cost?: Cost; at?: string }
export interface Cost { usd: number; model: string; tokens: number }
export interface Look { status: LookStatus; by?: string; at?: string; comment?: string }
export interface Addendum { at: string; by: string; text: string; sent: boolean }
export interface Prediction {
  $axf: 'ui-prediction@1'; build: string; state: PredictionState; hash: string; screens: { id: string; app: string; title: string }[];
  cost: Cost; look: Look; refreshes: number; predictedAt: string; refreshedAt: string; realAt?: string; addenda: Addendum[]; [k: string]: unknown;
}
export interface Verdict { go: boolean; wait: boolean; look: LookStatus | 'none'; reason: string }

export const PREDICTION_TAG: 'ui-prediction@1';
export const MOCKUP_TAG: 'ui-mockup@1';
export const MOCKUP_PARAM: string;
export const STATES: PredictionState[];
export const LOOK_STATUSES: LookStatus[];
export const ROLES: Role[];
export const COST_RULES: Cost;
export const SCREENS: (Omit<MockupScreen, 'blocks'> & { words: RegExp })[];
export const LOOK_DECISIONS: Record<'approve' | 'changes' | 'reject' | 'reopen', LookStatus>;
export function touchesUi(build: unknown, files?: string[]): boolean;
export function screensFor(build: unknown, files?: string[], opts?: { plugins?: Record<string, string>; screens?: unknown[] }): Omit<MockupScreen, 'blocks'>[];
export function labelsOf(text: string): string[];
export function blockFor(step: unknown): MockupBlock | null;
export function mockupSpec(build: unknown, opts?: { files?: string[]; plugins?: Record<string, string>; screens?: unknown[]; demo?: { rows: unknown[] }; at?: string }): MockupSpec;
export function specHash(spec: MockupSpec): string;
export function encodeScreen(spec: MockupSpec, screenId: string): string;
export function decodeScreen(param: string | null | undefined): MockupSpec | null;
export function capturePlan(spec: MockupSpec, opts?: { viewports?: string[]; before?: boolean; role?: 'predicted' | 'real' }): { name: string; path?: string; steps?: unknown[]; settle: number; viewports: string[] }[];
export function roleOf(src: string): Role;
export function newPrediction(spec: MockupSpec, opts?: { at?: string; cost?: Partial<Cost> }): Prediction;
export function predictionErrors(p: unknown): string[];
export function decideLook(p: Prediction, decision: string, opts?: { comment?: string; by?: string; at?: string }): Prediction;
export function lookVerdict(opts: { settings?: { waitForLook?: boolean }; touches?: boolean; item?: { prediction?: Prediction } | null }): Verdict;
export function addendumText(item: { prediction?: Prediction } | null): string;
export function toReal(p: Prediction, opts?: { at?: string }): Prediction;
