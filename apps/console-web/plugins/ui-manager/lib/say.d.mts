/** Types for say.mjs: what a person says to the UI Manager, as steps. */
import type { Prop, Scalar, UiElement } from '../../../../../framework/core/engines/ui-manager-rules.mjs';

export type SayStep =
  | { op: 'select'; what: string }
  | { op: 'set'; prop: string; value: string; what?: string }
  | { op: 'reset'; what: string; prop?: string }
  | { op: 'view'; view: 'row' | 'panel' | 'grid' }
  | { op: 'unknown'; text: string };
export const VIEW_WORDS: Record<string, 'row' | 'panel' | 'grid'>;
export function parseSay(text: string): SayStep[];
export function rankElements<T extends UiElement>(elements: T[], what: string): T[];
export function rankProps(props: Prop[], what: string): Prop[];
export function pickValue(prop: Prop, said: string): Scalar;
