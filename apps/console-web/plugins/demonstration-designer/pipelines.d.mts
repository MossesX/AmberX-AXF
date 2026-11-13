/** Types of pipelines.mjs (pipeline-demo@1) for the web part. */

export type EventKind = 'orchestrator' | 'model' | 'split' | 'agent' | 'git' | 'test' | 'axhub' | 'focus' | 'error';
export interface PipelineEvent { at: number; kind: EventKind; text: string; source?: string }
export interface Chapter { id: string; title: string; say: string; view: string; selector: string; seconds: number; events: PipelineEvent[]; live: string[] }
export interface PipelineDemo { $axf: 'pipeline-demo@1'; id: string; name: string; type: string; summary: string; voice: string[]; builtIn: boolean; chapters: Chapter[]; updatedAt: string }
export interface PipelineSummary { id: string; name: string; type: string; typeLabel: string; summary: string; chapters: number; events: number; seconds: number; screens: string[]; voice: string[]; builtIn: boolean; updatedAt: string; recorded?: boolean }
export interface TimelineChapter { index: number; id: string; title: string; say: string; view: string; selector: string; start: number; end: number }
export interface TimelineEvent { t: number; chapter: number; kind: EventKind; text: string; source?: string }
export interface Timeline { total: number; chapters: TimelineChapter[]; events: TimelineEvent[] }
export type PlayerStatus = 'idle' | 'playing' | 'paused' | 'done';
export type Dock = 'dock' | 'float' | 'full';
export type Mode = 'replay' | 'live';
export interface Player { status: PlayerStatus; at: number; speed: number; mode: Mode; dock: Dock; id: string }
export type PlayerAction =
  | { type: 'play' | 'pause' | 'resume' | 'toggle' | 'next' | 'prev' | 'restart' | 'stop' }
  | { type: 'tick'; dt: number } | { type: 'chapter'; index: number } | { type: 'seek'; at: number }
  | { type: 'speed'; speed: number } | { type: 'dock'; dock: Dock } | { type: 'mode'; mode: Mode };

export const FRAME: 'pipeline-demo@1';
export const RECORDING_FRAME: 'pipeline-recording@1';
export const EVENT_KINDS: readonly { id: EventKind; label: string; tone: string }[];
export const KIND_IDS: EventKind[];
export const PIPELINE_TYPES: readonly { id: string; label: string; about: string }[];
export const TYPE_IDS: string[];
export const SCREENS: readonly { view: string; label: string }[];
export const MODES: readonly Mode[];
export const SPEEDS: readonly number[];
export const DOCKS: readonly Dock[];
export const PROBES: Readonly<Record<string, { kind: EventKind; about: string }>>;
export function slug(v: string): string;
export function normalizeEvent(e: unknown, i?: number): PipelineEvent;
export function normalizeChapter(c: unknown, i?: number): Chapter;
export function normalizeDemo(raw: unknown): PipelineDemo;
export function validateDemo(raw: unknown): string[];
export function demoSeconds(d: PipelineDemo): number;
export function typeLabel(t: string): string;
export function screenLabel(v: string): string;
export function summarize(d: PipelineDemo): PipelineSummary;
export function timeline(d: PipelineDemo): Timeline;
export function chapterAt(tl: Timeline, t: number): number;
export function eventsUntil(tl: Timeline, t: number): TimelineEvent[];
export function playerInit(over?: Partial<Player>): Player;
export function playerReduce(s: Player, a: PlayerAction, tl: Timeline): Player;
export function filterEvents<T extends { kind: string; text: string; source?: string }>(events: T[], f?: { kinds?: string[]; q?: string }): T[];
export function clock(t: number): string;
export function lineText(e: TimelineEvent): string;
export function matchDemo(phrase: string, demos: { id: string; name: string; type: string; voice?: string[] }[]): string;
export function probeEvents(probe: string, lines: string[], o?: { from?: number; span?: number }): PipelineEvent[];
export function recordingOf(d: PipelineDemo, liveByChapter: Record<string, PipelineEvent[]>, at: string): { $axf: 'pipeline-recording@1'; demo: string; recordedAt: string; demoData: PipelineDemo };
export function pipelineLink(origin: string, id: string, o?: { play?: boolean; mode?: string }): string;
export function parsePipelineLink(search: string): { id: string; play: boolean; mode: Mode } | null;
