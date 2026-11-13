// Types for asset-gate.mjs (asset-gate@1; shared by the web runtime, the build engine / console API and the spec check).
export const ASSET_GATE_CONTRACT: 'asset-gate@1';
export const ASSET_FRAME: 'asset@1';
export const ASSET_ID_PATTERN: string;
export const MANIFEST_FIELDS: readonly ['$axf', 'type', 'id', 'name', 'version', 'data'];
export type GateReason = 'ok' | 'bad-type' | 'bad-id' | 'no-manifest' | 'invalid';
export const GATE_REASONS: readonly GateReason[];
export const GATE_LABELS: Record<GateReason, string>;
/** A pick a pane, a picker or an action wants to apply. */
export interface AssetPick { type: string; id: string }
/** What the gate needs from the caller: the type test, the registry and the shared validator. */
export interface GateContext {
  isType: (type: string) => boolean;
  get: (type: string, id: string) => unknown;
  validate: (raw: unknown) => { ok: boolean; errors: string[] };
}
export interface GateResult {
  contract: 'asset-gate@1';
  ok: boolean;
  type: string;
  id: string;
  reason: GateReason;
  label: string;
  errors: string[];
}
export interface GateBatch { contract: 'asset-gate@1'; ok: boolean; results: GateResult[]; blocked: GateResult[] }
export interface GateState extends GateResult { message: string }
export function manifestErrors(raw: unknown, type: string, id: string): string[];
export function gateAsset(pick: Partial<AssetPick> | null | undefined, ctx: GateContext): GateResult;
export function gatePicks(picks: Partial<AssetPick>[], ctx: GateContext): GateBatch;
export function gateMessage(r: GateResult | null | undefined): string;
export function gateState(r: GateResult | null | undefined): GateState;
