/** pass-approval@1 signing on Node (./node.mjs). */
import type { DecidedByToken, PassActionCode, PassDecision, PassLike } from './index.d.mts';

export function passSecret(): string;
export function hmacHex(secret: string, message: string): string;
export function newNonce(): string;

export interface MintOptions { now?: number; secret?: string; nonce?: string }
export interface Minted { token: string; exp: number; nonce: string }
export function mintActionToken(pass: PassLike, decision: PassDecision, opts?: MintOptions): Minted;
export function mintActionTokens(pass: PassLike, opts?: MintOptions): { approve: string; deny: string };

export interface VerifyOptions { now?: number; secret?: string; stateAt?: string; decidedBy?: DecidedByToken | null }
export type Verified = { ok: true; decision: PassDecision; nonce: string; already: boolean } | { ok: false; code: PassActionCode };
export function verifyActionToken(token: string, pass: PassLike | null, opts?: VerifyOptions): Verified;
