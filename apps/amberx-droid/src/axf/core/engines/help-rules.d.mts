// Types for help-rules.mjs (help@1 + Help mode; shared by the TS engine, the React Help layer, the build engine and the coverage CLI).
export type HelpKind = 'button' | 'menu-item' | 'toggle' | 'slider' | 'tab' | 'column' | 'banner' | 'card' | 'field' | 'link' | 'nav' | 'screen' | 'menu' | 'control';
export interface HelpLink { label: string; href: string }
export interface HelpEntry {
  id: string;
  /** the help id of the control or screen this explains */
  target: string;
  title: string;
  /** plain English: what it does, when to use it, what happens if you tap it */
  text: string;
  /** the longer explanation the "What is this?" panel shows */
  more?: string;
  /** one thing to try */
  tryIt?: string;
  link?: HelpLink;
  /** related help ids; `view:<id>` ones open that screen */
  related?: string[];
  kind?: HelpKind;
  /** drafted from the code, not yet edited by hand */
  draft?: boolean;
}
export interface HelpIntroStep { say: string; target: string; do: string; title?: string }
export interface HelpIntro { screen: string; title: string; steps: HelpIntroStep[] }
export interface HelpPackData { scope?: string; entries?: unknown[]; intros?: unknown[] }
export interface HelpPack { scope: string; entries: HelpEntry[]; intros: HelpIntro[] }
export interface HelpIndex { byTarget: Map<string, HelpEntry & { pack: string }>; intros: Map<string, HelpIntro & { pack: string }> }
export interface HelpDescriptor { help?: string; action?: string; view?: string; banner?: string; menu?: string; column?: boolean; label?: string; screen?: string }
export interface HelpControl { id: string; lookup: string[]; kind?: string; label?: string; file?: string }
export interface HelpCoverage { total: number; covered: number; written: number; drafts: number; missing: HelpControl[]; percent: number }

export const HELP_FRAME: 'help@1';
export const HELP_MODE_KEY: string;
export const HELP_INTROS_KEY: string;
export const HELP_SEEN_KEY: string;
export const HELP_ACTIONS: { mode: string; resetIntros: string; explain: string };
export const HELP_SHORTCUTS: readonly string[];
export const HELP_VOICE: { on: readonly string[]; off: readonly string[] };
export const HELP_LIMITS: Record<string, number>;
export const HELP_KINDS: readonly HelpKind[];
export const HELP_CONTROL_SELECTOR: string;
export function slugLabel(label: unknown): string;
export function helpTarget(desc: HelpDescriptor): { id: string | null; lookup: string[] };
export function helpIdFor(desc: HelpDescriptor): string | null;
export function normalizeHelpEntry(raw: unknown): HelpEntry | null;
export function normalizeHelpIntro(raw: unknown): HelpIntro | null;
export function normalizeHelpPack(raw: unknown): HelpPack;
export function helpErrors(type: string, raw: unknown): string[];
export function buildHelpIndex(packs: readonly ({ id?: string; data: unknown } | unknown)[]): HelpIndex;
export function resolveHelp(index: HelpIndex, lookup: readonly string[]): (HelpEntry & { pack: string }) | null;
export function introFor(index: HelpIndex, screen: string): (HelpIntro & { pack: string }) | null;
export function parseSeen(v: unknown): string[];
export function markSeen(v: unknown, screen: string): string[];
export function introToShow(o: { mode: boolean; intros?: boolean; seen: unknown; screen: string; index: HelpIndex }): (HelpIntro & { pack: string }) | null;
export function introToWalkthrough(intro: HelpIntro, app?: string): { $axf: 'walkthrough@1'; id: string; title: string; app: string; steps: { say: string; do: string; target: string }[] };
export function helpCoverage(controls: readonly HelpControl[], index: HelpIndex): HelpCoverage;
export function ratchetErrors(current: Record<string, { percent: number; covered: number; written?: number }>, baseline: Record<string, { percent: number; covered: number; written?: number }>): string[];
