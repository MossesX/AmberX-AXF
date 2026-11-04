// Types for voice-command-rules.mjs (voice-command@1; shared by the TS engines, the build engine, the CLI, Molly and the console).
export type VoiceEffect = 'read' | 'write' | 'destructive' | 'navigate';
export type VoiceConfirm = 'never' | 'missing' | 'always';
export type VoiceSlotType = 'text' | 'number' | 'money' | 'date' | 'choice' | 'id' | 'yesno';
export type VoiceTransport = 'api' | 'mcp' | 'cli' | 'action';
export type VoiceSource = 'generated' | 'authored' | 'mixed';
export interface VoiceSlot { type: VoiceSlotType; required: boolean; options?: string[]; say: string; default?: unknown }
export interface VoiceCommand {
  id: string;
  title: string;
  effect: VoiceEffect;
  confirm: VoiceConfirm;
  run: Partial<Record<VoiceTransport, string>>;
  slots: Record<string, VoiceSlot>;
  phrases: string[];
  say: string;
  help: string;
  source: 'generated' | 'authored';
}
export interface VoiceCommandData {
  app: string;
  forFramework: boolean;
  source: VoiceSource;
  generatedFrom: VoiceTransport[];
  wake: string[];
  commands: VoiceCommand[];
}
/** What an app's API / MCP / CLI / actions already declare: the input of the generator and of the coverage check. */
export interface VoiceSurfaceEntry {
  id: string;
  title?: string;
  description?: string;
  effect?: VoiceEffect;
  readOnly?: boolean;
  destructive?: boolean;
  run: Partial<Record<VoiceTransport, string>>;
  input?: { properties?: Record<string, { type?: string; enum?: unknown[]; description?: string; format?: string; default?: unknown }>; required?: string[] };
}
export interface VoiceSurface { app: string; forFramework?: boolean; wake?: string[]; commands: VoiceSurfaceEntry[] }
export interface VoiceMatch { app: string; command: VoiceCommand; slots: Record<string, unknown>; missing: string[]; confirm: boolean; question: string; score: number; phrase: string }
export interface VoiceHelp { id: string; title: string; effect: VoiceEffect; confirm: VoiceConfirm; phrases: string[]; example: string; help: string }
export type PhraseToken = { kind: 'word'; text: string } | { kind: 'slot'; name: string };

export const VOICE_COMMAND_TYPE: 'voice-command';
export const VOICE_COMMAND_FRAME: 'voice-command@1';
export const VOICE_EFFECTS: readonly VoiceEffect[];
export const VOICE_CONFIRMS: readonly VoiceConfirm[];
export const VOICE_CONFIRM_FLOOR: Readonly<Record<VoiceEffect, VoiceConfirm>>;
export const VOICE_SLOT_TYPES: readonly VoiceSlotType[];
export const VOICE_TRANSPORTS: readonly VoiceTransport[];
export const VOICE_SOURCES: readonly VoiceSource[];
export const VOICE_LIMITS: { commands: number; phrases: number; slots: number; phrase: number; wake: number; title: number; say: number; help: number; options: number };
export const VOICE_YES: readonly string[];
export const VOICE_NO: readonly string[];
export const VOICE_FILLERS: readonly string[];
export const VOICE_VERB_EFFECT: Readonly<Record<string, VoiceEffect>>;
export const VOICE_SLOT_HINTS: readonly (readonly [RegExp, VoiceSlotType])[];

export function phraseSlots(text: string): string[];
export function tokenizePhrase(phrase: string): PhraseToken[];
export function confirmRule(command: { effect?: string; confirm?: string } | undefined): VoiceConfirm;
export function voiceCommandErrors(type: string, raw: unknown): string[];
export function normalizeVoiceCommands(raw: unknown): VoiceCommandData;
export function parseSlotValue(slot: Partial<VoiceSlot> | undefined, ws: string[], now?: string): { value: unknown; used: number } | null;
export function matchPhrase(tokens: PhraseToken[], ws: string[], slots: Record<string, Partial<VoiceSlot>>, now?: string): { slots: Record<string, unknown>; literals: number; leftover: string[] } | null;
export function splitWake(ws: string[], assets: VoiceCommandData[]): { app: string; ws: string[] };
export function matchUtterance(assets: unknown | unknown[], text: string, opts?: { now?: string; app?: string }): VoiceMatch | null;
export function yesOrNo(text: string): boolean | null;
export function sayFor(command: Partial<VoiceCommand> | undefined, slots?: Record<string, unknown>, result?: unknown): string;
export function helpFor(command: unknown): VoiceHelp;
export function whatCanISay(assets: unknown | unknown[], app?: string): { app: string; header: string; commands: { id: string; line: string }[] }[];
export function slotFromProperty(name: string, p?: { type?: string; enum?: unknown[]; description?: string; format?: string }): Omit<VoiceSlot, 'required'>;
export function idWords(id: string, app?: string): string[];
export function effectOf(entry: Partial<VoiceSurfaceEntry> | undefined, app?: string): VoiceEffect;
export function generateCommand(entry: VoiceSurfaceEntry, app?: string): VoiceCommand;
export function generateVoiceCommands(surface: VoiceSurface): VoiceCommandData;
export function mergeVoiceCommands(existing: unknown, generated: unknown): VoiceCommandData;
export function voiceCoverage(asset: unknown, surface: Partial<VoiceSurface> | undefined): { total: number; covered: number; missing: string[]; extra: string[]; ok: boolean };
export function voiceCommandSchemaProperties(): Record<string, unknown>;
export const VOICE_BRIDGE_FRAME: 'voice-bridge@1';
export const VOICE_BRIDGE_TYPES: readonly string[];
export type VoiceBridgeType = 'say' | 'answer' | 'help' | 'ping' | 'pong' | 'utterance' | 'result';
export interface VoiceBridgeMessage { $axf: 'voice-bridge@1'; type: VoiceBridgeType; id: string; text: string; app: string; [k: string]: unknown }
export function voiceBridgeMessage(type: VoiceBridgeType, fields?: Record<string, unknown>): VoiceBridgeMessage;
export function parseVoiceBridge(data: unknown): VoiceBridgeMessage | null;
export function helpQuestion(text: string): string | null;
