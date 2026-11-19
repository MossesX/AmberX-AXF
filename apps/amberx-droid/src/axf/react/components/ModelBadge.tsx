/*
 * The model that built a plugin or library (plugin@1 `builtWith`, Oct 23 2026: Brett, "anytime information about a plugin
 * is displayed, show what model built it"). A theme-styled chip (fx-chip + tone), so it follows the app's style theme.
 */
const LABELS: Record<string, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
const TONES: Record<string, 'accent' | 'success' | 'warning' | undefined> = { fable: 'accent', opus: 'success', sonnet: 'warning' };

/** "opus" / "claude-opus-5-5" / "Opus" → "Opus"; unknown ids keep their own spelling. */
export function modelFamily(model: string | null | undefined): string {
  const m = String(model ?? '').toLowerCase();
  return Object.keys(LABELS).find((k) => m === k || m.includes(k)) ?? m;
}
export function modelLabel(model: string | null | undefined): string {
  const f = modelFamily(model);
  return LABELS[f] ?? (String(model ?? '').trim() || 'Unknown');
}

/** `Built with Opus` chip; `compact` shows just the model name. Nothing at all when the model isn't known. */
export function ModelBadge({ model, builtAt, compact }: { model?: string | null; builtAt?: string | null; compact?: boolean }) {
  if (!model) return null;
  const tone = TONES[modelFamily(model)];
  const label = modelLabel(model);
  const title = `Built with ${label}${builtAt ? ` on ${builtAt.slice(0, 10)}` : ''}`;
  return <span className={`fx-chip fx-chip--model ${tone ? `fx-chip--${tone}` : ''}`} title={title} aria-label={title} data-axf-model={modelFamily(model)}>{compact ? label : `Built with ${label}`}</span>;
}
