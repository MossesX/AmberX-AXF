// Types for agent-card-rules.mjs (agent-card@1; shared by the TS engines, the build engine and plugins).
export type CardDesign = 'badge' | 'license' | 'trading' | 'backstage';
export type CardField = 'name' | 'role' | 'specialty' | 'employeeId' | 'email' | 'hiredAt' | 'status' | 'catchphrase' | 'signature' | 'jobs' | 'successRate' | 'spend' | 'favoriteModel';
export interface AgentCardData {
  design: CardDesign;
  orientation: 'vertical' | 'horizontal';
  logo: 'banner' | 'watermark' | 'corner' | 'none';
  surface: 'surface' | 'raised' | 'inverse' | 'accent';
  accent: 'accent' | 'brand-1' | 'brand-2' | 'brand-3' | 'info' | 'success' | 'warning' | 'danger';
  finish: 'flat' | 'foil' | 'hologram' | 'neon';
  photo: 'large' | 'small' | 'none';
  code: 'barcode' | 'qr' | 'none';
  front: CardField[];
  back: CardField[];
  labels: Partial<Record<CardField, string>>;
}
/** Who the card is for: identity fields (any missing one shows '—'; employeeId / email derive from id). */
export interface CardIdentity { id?: string; name?: string; role?: string; specialty?: string; employeeId?: string; email?: string; hiredAt?: string; status?: string; catchphrase?: string; signature?: string; page?: string }
export interface CardStats { jobs?: number; successRate?: number; spend?: number; favoriteModel?: string }
export interface CardLine { id: CardField; label: string; value: string }
export interface CardModel extends Omit<AgentCardData, 'front' | 'back' | 'labels' | 'code'> {
  front: CardLine[];
  back: CardLine[];
  code: { kind: AgentCardData['code']; value: string; bars: number[] };
}
export const AGENT_CARD_TYPE: 'agent-card';
export const CARD_ENUMS: { readonly [K in 'design' | 'orientation' | 'logo' | 'surface' | 'accent' | 'finish' | 'photo' | 'code']: readonly AgentCardData[K][] };
export const CARD_FIELDS: Record<CardField, string>;
export const CARD_MAX_FIELDS: number;
export const CARD_LABEL_MAX: number;
export const CARD_DEFAULTS: AgentCardData;
export function agentCardErrors(type: string, raw: unknown): string[];
export function normalizeCard(raw: unknown): AgentCardData;
export function employeeId(agentId: string): string;
export function internalEmail(agentId: string): string;
export function barcodeBars(text: string): number[];
export function cardValue(field: CardField, identity?: CardIdentity, stats?: CardStats): string;
export function cardModel(raw: unknown, identity?: CardIdentity, stats?: CardStats): CardModel;
export const AGENT_CARD_SAMPLE: { identity: CardIdentity; stats: CardStats };
export function agentCardSchemaProperties(): Record<string, unknown>;
