// Types for draft.mjs (feature-matrix plugin helpers).
import type { BuildRef, ItemInput, State } from './fm-core.mjs';
export interface Tables { builds?: any[]; pending?: any[]; queue?: any; features?: any[]; change?: any }
export function stepTag(text: string): string;
export function fromDraft(raw: unknown, builds?: any[], now?: string): State;
export function titleFor(ref: BuildRef, t: Tables): string;
export function seedItems(ref: BuildRef, t: Tables, now?: string): ItemInput[];
export function targetsFor(ref: BuildRef, t: Tables): { build?: any; pending?: any; queue?: any; feature?: any; change?: any };
export function openBuilds(builds: any[]): any[];
