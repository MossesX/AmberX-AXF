// Types for overlay-rules.mjs (shared by core/engines/overlay.ts and cli/build-engine.mjs).
export const OVERLAY_LIMITS: {
  opacityMin: number; opacityMax: number; opacityDefault: number;
  logLinesMin: number; logLinesMax: number; logLinesDefault: number;
  stripLinesMin: number; stripLinesMax: number; stripLinesDefault: number;
  stripMsMin: number; stripMsMax: number; stripMsDefault: number;
  widthMin: number; widthMax: number; heightMin: number; heightMax: number;
  screenPctMin: number; screenPctMax: number;
  chipsMax: number; labelMax: number; tagMax: number; lineTextMax: number; logKeepMax: number;
};
export const CHIP_TONES: readonly string[];
export const CHIP_ID: RegExp;
export function overlayErrors(raw: unknown): string[];
