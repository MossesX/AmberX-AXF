/**
 * apps/console-web/framework — framework-level pieces of the inline element editing build
 * (inline-element-editing-plugin-right-click-any-el; contract docs/contracts/inline-edit-tokens.md).
 *
 *   tokens/element-map.mjs      inline-edit-tokens@1: one stable path per framework element, from the rendered markup
 *   tokens/resolve.mjs          every settable token of an element and each parent, its value and its axHub source
 *   tokens/overrides-store.mjs  inline-override@1: get / set / unset / list over the look settings axf.inline.<root>
 *   tokens/migrations/…         2026-11: axf.custom.* and axf.chrome.* → records (dry by default)
 *   inline-edit/capture.mjs     the right-click capture layer, attached only while inline edit mode is on
 *
 * Plain ESM, no React, no runtime import: the console (and any other developer app) wires these to its runtime; the
 * plugin that draws the dialog and the overrides list consumes them. Tests: node apps/console-web/framework/test.mjs.
 */
export * from './tokens/element-map.mjs';
export * from './tokens/resolve.mjs';
export * from './tokens/overrides-store.mjs';
export * as inlineOverridesMigration2026_11 from './tokens/migrations/2026-11-inline-overrides.mjs';
export * from './inline-edit/capture.mjs';
