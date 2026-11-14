/**
 * Async alert / confirm / prompt (themed-controls@1 → Native fallback; spec/THEMED-CONTROLS.md). Call sites await
 * these instead of `window.alert / confirm / prompt`:
 *
 *   import { dialogs } from '@console/axf/react';
 *   if (!(await dialogs.confirm('Delete this note?', { destructive: true }))) return;
 *   const name = await dialogs.prompt('Name', 'untitled');   // null = cancelled
 *
 * Whatever registers a provider (a themed-controls host, a test) draws them; with none, the browser's own boxes answer
 * (captured at load, so a host that swaps window.alert / confirm / prompt never loops back into itself). The framework
 * never names who provides them.
 */

export interface DialogOptions {
  /** title above the message (default: the app's name for alert, "Are you sure?" for a destructive confirm) */
  title?: string;
  /** OK button text */
  ok?: string;
  /** Cancel button text */
  cancel?: string;
  /** the confirm deletes or resets something: the OK button is the danger tone and must be answered on purpose */
  destructive?: boolean;
}

export interface DialogProvider {
  alert(message: string, opts?: DialogOptions): Promise<void>;
  confirm(message: string, opts?: DialogOptions): Promise<boolean>;
  prompt(message: string, defaultValue?: string, opts?: DialogOptions): Promise<string | null>;
}

const g = globalThis as unknown as { alert?: (m?: string) => void; confirm?: (m?: string) => boolean; prompt?: (m?: string, d?: string) => string | null };
/** The browser's own boxes, as they were when the framework loaded. */
export const nativeDialogFns = { alert: g.alert?.bind(globalThis), confirm: g.confirm?.bind(globalThis), prompt: g.prompt?.bind(globalThis) };

const native: DialogProvider = {
  alert: async (m) => { nativeDialogFns.alert?.(m); },
  confirm: async (m) => nativeDialogFns.confirm?.(m) ?? false,
  prompt: async (m, d) => nativeDialogFns.prompt?.(m, d) ?? null,
};

let provider: DialogProvider | null = null;

/** Register who draws the dialogs (null = the browser again). Returns a remover that only removes this provider. */
export function setDialogProvider(p: DialogProvider | null): () => void {
  provider = p;
  return () => { if (provider === p) provider = null; };
}

/** Is a themed provider drawing the dialogs right now? */
export const dialogProviderActive = (): boolean => provider !== null;

const text = (m: unknown) => (m === undefined || m === null ? '' : String(m));

/** alert / confirm / prompt that return Promises; themed when a provider is registered, the browser's otherwise. */
export const dialogs: DialogProvider = {
  alert: (m, o) => (provider ?? native).alert(text(m), o),
  confirm: (m, o) => (provider ?? native).confirm(text(m), o),
  prompt: (m, d, o) => (provider ?? native).prompt(text(m), d === undefined || d === null ? undefined : String(d), o),
};
