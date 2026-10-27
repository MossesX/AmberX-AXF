/**
 * overlay@1 validation rules, shared by the TS engine (core/engines/overlay.ts), the build engine (cli/build-engine.mjs)
 * and anything else that runs on plain Node. One validator, one wording; the Kotlin AssetValidator + OverlayEngine mirror it
 * (fixture spec/fixtures/overlay.json → errors).
 */
export const OVERLAY_LIMITS = Object.freeze({
  opacityMin: 0.2, opacityMax: 1, opacityDefault: 0.92,
  logLinesMin: 1, logLinesMax: 50, logLinesDefault: 5,
  stripLinesMin: 1, stripLinesMax: 6, stripLinesDefault: 3,
  stripMsMin: 500, stripMsMax: 30000, stripMsDefault: 3000,
  widthMin: 48, widthMax: 1200, heightMin: 32, heightMax: 1600,
  screenPctMin: 20, screenPctMax: 100,
  chipsMax: 6, labelMax: 24, tagMax: 24, lineTextMax: 200, logKeepMax: 200,
});

export const CHIP_TONES = Object.freeze(['neutral', 'success', 'warning', 'danger', 'accent', 'muted', 'info']);
export const CHIP_ID = /^[a-z0-9][a-z0-9._-]*$/;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Validation messages for an overlay asset's `data`. Strict where normalising is lenient. */
export function overlayErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const e = [];
  const L = OVERLAY_LIMITS;
  const numField = (path, v, lo, hi) => {
    if (v === undefined) return;
    const n = num(v);
    if (n === null || n < lo || n > hi) e.push(`${path} must be a number from ${lo} to ${hi}`);
  };
  const boolField = (path, v) => { if (v !== undefined && typeof v !== 'boolean') e.push(`${path} must be true or false`); };
  if (!isObj(raw.pill)) e.push('data.pill must be an object');
  else {
    if (!Array.isArray(raw.pill.chips)) e.push('data.pill.chips must be a list');
    else {
      if (raw.pill.chips.length > L.chipsMax) e.push(`data.pill.chips: at most ${L.chipsMax} chips`);
      const ids = new Set();
      raw.pill.chips.forEach((c, i) => {
        if (!isObj(c) || typeof c.id !== 'string' || !CHIP_ID.test(c.id)) { e.push(`data.pill.chips[${i}].id must be an id (lowercase letters, digits, . _ -)`); return; }
        if (ids.has(c.id)) e.push(`data.pill.chips[${i}].id "${c.id}" repeats`);
        ids.add(c.id);
        if (c.tone !== undefined && !CHIP_TONES.includes(c.tone)) e.push(`data.pill.chips[${i}].tone must be one of: ${CHIP_TONES.join(', ')}`);
        if (c.offTone !== undefined && !CHIP_TONES.includes(c.offTone)) e.push(`data.pill.chips[${i}].offTone must be one of: ${CHIP_TONES.join(', ')}`);
        if (c.label !== undefined && typeof c.label !== 'string') e.push(`data.pill.chips[${i}].label must be a string`);
      });
    }
    if (raw.pill.quickAction !== undefined && typeof raw.pill.quickAction !== 'string') e.push('data.pill.quickAction must be an action spec string');
  }
  if (!isObj(raw.log)) e.push('data.log must be an object');
  else { boolField('data.log.show', raw.log.show); numField('data.log.maxLines', raw.log.maxLines, L.logLinesMin, L.logLinesMax); boolField('data.log.showConfidence', raw.log.showConfidence); }
  if (!isObj(raw.strip)) e.push('data.strip must be an object');
  else { boolField('data.strip.show', raw.strip.show); numField('data.strip.maxLines', raw.strip.maxLines, L.stripLinesMin, L.stripLinesMax); numField('data.strip.lineMs', raw.strip.lineMs, L.stripMsMin, L.stripMsMax); }
  if (!isObj(raw.mini)) e.push('data.mini must be an object');
  else {
    boolField('data.mini.defaultOpen', raw.mini.defaultOpen);
    for (const [k, lo, hi] of [['width', L.widthMin, L.widthMax], ['height', L.heightMin, L.heightMax]]) {
      const r = raw.mini[k];
      if (r === undefined) continue;
      if (!isObj(r)) { e.push(`data.mini.${k} must be { min, max, default }`); continue; }
      numField(`data.mini.${k}.min`, r.min, lo, hi); numField(`data.mini.${k}.max`, r.max, lo, hi); numField(`data.mini.${k}.default`, r.default, lo, hi);
      if (num(r.min) !== null && num(r.max) !== null && r.min > r.max) e.push(`data.mini.${k}.min must not be above max`);
    }
  }
  numField('data.opacity', raw.opacity, L.opacityMin, L.opacityMax);
  boolField('data.positionLock', raw.positionLock);
  if (raw.size !== undefined) {
    if (!isObj(raw.size)) e.push('data.size must be an object');
    else {
      numField('data.size.minWidth', raw.size.minWidth, L.widthMin, L.widthMax); numField('data.size.maxWidth', raw.size.maxWidth, L.widthMin, L.widthMax);
      numField('data.size.minHeight', raw.size.minHeight, L.heightMin, L.heightMax); numField('data.size.maxHeight', raw.size.maxHeight, L.heightMin, L.heightMax);
      numField('data.size.maxScreenWidthPct', raw.size.maxScreenWidthPct, L.screenPctMin, L.screenPctMax); numField('data.size.maxScreenHeightPct', raw.size.maxScreenHeightPct, L.screenPctMin, L.screenPctMax);
    }
  }
  return e;
}
