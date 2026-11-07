/** Types for library-config.mjs (library-config@1 + library-instance@1). See the .mjs for the rules. */
import type { LibraryParam } from './library';

export const LIBRARY_CONFIG: 'library-config@1';
export const LIBRARY_INSTANCE: 'library-instance@1';
export const WIZARD_STEP_IDS: readonly WizardStepId[];
export const WIZARD_MODES: readonly WizardMode[];
export const CONNECTION_KINDS: readonly ConnectionKind[];
export const CONNECTION_DIRECTIONS: readonly ConnectionDirection[];
export const INSTANCE_STATUSES: readonly InstanceStatus[];
export const PARAM_TYPES: readonly LibraryParam['type'][];
export const CREDENTIAL_SCHEMES: readonly ['env', 'secret', 'hub'];
export const CONNECTION_REF_PREFIX: Record<ConnectionKind, string>;
export const REGISTRY: Record<string, unknown>;

export type WizardStepId = 'about' | 'capabilities' | 'connections' | 'settings' | 'credentials' | 'review';
export type WizardMode = 'scripted' | 'assisted' | 'both';
export type ConnectionKind = 'dataset' | 'registry-ui' | 'plugin' | 'service' | 'action' | 'asset';
export type ConnectionDirection = 'in' | 'out' | 'both';
export type InstanceStatus = 'configured' | 'disabled' | 'removed';

export interface Capability { id: string; label: string; description: string; default: boolean; requires: string[]; params: LibraryParam[] }
export interface Connection { id: string; label: string; description?: string; kind: ConnectionKind; direction: ConnectionDirection; required: boolean; accepts?: string[]; many?: boolean; forCapability?: string }
export interface Credential { key: string; label: string; required: boolean; help?: string; env?: string }

export interface LibraryConfigManifest {
  $axf: 'library-config@1';
  library: string; module: string; version: string; name: string; description: string; manifestKey: string;
  capabilities: Capability[]; settings: LibraryParam[]; connections: Connection[]; credentials: Credential[];
  dependsOn: string[]; provides: string[]; ports: string[]; notYet: { capability: string; note: string }[];
  wizard: { mode: WizardMode; intro: string; steps: WizardStepId[] };
}

export interface WizardField { id: string; label: string; type: string; [k: string]: unknown }
export interface WizardStep { id: WizardStepId; title: string; ask: string; fields: WizardField[] }

export interface Draft {
  capabilities: Record<string, false | Record<string, unknown>>;
  params: Record<string, unknown>;
  connections: Record<string, string | string[]>;
  credentials: Record<string, { ref: string }>;
}

export interface InstanceHistory { at: string; by: string; kind: 'configured' | 'reconfigured' | 'disabled' | 'enabled' | 'removed'; note: string }
export interface LibraryInstance {
  $axf: 'library-instance@1';
  id: string; library: string; version: string; app: string; status: InstanceStatus; createdAt: string; updatedAt: string;
  capabilities: string[]; capabilityParams: Record<string, Record<string, unknown>>; params: Record<string, unknown>;
  connections: Record<string, { kind: ConnectionKind; ref: string | string[] }>;
  credentials: Record<string, { ref: string }>;
  history: InstanceHistory[];
}
export interface InstanceMeta { now: string; app?: string; id?: string; by?: string; note?: string; surface?: string }

/** library@1 record as read from library.json (loosely typed: every field optional). */
export type LibraryRecord = Record<string, unknown>;

export function isSecretParam(p: Partial<LibraryParam> & { secret?: boolean }): boolean;
export function manifestFrom(lib: LibraryRecord): LibraryConfigManifest;
export function manifestErrors(m: unknown): string[];
export function wizardSteps(m: LibraryConfigManifest): WizardStep[];
export function newDraft(m: LibraryConfigManifest): Draft;
export function coerceParam(p: LibraryParam, raw: unknown): { value?: unknown; error?: string };
export function answerStep(m: LibraryConfigManifest, draft: Draft | null | undefined, stepId: string, answers: Record<string, unknown>): { draft: Draft; errors: string[] };
export function draftErrors(m: LibraryConfigManifest, draft: Draft | null | undefined): string[];
export function instanceFrom(m: LibraryConfigManifest, draft: Draft | null | undefined, meta: InstanceMeta): LibraryInstance;
export function instanceErrors(m: LibraryConfigManifest, inst: unknown): string[];
export function draftFromInstance(m: LibraryConfigManifest, inst: LibraryInstance): Draft;
export function reconfigure(m: LibraryConfigManifest, inst: LibraryInstance, draft: Draft, meta: InstanceMeta): LibraryInstance;
export function setStatus(inst: LibraryInstance, status: InstanceStatus, meta: InstanceMeta): LibraryInstance;
export function installConfig(m: LibraryConfigManifest, inst: LibraryInstance): Record<string, unknown>;
export function instanceSummary(m: LibraryConfigManifest, inst: LibraryInstance): string[];
export function jsonSchemas(): Record<string, Record<string, unknown>>;
