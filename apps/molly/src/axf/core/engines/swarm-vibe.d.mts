// Types for swarm-vibe.mjs (the group chat's vibe engine; shared by the console plugin, the CLI and the checks).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ChatSettings, SwarmState } from './swarm-rules.mjs';
export { DEFAULT_PRESET, PRESETS, SLIDERS, VIBE } from './swarm-rules.mjs';
export interface VibeMessage { from: string; kind: string; text: string; jobId?: string; vibe?: number | null; toned?: boolean; dropped?: boolean; seed?: string }
export const ACRONYMS: RegExp;
export const VIBE_WORDS: { cuss: { re: RegExp; level: 1 | 2; clean: (m: string) => string }[]; sarcasm: RegExp[]; drama: RegExp[]; slang: RegExp[]; identity: RegExp };
export const VIBE_WEIGHTS: { work: number; banter: number; cussStrong: number; cussMild: number; shout: number; bang: number; bangMax: number; sarcasm: number; drama: number; slang: number };
export const VIBE_LEVELS: { cussStrong: number; cussMild: number; chatty: [number, number]; drama: number; paidBanter: number };
export const VIBE_SHADE_MIN: number;
export const PREVIEW_LINES: { wild: string; mid: string; chill: string };
export function settingsFor(cs: ChatSettings, from: string): ChatSettings;
export function scoreVibe(text: string, kind?: string): number;
export function cleanCussing(text: string, cussing: number): string;
export function calmDown(text: string): string;
export function vibeFilter(msg: VibeMessage, cs: ChatSettings): VibeMessage | null;
export function reactionsFor(cs: ChatSettings): number;
export function banterToday(state: Pick<SwarmState, 'banterSpend'>, at: string): number;
export function banterAllowed(state: SwarmState, at: string): { ok: boolean; why: string; today: number };
export function reactCount(state: Partial<SwarmState>, at: string): number;
export function previewLine(cs: ChatSettings, from?: string, seed?: string): VibeMessage;
export function vibeShade(score: number | null | undefined, ceiling: number): number;
