// Types for agent-training-rules.mjs (agent-training@1 + vocabulary-index@1; shared by the console plugin, the CLI and the checks).
export type SourceType = 'website' | 'product' | 'code' | 'files' | 'text' | 'search' | 'mcp';
export type FetchMethod = 'firecrawl' | 'http' | 'repo' | 'git' | 'upload' | 'paste' | 'mcp';
export type CategoryKind = 'product' | 'code' | 'docs' | 'process' | 'brand' | 'support' | 'people' | 'custom';
export type StorageMode = 'rag' | 'summaries' | 'both' | 'none';
export type IndexType = 'keyword' | 'vector' | 'hybrid';
export type Extract = 'vocabulary' | 'pairs' | 'tools' | 'skills' | 'persona';
export type Schedule = 'manual' | 'hourly' | 'daily' | 'weekly';
export type TrainingStatus = 'empty' | 'draft' | 'ready' | 'running' | 'trained' | 'stale' | 'failed';
export type AttachKind = 'vocabulary' | 'pairs' | 'tool' | 'skill' | 'skill-page' | 'persona' | 'lingo';
export interface FieldError { field: string; code: 'missing' | 'invalid'; message: string }
export interface TrainingCategory { id: string; label: string; kind: CategoryKind; keywords: string[] }
export interface TrainingSource {
  id: string; type: SourceType; label: string; fetch: FetchMethod; enabled: boolean; url: string; include: string[]; exclude: string[]; depth: number; limit: number;
  productTypes: string[]; languages: string[]; paths: string[]; files: string[]; text: string; query: string; tokenEnv: string; uri: string; tool: string; args: Record<string, unknown>; categoryIds: string[];
}
export interface TrainingProcessing { chunkSize: number; overlap: number; dedupe: boolean; summarize: boolean; extract: Extract[]; embedProfile: string }
export interface TrainingStorage { mode: StorageMode; index: IndexType; scope: string; maxItems: number; replace: boolean }
export interface TrainingAttached { kind: AttachKind; id: string; at: string; auto: boolean }
export interface TrainingOutputs {
  toolIds: string[]; skillIds: string[]; skillPages: string[]; personaId: string; lingoIds: string[];
  vocabulary: { id: string; terms: number; byCategory: Record<string, number> }; pairs: number; attached: TrainingAttached[];
}
export interface TrainingRun { at: string; status: 'completed' | 'partial' | 'failed'; added: number; log: string[] }
export interface AgentTraining {
  $axf: 'agent-training@1'; agentId: string; name: string; description: string; status: TrainingStatus; categories: TrainingCategory[]; sources: TrainingSource[];
  processing: TrainingProcessing; storage: TrainingStorage; schedule: Schedule; outputs: TrainingOutputs; lastRun: TrainingRun | null; updatedAt: string;
}
export interface VocabularyTerm { term: string; meaning: string; categoryId: string; count: number; sources: string[] }
export interface VocabularyIndex { $axf: 'vocabulary-index@1'; id: string; agentId: string; terms: VocabularyTerm[]; byCategory: Record<string, string[]>; updatedAt: string }
/** agent-definition@1 training job (framework/core/agents.ts TrainingDef) a host runs per enabled source. */
export interface TrainingJob { id: string; name: string; agentId: string; sources: Record<string, unknown>[]; chunkSize: number; overlap: number; replace: boolean; schedule: Schedule; tags: string[] }
export interface KnownIds { agents?: Iterable<string> | Record<string, unknown>; tools?: Iterable<string> | Record<string, unknown>; skills?: Iterable<string> | Record<string, unknown>; personas?: Iterable<string> | Record<string, unknown>; lingo?: Iterable<string> | Record<string, unknown>; skillPages?: Iterable<string> | Record<string, unknown> }

export const TAGS: { training: 'agent-training@1'; vocabulary: 'vocabulary-index@1' };
export const CONTRACT: 'agent-training@1';
export const AGENT_ID_PATTERN: string;
export const SOURCE_TYPES: SourceType[];
export const FETCH_METHODS: FetchMethod[];
export const FETCH_BY_TYPE: Record<SourceType, FetchMethod[]>;
export const CODE_LANGUAGES: string[];
export const CATEGORY_KINDS: CategoryKind[];
export const STORAGE_MODES: StorageMode[];
export const INDEX_TYPES: IndexType[];
export const EXTRACTS: Extract[];
export const SCHEDULES: Schedule[];
export const STATUSES: TrainingStatus[];
export const ATTACH_KINDS: AttachKind[];
export const AGENT_TRAINING: {
  tags: typeof TAGS; idPattern: string; sourceTypes: SourceType[]; fetchMethods: FetchMethod[]; fetchByType: Record<SourceType, FetchMethod[]>; codeLanguages: string[]; categoryKinds: CategoryKind[];
  storageModes: StorageMode[]; indexTypes: IndexType[]; extracts: Extract[]; schedules: Schedule[]; statuses: TrainingStatus[]; attachKinds: AttachKind[];
  limits: Record<string, number>; ranges: Record<string, [number, number]>;
  defaults: { processing: TrainingProcessing; storage: TrainingStorage; source: { depth: number; limit: number } };
};
export function emptyTraining(agentId?: string): AgentTraining;
export function normTraining(raw: unknown): AgentTraining;
export function trainingErrors(t: unknown, ctx?: { known?: KnownIds }, p?: string): FieldError[];
export function trainingJobs(t: AgentTraining): TrainingJob[];
export function normVocabulary(raw: unknown): VocabularyIndex;
export function vocabularyErrors(v: unknown, p?: string): FieldError[];
export function jsonSchemas(): Record<string, Record<string, unknown>>;
export function registrySnapshot(): typeof AGENT_TRAINING & { empty: AgentTraining };
