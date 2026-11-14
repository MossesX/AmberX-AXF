/** Types for build-origin.mjs (build-origin@1: what Brett said that started a build). */
export const SCHEMA: 'build-origin@1';
export const SOURCES: Array<'voice' | 'chat' | 'console' | 'code'>;
export const SAID_HEADING: string;
export interface OriginAddendum { said: string; at: string; source: string; by: string; verbatim: boolean }
export interface BuildOrigin {
  said: string; at: string; source: '' | 'voice' | 'chat' | 'console' | 'code'; session: string; link: string; by: string;
  brief: string; verbatim: boolean; from: '' | 'brief' | 'detail' | 'notes' | 'threads' | 'report' | 'changes'; addenda: OriginAddendum[];
}
export function normSource(v: unknown): BuildOrigin['source'];
export function normOrigin(v: unknown): BuildOrigin | null;
export function mergeOrigin(a: unknown, b: unknown): BuildOrigin | null;
export function addAddendum(origin: unknown, ad: Partial<OriginAddendum>, now?: string): BuildOrigin | null;
export function dateOf(text: string, year?: string): string;
export function unquote(text: string): string;
export function parseBrief(text: string, opts?: { year?: string }): Omit<BuildOrigin, 'brief'> & { hasBlock: boolean };
export function fromText(text: string, opts?: { year?: string; strict?: boolean }): Pick<BuildOrigin, 'said' | 'at' | 'source' | 'verbatim' | 'session' | 'link' | 'by'> | null;
export function saidBlock(o?: { said?: string; source?: string; at?: string; session?: string; link?: string }): string;
export function addendumBlock(n: number, o: { said: string; source?: string; at?: string }): string;
export function briefHasSaid(text: string): boolean;
export function subtitle(origin: unknown, max?: number): string;
export function originText(origin: unknown): string;
export function searchText(origin: unknown): string;
