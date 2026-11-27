// Types for demo-rules.mjs (demonstration@1, book@1, clip@1, docs@1; shared by the TS engines, the build engine, the console plugin and the CLI).
export type DemoSurface = 'live' | 'preview' | 'recorder';
export type GeneratedFrom = 'glossary' | 'manual' | 'book' | 'help-intro' | 'recorder';
export type BookStyle = 'quickstart' | 'tutorial' | 'tour' | 'reference' | 'deep-dive';
export type DocsDepth = 'light' | 'standard' | 'deep' | 'extreme';
export type DocsFormat = 'markdown' | 'html' | 'interactive-html-ts';
export type DocsInteractive = 'none' | 'examples' | 'live';
export type ClipKind = 'clip' | 'demo' | 'chapter' | 'walkthrough' | 'video';
export type SourceKind = 'entry' | 'demonstration' | 'book' | 'chapter' | 'walkthrough' | 'manual';
export type DocsSourceKind = 'book' | 'demonstration' | 'entries';
export type DocsFileKind = 'index' | 'page' | 'asset' | 'script' | 'style' | 'data' | 'media';

export interface DemoStep { id?: string; say: string; do: string; target: string; title?: string; highlight?: string; wait?: number }
export interface WalkthroughStep { say: string; do: string; target: string }
export interface Walkthrough { $axf: 'walkthrough@1'; id: string; title: string; app: string; steps: WalkthroughStep[]; source?: string }

export interface DemonstrationData {
  about: string;
  entries: string[];
  app: string;
  surface: DemoSurface;
  steps: DemoStep[];
  voice: { narrator: string; speed: number };
  chain: string[];
  keywords: string[];
  generated: { from: GeneratedFrom; at: string; build: string };
  editable: boolean;
}
export interface BookItem { ref: string; minutes?: number; note?: string }
export interface BookChapter { id: string; title: string; minutes: number; intro: string; items: BookItem[]; collapsed: boolean }
export interface DocsOptions { enabled: boolean; depth: DocsDepth; format: DocsFormat; interactive: DocsInteractive; includeApi: boolean; includeScreens: boolean }
export interface BookData {
  about: string;
  plan: { totalMinutes: number; chapterMinutes: number; style: BookStyle; theme: string; narrator: string; speed: number };
  chapters: BookChapter[];
  docs: DocsOptions;
  outputs: { video: boolean; chapterClips: boolean };
  keywords: string[];
}
export interface ClipData {
  kind: ClipKind;
  source: { kind: SourceKind; id: string; chapter: string };
  media: { video: string; poster: string; captions: string; audio: string; seconds: number; width: number; height: number };
  recorded: { at: string; app: string; url: string; viewport: { width: number; height: number }; designPackage: string; voice: string };
  transcript: { at: number; say: string }[];
  chain: string[];
  entries: string[];
  keywords: string[];
}
export interface DocsFile { path: string; kind: DocsFileKind; title: string; bytes: number }
export interface DocsData {
  source: { kind: DocsSourceKind; id: string; entries: string[] };
  depth: DocsDepth;
  format: DocsFormat;
  interactive: DocsInteractive;
  files: DocsFile[];
  generatedAt: string;
  sourceHash: string;
  build: string;
  keywords: string[];
}
/** A glossary-catalog@1 entry as the generator reads it. */
export interface GlossaryEntryLike {
  id: string; term: string; kind: string; category: string; summary: string; detail?: string; app?: string; plugin?: string;
  where?: string[]; api?: { kind: string; name: string }[]; related?: string[]; children?: string[]; keywords?: string[]; tags?: string[];
}
export interface DemoAssetLike<T> { id: string; name: string; description?: string; data: T }
export interface ParsedRef { kind: 'entry' | 'demonstration' | 'clip' | 'book'; id: string; chapter: string; ref: string }
export interface OutlineItem { key: string; ref: string; kind: string; label: string; minutes: number; note: string }
export interface OutlineChapter { key: string; label: string; minutes: number; collapsed: boolean; count: number; children: OutlineItem[] }
export interface OutlineBook { key: string; label: string; minutes: number; count: number; children: OutlineChapter[] }

export const DEMONSTRATION_TYPE: 'demonstration';
export const BOOK_TYPE: 'book';
export const CLIP_TYPE: 'clip';
export const DOCS_TYPE: 'docs';
export const DEMO_TYPES: readonly string[];
export const WALKTHROUGH_FRAME: 'walkthrough@1';
export const DEMO_ENUMS: {
  surface: readonly DemoSurface[]; generatedFrom: readonly GeneratedFrom[]; bookStyle: readonly BookStyle[]; docsDepth: readonly DocsDepth[];
  docsFormat: readonly DocsFormat[]; docsInteractive: readonly DocsInteractive[]; clipKind: readonly ClipKind[]; sourceKind: readonly SourceKind[];
  docsSource: readonly DocsSourceKind[]; fileKind: readonly DocsFileKind[];
};
export const DEMO_LIMITS: Record<string, number | [number, number]>;
export const DEMO_WPM: number;
export const STEP_PAUSE_S: number;
export const DEMONSTRATION_DEFAULTS: DemonstrationData;
export const BOOK_DEFAULTS: BookData;
export const CLIP_DEFAULTS: ClipData;
export const DOCS_DEFAULTS: DocsData;
export const DOCS_DEPTH_ABOUT: Record<DocsDepth, string>;
export function safePath(p: unknown): boolean;
export function slugify(s: unknown, fallback?: string): string;
export function autoKeywords(parts: unknown, max?: number): string[];
export function wordCount(s: unknown): number;
export function parseRef(ref: unknown): ParsedRef | null;
export function makeRef(kind: ParsedRef['kind'], id: string, chapter?: string): string;
export function stepsSeconds(steps: unknown, wpm?: number): number;
export function demonstrationErrors(raw: unknown): string[];
export function normalizeDemonstration(raw: unknown): DemonstrationData;
export function demonstrationSeconds(data: unknown): number;
export function demonstrationToWalkthrough(asset: DemoAssetLike<unknown>): Walkthrough;
export function helpTargetOf(entry: unknown): string;
export function viewOf(entry: unknown, lookup?: (id: string) => GlossaryEntryLike | undefined | null): string;
export function demonstrationFromEntry(entry: GlossaryEntryLike, opts?: { lookup?: (id: string) => GlossaryEntryLike | undefined | null; at?: string; build?: string; app?: string }): DemoAssetLike<DemonstrationData> & { description: string };
export function demonstrationKeywords(entry: unknown, steps?: unknown[]): string[];
export function docsOptionErrors(d: unknown, where?: string, requireAll?: boolean): string[];
export function bookErrors(raw: unknown): string[];
export function normalizeDocsOptions(d: unknown, defaults?: Partial<DocsOptions>): DocsOptions;
export function normalizeBook(raw: unknown): BookData;
export function bookPlan(opts?: { totalMinutes?: number; chapterMinutes?: number; count?: number }): { count: number; totalMinutes: number; chapterMinutes: number; minutes: number[] };
export function newBook(opts?: { title?: string; about?: string; totalMinutes?: number; chapterMinutes?: number; count?: number; style?: BookStyle; theme?: string; narrator?: string; speed?: number; docs?: Partial<DocsOptions>; outputs?: Partial<BookData['outputs']> }): BookData;
export function bookMinutes(data: unknown): { total: number; chapters: { id: string; title: string; minutes: number; items: { ref: string; minutes: number }[] }[] };
export function moveItem(data: unknown, from: { chapter: string; index: number }, to: { chapter: string; index?: number }): BookData;
export function moveChapter(data: unknown, fromIndex: number, toIndex: number): BookData;
export function addItem(data: unknown, chapterId: string, ref: string, index?: number): BookData;
export function bookOutline(books: DemoAssetLike<unknown>[], resolve?: (ref: string) => { title?: string } | undefined | null): OutlineBook[];
export function bookToWalkthrough(asset: DemoAssetLike<unknown>, resolve?: (ref: string) => { title?: string; steps?: unknown[] } | undefined | null, opts?: { maxSteps?: number }): Walkthrough;
export function clipErrors(raw: unknown): string[];
export function normalizeClip(raw: unknown): ClipData;
export function clipKeywords(parts?: { kind?: string; source?: { kind?: string; id?: string; chapter?: string }; entries?: GlossaryEntryLike[]; steps?: unknown[]; transcript?: { say?: string }[]; recorded?: Partial<ClipData['recorded']>; extra?: unknown[] }): string[];
export function clipFromDemonstration(asset: DemoAssetLike<unknown>, media?: Partial<ClipData['media']>, recorded?: Partial<ClipData['recorded']>, opts?: { entries?: GlossaryEntryLike[]; kind?: ClipKind; at?: string }): DemoAssetLike<ClipData> & { description: string };
export function docsErrors(raw: unknown): string[];
export function normalizeDocs(raw: unknown): DocsData;
export function docsPlan(options: unknown, chapters?: unknown[]): { depth: DocsDepth; format: DocsFormat; interactive: DocsInteractive; files: { path: string; kind: DocsFileKind; title: string }[] };
export function demoAssetErrors(type: string, raw: unknown): string[];
export function normalizeDemoAsset(type: string, raw: unknown): DemonstrationData | BookData | ClipData | DocsData | Record<string, unknown>;
export function demoSchemaProperties(type: string): Record<string, unknown>;
