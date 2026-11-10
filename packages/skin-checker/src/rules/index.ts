/**
 * The rule registry: every rule the default engine runs, in run order. A new rule is a row in contract.ts
 * SKIN_CHECK_RULES plus a file here; `ALL_RULES` is what index.ts registers.
 */
import type { SkinCheckRule } from '../contract.ts';
import { SPACING_RULES } from './spacing-scale.ts';
import { TYPOGRAPHY_RULES } from './typography.ts';

export const ALL_RULES: readonly SkinCheckRule[] = [...SPACING_RULES, ...TYPOGRAPHY_RULES];
