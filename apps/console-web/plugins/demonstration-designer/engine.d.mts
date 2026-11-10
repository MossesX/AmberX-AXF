/** Types of engine.mjs (pitch-script@1) for the web part. */

export interface PitchStep { say: string; do: string; target: string; title?: string; highlight?: string; wait?: number }
export interface TopicControl { label: string; text: string; target: string }
export interface TopicScreen { view: string; label: string; text: string; controls: TopicControl[] }
export type TopicKind = 'plugin' | 'screen' | 'ui-element' | 'dialog' | 'setting';
export interface Topic { id: string; kind: TopicKind; label: string; description: string; app: string; screens: TopicScreen[]; keywords: string[]; plugin?: string }

export interface PitchVoice { narrator: string; speed: number }
export interface PitchData { about: string; entries: string[]; app: string; surface: string; steps: PitchStep[]; voice: PitchVoice; chain: string[]; keywords: string[]; generated: { from: string; at: string; build: string }; editable: boolean }
export interface PitchFacts { minutes: number; wpm: number; speed: number; logoIntro: boolean; logoOutro: boolean; logoSeconds: number; product: string; cta: string; topic: string; topicLabel: string; kind: string }
export interface PitchPlan { targetSeconds: number; seconds: number; steps: number; screens: string[]; cut: number; dwell: number }
export interface Pitch { $axf: 'pitch-script@1'; id: string; name: string; description: string; data: PitchData; pitch: PitchFacts; plan: PitchPlan }

export interface Settings {
  script: { minutes: number; product: string; cta: string; wpm: number; benefitsFirst: boolean };
  narration: { voice: string; speed: number; captions: boolean; captionSize: 'sm' | 'md' | 'lg' };
  stage: { zoom: boolean; maxZoom: number; highlight: 'spotlight' | 'outline'; controls: boolean; logoIntro: boolean; logoOutro: boolean; logoSeconds: number };
  music: { on: boolean; volume: number; mood: 'calm' | 'upbeat' | 'minimal' };
  export: { format: 'auto' | 'mp4' | 'webm'; transcode: boolean; keep: number };
  advanced: { show: boolean };
}
export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

export interface MusicPlan { bpm: number; beat: number; chords: number[][]; wave: 'sine' | 'triangle'; gain: number }
export type RecordEvent = { kind: 'nav'; view: string; label?: string } | { kind: 'click'; label: string; target?: string };

export const PITCH_FRAME: 'pitch-script@1';
export const PITCH_WPM: number;
export const STEP_PAUSE_S: number;
export const LENGTHS: number[];
export const MOODS: string[];
export const HIGHLIGHTS: string[];
export const FORMATS: string[];
export const CAPTION_SIZES: string[];
export const TOPIC_KINDS: string[];
export const NARRATORS: { value: string; label: string }[];
export const PITCH_LIMITS: { minutes: [number, number]; steps: number; say: number; cta: number; product: number; zoom: [number, number]; volume: [number, number]; logoSeconds: [number, number] };
export const SETTINGS_DEFAULTS: Settings;

export function wordCount(s: unknown): number;
export function slugify(s: unknown, fallback?: string): string;
export function autoKeywords(parts: unknown, max?: number): string[];
export function fmtSeconds(s: number): string;
export function normalizeSettings(raw: unknown): Settings;
export function mergeSettings(current: unknown, patch: unknown): Settings;
export function flattenSettings(s: unknown): { key: string; value: unknown }[];
export function settingFromText(key: string, text: string): SettingsPatch;
export function normalizeTopic(raw: unknown): Topic;
export function topicsFromSearch(entries: unknown[]): Topic[];
export function mergeTopics(registry: Topic[], live: Topic[]): Topic[];
export function searchTopics(topics: Topic[], q: string, limit?: number): Topic[];
export function featuredTopics(topics: Topic[], limit?: number): Topic[];
export function sentences(text: unknown): string[];
export function benefitScore(s: unknown): number;
export function speakable(s: unknown, max?: number): string;
export function benefitSentences(text: unknown, max?: number): string[];
export function whatItIs(text: unknown): string;
export function stepsSeconds(steps: PitchStep[], opts?: { wpm?: number; speed?: number }): number;
export function pitchSeconds(steps: PitchStep[], pitch?: Partial<PitchFacts>): number;
export function pickScreens(topic: Topic, targetSeconds: number): TopicScreen[];
export function generatePitch(topic: Topic | Record<string, unknown>, opts?: { minutes?: number; voice?: Partial<PitchVoice>; narrator?: string; speed?: number; cta?: string; product?: string; wpm?: number; logoIntro?: boolean; logoOutro?: boolean; logoSeconds?: number; at?: string; build?: string }): Pitch;
export function fitToLength(weighted: { weight: number; step: PitchStep }[], target: number, opts?: { wpm?: number; speed?: number }): { steps: PitchStep[]; cut: number; dwell: number };
export function cleanStep(s: unknown): PitchStep | null;
export function scriptText(steps: PitchStep[]): string;
export function parseScript(text: string, base?: PitchStep[]): PitchStep[];
export function stepsFromRecording(events: RecordEvent[], opts?: { product?: string }): PitchStep[];
export function musicPlan(mood?: string): MusicPlan;
export function shareLink(origin: string, id: string, opts?: { play?: boolean }): string;
export function parseDeepLink(search: string): { id: string; play: boolean } | null;
