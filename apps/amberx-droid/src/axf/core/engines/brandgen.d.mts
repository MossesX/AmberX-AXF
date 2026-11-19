export function seededRandom(seed: number | string): () => number;
export function hashString(s: string): number;
export function hslToHex(h: number, s: number, l: number): string;
export function luminance(hex: string): number;
export function contrast(a: string, b: string): number;
export function seededPalette(rnd: () => number): { brand1: string; brand2: string; brand3: string };
export const CONTAINERS: Record<string, string>;
export const MOTIFS: Record<string, { d: string; stroke?: number; fill?: boolean; opacity?: number; color?: string; over?: boolean }[]>;
export interface GeneratedAsset { $axf: 'asset@1'; type: string; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: Record<string, unknown> & { palette?: { brand1: string; brand2: string; brand3: string } } }
export function generateMark(seed: number | string, opts?: { brand?: string; form?: string; palette?: { brand1: string; brand2: string; brand3: string }; id?: string }): GeneratedAsset;
export function generateAnimated(seed: number | string, markIds: string | string[], opts?: { preset?: string; id?: string }): GeneratedAsset;
export function generateIconPack(seed: number | string, base: unknown, opts?: { style?: string; id?: string }): GeneratedAsset;
export function assetErrors(a: { type: string; data: unknown }): string[];
