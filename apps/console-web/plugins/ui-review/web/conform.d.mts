/** Types for conform.mjs: working records ↔ ui-review-item@1 / ui-review-group@1. */
import * as S from '../../../../../framework/core/ui-review-schema.mjs';
import type { SchemaError, UiReviewGroup, UiReviewItem } from '../../../../../framework/core/ui-review-schema.mjs';

export { S as schema };
export const ITEM_TAG: string;
export const GROUP_TAG: string;
type Rec = Record<string, unknown>;
export function submitterOf(o: Rec): { type: string; id: string } | undefined;
export function reviewToStored(r: Rec, groups?: Rec[]): { item: UiReviewItem; errors: SchemaError[] };
export function storedToReview(it: unknown): any;
export function shotToStored(x: Rec, groups?: Rec[]): { item: UiReviewItem; errors: SchemaError[] };
export function storedToShot(it: unknown): any;
export function groupToStored(g: Rec): { group: UiReviewGroup; errors: SchemaError[] };
export function storeErrors(items: Rec[], groups?: Rec[]): (SchemaError & { id?: string })[];
export function refuse(errors: SchemaError[]): void;
