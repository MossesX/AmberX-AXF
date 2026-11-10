/**
 * The AI assistant's per-chat model picker (pure, no React, no network): Claude (the model policy's Opus / Fable on the
 * console's Claude profile) or a local Ollama model (every model of every enabled Ollama profile). A choice is a
 * conversation-settings patch (assistant@1 `profileId` + `model`), so the same chat keeps its model on every device.
 */
import { chatModels, modelName } from '@console/axf/libs/claude-session';

export interface ModelChoice {
  /** stable key for the picker: `claude:<policy key>` or `ollama:<profile id>:<model>` */
  key: string;
  label: string;
  /** Claude or a local model */
  family: 'claude' | 'local';
  /** the conversation settings this choice writes ('' profileId = the console's default / Claude profile) */
  settings: { profileId: string; model: string };
}
export interface ProfileLike { id: string; kind: string; label: string; models?: string[]; defaultModel?: string; enabled?: boolean }

const CLAUDE_KINDS = new Set(['claude-code', 'anthropic']);
const LOCAL_KINDS = new Set(['ollama']);

/** The profile Claude chats run on: the default when it is Claude, else the first Claude profile ('' = the default). */
export function claudeProfile(profiles: ProfileLike[], defaultId: string): string {
  const d = profiles.find((p) => p.id === defaultId);
  if (!d || CLAUDE_KINDS.has(d.kind)) return '';
  return profiles.find((p) => CLAUDE_KINDS.has(p.kind) && p.enabled !== false)?.id ?? '';
}

/** Every model a chat may switch to: Claude first (policy order), then each local Ollama model. Pure. */
export function modelChoices(profiles: ProfileLike[], defaultId = ''): ModelChoice[] {
  const cp = claudeProfile(profiles, defaultId);
  const out: ModelChoice[] = chatModels().map((m) => ({ key: `claude:${m.key}`, label: `Claude ${modelName(m.id).replace(/^Claude\s+/i, '')}`, family: 'claude', settings: { profileId: cp, model: m.id } }));
  for (const p of profiles) {
    if (!LOCAL_KINDS.has(p.kind) || p.enabled === false) continue;
    const models = [...new Set([p.defaultModel ?? '', ...(p.models ?? [])].filter(Boolean))];
    for (const m of models) out.push({ key: `ollama:${p.id}:${m}`, label: `Local · ${m}`, family: 'local', settings: { profileId: p.id, model: m } });
  }
  return out;
}

/** The choice a chat's settings match (Claude Opus when it names nothing or something not listed). Pure. */
export function currentChoice(choices: ModelChoice[], s: { profileId?: string; model?: string }): ModelChoice | undefined {
  const pid = s.profileId ?? '';
  const exact = choices.find((c) => c.settings.model === (s.model ?? '') && (c.settings.profileId === pid || (c.family === 'claude' && !pid)));
  if (exact) return exact;
  const local = choices.find((c) => c.family === 'local' && c.settings.profileId === pid && pid);
  return local ?? choices.find((c) => c.family === 'claude');
}

/** A setting value or an API argument ("fable", "claude:fable", "ollama", "llama3.1", "ollama:local:llama3.1") → a choice. Pure. */
export function findChoice(choices: ModelChoice[], q: string): ModelChoice | undefined {
  const s = q.trim().toLowerCase();
  if (!s) return undefined;
  return choices.find((c) => c.key.toLowerCase() === s)
    ?? choices.find((c) => c.key.toLowerCase() === `claude:${s}`)
    ?? choices.find((c) => c.settings.model.toLowerCase() === s)
    ?? (s === 'ollama' || s === 'local' ? choices.find((c) => c.family === 'local') : undefined)
    ?? choices.find((c) => c.label.toLowerCase().includes(s));
}
