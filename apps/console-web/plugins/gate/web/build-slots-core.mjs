/**
 * Parallel builds and the host cap, side by side (Settings → Plugins → Gate → Builds at once). Pure: what the panel
 * shows and sends, from GET /api/plugins/gate/build-slots. Two numbers that belong together:
 *   stepsInParallel  steps of one build that run at once (pipeline-settings@1, 1 to 12; anyone may change it)
 *   hostCap          builds the VPS runs at once, whoever asks (build-limit@1 maxBuilds; Brett's own console only)
 */

/** A field's text → { value } when it is a whole number inside the range, else { error } in plain words. */
export function parseCount(text, { min, max }) {
  const t = String(text ?? '').trim();
  if (!/^\d+$/.test(t)) return { error: `A whole number from ${min} to ${max}.` };
  const value = Number(t);
  return value < min || value > max ? { error: `From ${min} to ${max}.` } : { value };
}

/** The note under the two fields when more steps are allowed than the host runs; '' at or under the cap. */
export function overNote(steps, cap) {
  if (!Number.isInteger(steps) || !Number.isInteger(cap) || steps <= cap) return '';
  return `Steps in parallel (${steps}) is above the host cap (${cap}): at most ${cap} run at once until the cap is raised.`;
}

/**
 * What Save sends: only the numbers that changed, and the host cap only from a caller who may edit it.
 * `slots` = the server's answer, `draft` = { steps, cap } as typed. → { patch, errors: { steps?, cap? } }
 */
export function patchOf(slots, draft) {
  const patch = {}; const errors = {};
  const s = slots?.stepsInParallel; const c = slots?.hostCap;
  if (s?.available && String(draft.steps) !== String(s.value)) {
    const r = parseCount(draft.steps, s);
    if (r.error) errors.steps = r.error; else patch.stepsInParallel = r.value;
  }
  if (c?.available && c.canEdit && String(draft.cap) !== String(c.value)) {
    const r = parseCount(draft.cap, c);
    if (r.error) errors.cap = r.error; else patch.maxBuilds = r.value;
  }
  return { patch, errors };
}

/** The numbers the note is about while typing: the draft when it parses, else the saved value. */
export function previewOver(slots, draft) {
  const pick = (field, text) => (field?.available ? (parseCount(text, field).value ?? field.value) : null);
  return overNote(pick(slots?.stepsInParallel, draft.steps), pick(slots?.hostCap, draft.cap));
}
