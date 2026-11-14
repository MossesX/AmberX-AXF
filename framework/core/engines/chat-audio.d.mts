// Types for chat-audio.mjs (group chat read aloud: voice@1, chat-audio@1, the playback queue).
export type Mode = 'all' | 'mentions' | 'summaries';
export type Gender = 'any' | 'female' | 'male';
export interface Voice { label: string; prefer: string[]; lang: string; gender: Gender; rate: number; pitch: number; volume: number; cloud: { provider: 'openai' | 'elevenlabs'; voice: string } | null }
export type VoiceOverride = Partial<Omit<Voice, 'label'>>;
export interface Cast { id: string; name: string; default: Voice; agents: Record<string, Voice>; pool: Voice[] }
export interface AudioSettings { $axf: 'chat-audio@1'; enabled: boolean; volume: number; mode: Mode; muted: Record<string, true>; voices: Record<string, VoiceOverride>; cast: string; queueMax: number; maxChars: number; speakMine: boolean; sayName: boolean }
export interface AudioChange { enabled?: boolean; volume?: number; mode?: Mode; cast?: string; queueMax?: number; maxChars?: number; speakMine?: boolean; sayName?: boolean; mute?: string; unmute?: string; agent?: string; voice?: VoiceOverride | null }
export interface Msg { id: string; from: string; kind: string; text: string }
export interface Utterance { id: string; from: string; name: string; text: string; voice: Voice; volume: number }
export interface Queue { items: Utterance[]; speaking: Utterance | null; lastId: string; dropped: number; paused: boolean }
type MentionTest = { isMention?: (text: string) => boolean };
export const VOICE: 'voice@1';
export const VOICE_TYPE: 'voice';
export const CHAT_AUDIO: 'chat-audio@1';
export const MODES: Mode[];
export const MODE_LABELS: Record<Mode, string>;
export const GENDERS: Gender[];
export const CLOUD_PROVIDERS: string[];
export const SUMMARY_KINDS: string[];
export const LIMITS: Record<'rate' | 'pitch' | 'volume' | 'masterVolume' | 'queueMax' | 'maxChars', [number, number]>;
export const DEFAULT_VOICE: Voice;
export const DEFAULT_SETTINGS: AudioSettings;
export function clamp(v: unknown, range: [number, number], d: number): number;
export function normVoice(v: unknown, base?: Voice): Voice;
export function castErrors(a: unknown): { field: string; code: string; message: string }[];
export function voiceErrors(type: string, data: unknown): string[];
export interface VoiceCastData { default: Partial<Voice>; agents?: Record<string, Partial<Voice>>; pool?: Partial<Voice>[] }
export function normCast(a: unknown): Cast;
export function idHash(id: string): number;
export function castId(settings: Partial<AudioSettings> | null | undefined, skinPick: string | null | undefined, ids: string[]): string;
export function voiceFor(agentId: string, cast: Cast | null | undefined, settings?: Partial<AudioSettings>): Voice;
export function pickDeviceVoice(voice: Partial<Voice>, available: { name: string; lang?: string; gender?: string }[]): string | null;
export function normSettings(s: unknown, agents?: string[]): AudioSettings;
export function applyAudio(settings: unknown, change: AudioChange, agents?: string[]): { settings: AudioSettings; log: string[] };
export function mentionsBrett(text: string): boolean;
export function skipReason(m: Msg, settings: Partial<AudioSettings>, opts?: MentionTest): string;
export function spokenText(text: string, maxChars?: number): string;
export function utterance(m: Msg, settings: Partial<AudioSettings>, cast: Cast | null, names?: Record<string, string>): Utterance;
export function emptyQueue(): Queue;
export function enqueue(queue: Partial<Queue> | null, messages: Msg[], settings: Partial<AudioSettings>, cast: Cast | null, names?: Record<string, string>, opts?: MentionTest & { backlog?: boolean }): Queue;
export function nextUp(queue: Partial<Queue>): { queue: Queue; next: Utterance | null };
export function finished(queue: Partial<Queue>): Queue;
export function prune(queue: Partial<Queue>, settings: Partial<AudioSettings>): Queue;
export function clearQueue(queue: Partial<Queue> | null): Queue;
export function describe(settings: Partial<AudioSettings>, names?: Record<string, string>): string;
