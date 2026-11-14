// Types for refs.mjs (ref@1: mentions of real things in text → links that open them).
export type RefKind = 'screen' | 'settings' | 'dialog' | 'plugin' | 'toolbar' | 'menu' | 'section' | 'setting' | 'component' | 'build' | 'pr' | 'agent' | 'note' | 'file' | 'action' | 'window' | (string & {});
export interface RefTarget {
  id: string; kind: RefKind; label: string; aliases?: string[]; detail?: string; icon?: string;
  /** what opening it brings into focus (engines/search.ts SearchFocus) */
  focus?: { kind: string; [k: string]: unknown };
  url?: string; status?: string;
  /** for builds: the refs it declares it is changing */
  touches?: string[];
  /** for builds: its UI Review items (id, name, status, url) */
  reviews?: { id?: string; name?: string; status?: string; [k: string]: unknown }[];
}
export interface RefSpan {
  start: number; end: number; text: string; ref: string; kind: RefKind;
  via: 'explicit' | 'id' | 'label' | 'alias' | 'pattern';
  ambiguous?: boolean; candidates?: string[]; missing?: boolean; unknown?: boolean;
}
export interface RefResult { $axf: 'ref@1'; text: string; spans: RefSpan[]; refs: string[] }
export interface RefIndex { byId: Map<string, RefTarget>; phrases: { phrase: string; caseSensitive: boolean; spellings: Set<string>; ids: { id: string; via: string }[] }[] }
export interface RefPeek { ref: string; kind: RefKind; label: string; detail: string; state: 'live' | 'changing' | 'new' | 'link' | 'missing'; line: string; changing: { id: string; label: string }[]; candidates: { id: string; kind: RefKind; label: string; detail: string }[] }

export const REF_FRAME: 'ref@1';
export const REF_KINDS: readonly string[];
export const REF_KIND_WORDS: Record<string, string>;
export const REF_STOP_WORDS: Set<string>;
export const REF_MIN_LETTERS: number;
export function refId(raw: unknown): string;
export function normalizeRefTarget(raw: unknown): RefTarget | null;
export function refTargetFromSearch(e: unknown): RefTarget | null;
export function refTargetFromBuild(b: unknown): RefTarget | null;
export function refIndex(targets: readonly unknown[]): RefIndex;
export function parseTouches(text: string): { id: string; start: number; end: number }[];
export function findRefs(text: string, index: RefIndex | readonly unknown[], opts?: { explicit?: string[]; files?: string[]; prs?: (string | number)[] }): RefResult;
export function refSegments(text: string, spans: readonly RefSpan[]): { text: string; span?: RefSpan }[];
export function resolveRef(index: RefIndex | readonly unknown[], query: string): { target?: RefTarget; ambiguous?: boolean; candidates?: RefTarget[]; missing?: boolean; unknown?: boolean; query?: string; id?: string };
export function refChangedBy(id: string, builds: readonly RefTarget[]): RefTarget[];
export function refPeek(span: Partial<RefSpan>, index: RefIndex | readonly unknown[], builds?: readonly RefTarget[]): RefPeek;
