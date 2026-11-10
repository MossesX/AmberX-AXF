/**
 * The rule registry: every rule the default engine runs, in run order. A new rule is a row in contract.ts
 * SKIN_CHECK_RULES plus a file here; `ALL_RULES` is what index.ts registers.
 */
import type { SkinCheckRule } from '../contract.ts';
import { SPACING_RULES } from './spacing-scale.ts';
import { TYPOGRAPHY_RULES } from './typography.ts';
import { PALETTE_RULES } from './palette.ts';
import { CONTRAST_RULES } from './contrast.ts';
import { SHAPE_RULES } from './shape-consistency.ts';

export const ALL_RULES: readonly SkinCheckRule[] = [...SPACING_RULES, ...TYPOGRAPHY_RULES, ...PALETTE_RULES, ...CONTRAST_RULES, ...SHAPE_RULES];
