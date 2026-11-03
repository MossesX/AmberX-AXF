// Types for control-rules.mjs (control@1: one command schema for tokens, AmberX entities and the planner).
export type ControlOp = 'list' | 'get' | 'set' | 'reset' | 'add' | 'remove' | 'act';
export type ControlEffect = 'read' | 'write' | 'destructive' | 'navigate';
export type ControlDomain = 'tokens' | 'amberx' | 'planner' | 'console';
export type ControlWireCode = 'invalid' | 'denied' | 'not_found' | 'validation' | 'confirmation_required' | 'not_implemented' | 'unexpected';
export interface ControlCommand {
  $axf?: 'control@1';
  op: ControlOp;
  target: string;
  path?: string;
  value?: unknown;
  action?: string;
  input?: Record<string, unknown>;
  select?: Record<string, unknown>;
  confirm?: string;
  by?: string;
  reason?: string;
}
export interface ControlTarget {
  domain: ControlDomain;
  label: string;
  asset?: string;
  ops: readonly ControlOp[];
  paths: 'static' | 'host' | 'entity';
  value?: string;
  pathShape?: string;
  fields?: Record<string, string>;
  select?: Record<string, string>;
  acts?: Record<string, Record<string, string>>;
  /** The effect of an act verb when it differs from `write` (console navigation). */
  actEffect?: Record<string, ControlEffect>;
  stepFields?: Record<string, string>;
  protected?: readonly string[];
  doc: string;
}
export interface ControlPath { id: string; token?: string; kind: string; unit?: string; default?: number | string | boolean; min?: number; max?: number; options?: string[] }
export type ControlGate =
  | { ok: true; effect: ControlEffect; requires: string; command: ControlCommand }
  | { ok: false; code: ControlWireCode; message: string; requires?: string; effect?: ControlEffect; errors?: string[]; confirm?: string; ttlMs?: number };
export const CONTROL_FRAME: 'control@1';
export const CONTROL_OPS: readonly ControlOp[];
export const CONTROL_DOMAINS: readonly ControlDomain[];
export const CONTROL_EFFECT: Record<ControlOp, ControlEffect>;
export const CONTROL_PERMISSION_SUFFIX: Record<ControlEffect, string>;
export const CONTROL_PERMISSIONS: Record<string, string>;
export const CONTROL_WIRE: Record<string, ControlWireCode>;
export const CONTROL_CONFIRM_TTL_MS: number;
export const CONTROL_LIST_MAX: number;
export const CONTROL_VALUE_MAX_BYTES: number;
export const CONTROL_TARGETS: Record<string, ControlTarget>;
export const CONTROL_TARGET_IDS: string[];
export const CONTROL_ALIASES: Record<string, { target: string; preset?: Record<string, string>; note?: string }>;
export const CONTROL_DOMAIN_LABELS: Record<ControlDomain, string>;
export function isControlTarget(t: unknown): t is string;
export function controlDomain(target: string): ControlDomain | null;
export function controlEffect(op: string): ControlEffect | null;
export function controlEffectOf(target: string, op: string, action?: string): ControlEffect | null;
export function controlPermission(target: string, op: string, action?: string): string | null;
export function controlPaths(target: string): ControlPath[] | null;
export function controlPathKnown(target: string, path: string): boolean | null;
export function normalizeControl(raw: unknown): ControlCommand;
export function controlValueErrors(target: string, path: string, value: unknown): string[];
export function controlErrors(raw: unknown): string[];
export function controlHash(s: string): string;
export function canonicalControl(raw: unknown): string;
export function controlConfirmToken(raw: unknown, salt: string, now?: number): string;
export function controlConfirmValid(raw: unknown, token: unknown, salt: string, now?: number): boolean;
export function controlGranted(grants: Iterable<string> | Set<string>, perm: string): boolean;
export function controlGate(raw: unknown, grants: Iterable<string> | Set<string>, opts?: { salt?: string; now?: number }): ControlGate;
export function controlResult(command: unknown, data: Record<string, unknown>, audit?: { by?: string; reason?: string; at?: string } | null): Record<string, unknown>;
export function controlFailure(code: string, message: unknown, extra?: Record<string, unknown>): Record<string, unknown>;
export function controlSchema(): Record<string, unknown>;
export function controlTools(): Record<string, unknown>[];
export function controlRoutes(): Record<string, unknown>[];
export function controlCli(): { usage: string[]; aliases: Record<string, string>; targets: string[] };
export function controlRegistry(): Record<string, unknown>;
