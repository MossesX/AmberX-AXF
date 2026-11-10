/**
 * @axf/skin-checker: skin-check@1. The contract, the settings schema, the pure engine with every rule registered,
 * and the colour maths. The Node loader (`load-skin.ts`) and the core every surface calls (`core.ts`) are separate
 * entry points because they touch the file system.
 */
export * from './contract.ts';
export * from './settings-schema.ts';
export { assetData, createSkinCheckEngine, defineRule, readToken, tokenRef, SUBJECT_KEY } from './engine.ts';
export { colorVar, scaleVar, styleVar, subjectVars } from './vars.ts';
export { ALL_RULES } from './rules/index.ts';
import { createSkinCheckEngine } from './engine.ts';
import { ALL_RULES } from './rules/index.ts';

/** The engine with every rule registered: what the editor, the core, CI and the tests use. */
export const skinChecker = createSkinCheckEngine(ALL_RULES);
