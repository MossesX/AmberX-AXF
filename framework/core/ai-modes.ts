/*
 * AI modes — ai-modes@1 (kernel contract, web reference; the lib-ai contract, build-queue epic x.lib.ai). Same design
 * as the Kotlin kernel's `ai.amberx.axf.kernel.ai` (AiModes.kt); conformance fixture: spec/fixtures/ai-modes.json
 * (spec/check-ai-modes.mts, Kotlin AiModesConformanceTest).
 *
 * A MODE is what an app asks the assistant to do: chat, read a codebase into notes, send a build request to the
 * orchestrator. Modes are an open registry (plugins add theirs); the built-ins can't be removed. Every mode says
 * what it needs (a permission), whether it only reads, and whether a person approves before it acts. The UAC
 * policy gates modes for non-admins: only the modes the policy allows, chat alone by default. A trigger (triggers@1)
 * may override the mode it opens. Sessions run on assistant@1 + live-session@1 through an `AiSessionClient`; the
 * host is axHub, a typed placeholder (`axf.ai.session`) until it is wired.
 */

import { permissionAllows } from './assistant';
import type { ChatContext } from './assistant';
import type { LiveEvent, LiveReplay, LiveSessionInfo } from './live-session';

export const AI_MODES_CONTRACT = 'ai-modes@1';
/** The session host a module registers under; the kernel declares it as a placeholder until axHub is wired. */
export const AI_SESSION_CAPABILITY = 'axf.ai.session';
/** Host id the AiSessionClient runs sessions on. */
export const AI_SESSION_HOST = 'axhub';

/* ---------- modes ---------- */

export const MODEL_TIERS = ['fast', 'balanced', 'deep'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export interface AiMode {
  /** namespaced: `ai.chat`, `ai.read-codebase`, `notes.summarize` */
  id: string;
  label: string;
  /** hub permission the caller must hold (`a.b.*` wildcards as in assistant@1); '' = none */
  requiresPermission: string;
  /** the mode never writes anywhere (notes it produces are the caller's to keep) */
  readOnly: boolean;
  /** a person approves before the mode acts (build requests, anything that writes) */
  needsApproval: boolean;
  /** live-session@1 kind the mode opens */
  sessionKind: string;
  /** model tier the mode prefers when the user didn't choose */
  tier: ModelTier;
  description?: string;
  /** owning module (`axf.framework` for the built-ins) */
  module: string;
}

export const BUILTIN_MODULE = 'axf.framework';

export const BUILTIN_AI_MODES: AiMode[] = [
  { id: 'ai.chat', label: 'Chat', requiresPermission: '', readOnly: true, needsApproval: false, sessionKind: 'assistant.chat', tier: 'balanced', description: 'Talk with the assistant; nothing is written', module: BUILTIN_MODULE },
  { id: 'ai.read-codebase', label: 'Read a codebase', requiresPermission: 'ai.read', readOnly: true, needsApproval: false, sessionKind: 'assistant.read', tier: 'fast', description: 'Read a repository or folder and turn it into notes', module: BUILTIN_MODULE },
  { id: 'ai.build-request', label: 'Build request', requiresPermission: 'ai.build', readOnly: false, needsApproval: true, sessionKind: 'agent.run', tier: 'deep', description: 'Send a build request to the orchestrator; a person approves it first', module: BUILTIN_MODULE },
];
export const DEFAULT_MODE = 'ai.chat';
/** What a non-admin may use when the policy says nothing. */
export const DEFAULT_ALLOWED_MODES = [DEFAULT_MODE];

export type AiModeDiagnostic = { kind: 'contribution-conflict'; what: 'ai-mode'; id: string; was: string; now: string };

/** Open registry of modes. Built-ins are always present; a plugin may replace one by id (diagnostic) but never remove it. */
export class AiModeRegistry {
  private items = new Map<string, AiMode>();
  constructor(private readonly report: (d: AiModeDiagnostic) => void = () => {}) { for (const m of BUILTIN_AI_MODES) this.items.set(m.id, { ...m }); }
  register(mode: AiMode): AiModeDiagnostic | null {
    const was = this.items.get(mode.id);
    const d: AiModeDiagnostic | null = was && was.module !== mode.module ? { kind: 'contribution-conflict', what: 'ai-mode', id: mode.id, was: was.module, now: mode.module } : null;
    this.items.set(mode.id, { ...mode });
    if (d) this.report(d);
    return d;
  }
  /** Removes a plugin's mode; a built-in stays (false). */
  unregister(id: string): boolean {
    if (BUILTIN_AI_MODES.some((m) => m.id === id)) return false;
    return this.items.delete(id);
  }
  get(id: string): AiMode | undefined { return this.items.get(id); }
  list(): AiMode[] { return [...this.items.values()]; }
}

/* ---------- UAC gating + resolution ---------- */

/** What the caller may do: admin passes everything; others need the mode in `allowedModes` AND its permission. */
export interface AiModePolicy {
  admin: boolean;
  perms: string[];
  /** mode ids a non-admin may use; omitted = chat only */
  allowedModes?: string[];
}

export function modeAllowed(mode: AiMode, policy: AiModePolicy): boolean {
  if (policy.admin) return true;
  const allowed = policy.allowedModes ?? DEFAULT_ALLOWED_MODES;
  return allowed.includes(mode.id) && (!mode.requiresPermission || permissionAllows(policy.perms, mode.requiresPermission));
}

export function allowedModes(modes: AiMode[], policy: AiModePolicy): AiMode[] {
  return modes.filter((m) => modeAllowed(m, policy));
}

export type ModeReason = 'override' | 'requested' | 'default' | 'fallback' | 'denied';

export interface ModeResolution {
  /** null only when nothing is allowed (reason `denied`) */
  mode: AiMode | null;
  reason: ModeReason;
  /** the mode asked for that the policy refused (or that doesn't exist) */
  denied?: string;
}

/**
 * Picks the mode for a request: a trigger's override first, then what the caller asked for, then the default. A
 * refused or unknown pick falls back to the default when that is allowed, else nothing is allowed.
 */
export function resolveMode(modes: AiMode[], policy: AiModePolicy, pick: { override?: string; requested?: string; defaultMode?: string } = {}): ModeResolution {
  const byId = new Map(modes.map((m) => [m.id, m]));
  const def = pick.defaultMode || DEFAULT_MODE;
  const tryPick = (id: string | undefined, reason: ModeReason): ModeResolution | null => {
    if (!id) return null;
    const m = byId.get(id);
    if (m && modeAllowed(m, policy)) return { mode: m, reason };
    return { mode: null, reason: 'denied', denied: id };
  };
  const first = tryPick(pick.override, 'override') ?? tryPick(pick.requested, 'requested');
  if (first?.mode) return first;
  const d = byId.get(def);
  if (d && modeAllowed(d, policy)) return first ? { mode: d, reason: 'fallback', denied: first.denied } : { mode: d, reason: 'default' };
  return { mode: null, reason: 'denied', denied: first?.denied ?? def };
}

/* ---------- model choice ---------- */

export interface ModelOption { id: string; tier: ModelTier; label?: string }
export type ModelReason = 'user' | 'mode' | 'nearest' | 'first' | 'none';
export interface ModelChoice { model: string; tier: ModelTier | null; reason: ModelReason }

/**
 * Rules: a user's explicit pick counts only when the policy lets them choose models (`assistant.models`, or admin)
 * and the model exists; otherwise the mode's tier; a missing tier takes the nearest (up first, then down); with no
 * tiers at all the first option; with no options an empty choice.
 */
export function chooseModel(mode: AiMode, options: ModelOption[], policy: AiModePolicy, userPick?: string): ModelChoice {
  if (!options.length) return { model: '', tier: null, reason: 'none' };
  const canChoose = policy.admin || permissionAllows(policy.perms, 'assistant.models');
  if (userPick && canChoose) { const o = options.find((m) => m.id === userPick); if (o) return { model: o.id, tier: o.tier, reason: 'user' }; }
  const exact = options.find((o) => o.tier === mode.tier);
  if (exact) return { model: exact.id, tier: exact.tier, reason: 'mode' };
  const i = MODEL_TIERS.indexOf(mode.tier);
  const order = [...MODEL_TIERS.slice(i + 1), ...MODEL_TIERS.slice(0, i).reverse()];
  for (const t of order) { const o = options.find((m) => m.tier === t); if (o) return { model: o.id, tier: o.tier, reason: 'nearest' }; }
  return { model: options[0]!.id, tier: options[0]!.tier, reason: 'first' };
}

/* ---------- a session request ---------- */

export interface AiRequestInput {
  prompt: string;
  context?: ChatContext;
  /** the mode the caller wants */
  requested?: string;
  /** the trigger that opened it and its per-trigger mode override */
  triggerId?: string;
  override?: string;
  model?: string;
  title?: string;
}

/** What goes to the AiSessionClient once the mode and model are settled. */
export interface AiSessionRequest {
  mode: string;
  sessionKind: string;
  prompt: string;
  model: string;
  readOnly: boolean;
  /** true: the host waits for a person before the session acts (live-session `wait`) */
  needsApproval: boolean;
  title: string;
  context?: ChatContext;
  triggerId?: string;
}

export interface AiRequestResult { request: AiSessionRequest | null; resolution: ModeResolution; model: ModelChoice | null }

/** Resolves mode + model for an input. `request` is null when the policy allows nothing. */
export function buildRequest(modes: AiMode[], policy: AiModePolicy, options: ModelOption[], input: AiRequestInput): AiRequestResult {
  const resolution = resolveMode(modes, policy, { override: input.override, requested: input.requested });
  if (!resolution.mode) return { request: null, resolution, model: null };
  const model = chooseModel(resolution.mode, options, policy, input.model);
  const title = (input.title || input.prompt).replace(/\s+/g, ' ').trim().slice(0, 60) || resolution.mode.label;
  const request: AiSessionRequest = {
    mode: resolution.mode.id, sessionKind: resolution.mode.sessionKind, prompt: input.prompt, model: model.model,
    readOnly: resolution.mode.readOnly, needsApproval: resolution.mode.needsApproval, title,
    ...(input.context ? { context: input.context } : {}), ...(input.triggerId ? { triggerId: input.triggerId } : {}),
  };
  return { request, resolution, model };
}

/* ---------- session client (assistant@1 + live-session@1) ---------- */

export type AiDetach = () => void;

/**
 * Runs mode sessions on a live-session host. `start` opens the session and sends the first turn; `attach` replays
 * after `after` then streams until detached (detaching never stops anything); `send` adds a turn; `close` is the
 * only way a session ends. The console's AssistantClient + a SessionHost implement it; axHub is the host.
 */
export interface AiSessionClient {
  readonly host: string;
  available(): Promise<boolean>;
  start(request: AiSessionRequest): Promise<LiveSessionInfo>;
  attach(id: string, after: number, onEvent: (e: LiveEvent) => void, onReplay?: (r: LiveReplay) => void): Promise<AiDetach>;
  send(id: string, input: { prompt: string; context?: ChatContext }): Promise<void>;
  /** replays events after `after` (a stream without staying attached) */
  stream(id: string, after: number, max?: number): Promise<LiveReplay>;
  /** stops the running turn; the session stays open */
  stop(id: string): Promise<void>;
  close(id: string): Promise<void>;
  list(): Promise<LiveSessionInfo[]>;
}

export class AiSessionNotImplemented extends Error {
  readonly capability = AI_SESSION_CAPABILITY;
  constructor() { super(`"${AI_SESSION_CAPABILITY}" is declared but not built yet.`); this.name = 'NotImplemented'; }
}

/** The kernel default until the axHub host is wired. Never pretends to work. */
export class PlaceholderAiSessionClient implements AiSessionClient {
  readonly host = AI_SESSION_HOST;
  async available() { return false; }
  start(): Promise<LiveSessionInfo> { return Promise.reject(new AiSessionNotImplemented()); }
  attach(): Promise<AiDetach> { return Promise.reject(new AiSessionNotImplemented()); }
  send(): Promise<void> { return Promise.reject(new AiSessionNotImplemented()); }
  stream(): Promise<LiveReplay> { return Promise.reject(new AiSessionNotImplemented()); }
  stop(): Promise<void> { return Promise.reject(new AiSessionNotImplemented()); }
  close(): Promise<void> { return Promise.reject(new AiSessionNotImplemented()); }
  async list(): Promise<LiveSessionInfo[]> { return []; }
}
