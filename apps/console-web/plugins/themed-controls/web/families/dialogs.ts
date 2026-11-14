/**
 * Themed alert / confirm / prompt (themed-controls@1 family `dialogs`). While the family is active this is the
 * framework's dialog provider (`dialogs.alert / confirm / prompt` from @console/axf/react return Promises and draw
 * here: a modal on a wide screen, a bottom sheet on a phone, the framework .fx-dialog surface, OK / Cancel tones from
 * the tokens). Enter answers OK, Escape answers Cancel (alert: closes), Tab stays inside, focus goes back after.
 * One dialog at a time; later ones wait their turn.
 *
 * window.alert is replaced while the family is on (it returns at once, as nothing waits for an alert's answer) and
 * restored on off. window.confirm and window.prompt must answer synchronously, which a drawn dialog can't: a Promise
 * would read as "yes" in `if (confirm(…))` and run a destructive action unasked. So they stay the browser's own boxes
 * and log the call site once, so it can be moved to the async API; every console and framework call site already is.
 */
import { dialogProps, type TcDialogKind } from '@console/axf/core/engines/themed-controls';
import { nativeDialogFns, setDialogProvider, type DialogOptions } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import type { GlobalFamily, LiveHost } from '../host';
import { h } from './dom';
import { icon, openSurface, type OpenSurface } from './surface';

export interface OpenDialog {
  id: string;
  kind: TcDialogKind;
  title: string;
  message: string;
  defaultValue: string;
  destructive: boolean;
  at: string;
  /** OK (prompt: with the text, default the field's) or Cancel */
  answer(ok: boolean, text?: string): void;
  /** the prompt field's text right now */
  text(): string;
}

let seq = 0;
const queue: { kind: TcDialogKind; message: string; defaultValue?: string; opts: DialogOptions; resolve: (v: unknown) => void }[] = [];
let current: { d: OpenDialog; surface: OpenSurface } | null = null;
let hostRef: LiveHost | null = null;

const tone = (attr: string, dflt: string) => document.documentElement.getAttribute(attr) || dflt;
/** A boolean token (compiled to 1 / 0); absent = the default. */
const flag = (name: string, dflt: boolean) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v === '' ? dflt : v !== '0'; };

function show(): void {
  if (current || !queue.length || !hostRef) return;
  const job = queue.shift()!;
  const p = dialogProps(job.kind, job.message, job.defaultValue);
  const destructive = job.opts.destructive === true;
  const title = job.opts.title ?? (job.kind === 'alert' ? (document.title || 'Message') : destructive ? 'Are you sure?' : job.kind === 'prompt' ? 'Your answer' : 'Please confirm');
  const id = `tc-dialog-${++seq}`;
  const titleEl = h('h2', { class: 'fx-tc-dlg__title', id: `${id}-t` }, flag('--fx-tc-dialogs-icon', true) ? icon(job.kind === 'alert' ? 'info' : destructive ? 'alert' : 'help') : null, h('span', {}, title));
  const msg = h('p', { class: 'fx-tc-dlg__msg', id: `${id}-m` }, p.message);
  const field = job.kind === 'prompt' ? h('input', { type: 'text', class: 'fx-input fx-tc-dlg__field', 'aria-labelledby': `${id}-m`, autocomplete: 'off' }) : null;
  if (field) field.value = p.defaultValue;
  const okTone = destructive ? 'danger' : tone('data-fx-tc-dialogs-ok-tone', 'primary');
  const cancelTone = tone('data-fx-tc-dialogs-cancel-tone', 'neutral');
  const ok = h('button', { type: 'button', class: `fx-btn fx-btn--${okTone} fx-tc-dlg__ok` });
  ok.textContent = job.opts.ok ?? (destructive ? 'Yes, do it' : p.ok);
  const cancel = p.cancel !== null ? h('button', { type: 'button', class: `fx-btn fx-btn--${cancelTone} fx-tc-dlg__cancel` }) : null;
  if (cancel) cancel.textContent = job.opts.cancel ?? p.cancel ?? 'Cancel';
  const body = h('div', { class: 'fx-tc-dlg' }, titleEl, msg, field, h('div', { class: 'fx-tc-dlg__foot' }, cancel, ok));
  let answered = false;
  const finish = (yes: boolean, text?: string) => {
    if (answered) return;
    answered = true;
    job.resolve(job.kind === 'alert' ? undefined : job.kind === 'confirm' ? yes : yes ? (text ?? field?.value ?? '') : null);
    current?.surface.close('done');
  };
  const d: OpenDialog = { id, kind: job.kind, title, message: p.message, defaultValue: p.defaultValue, destructive, at: new Date().toISOString(), answer: finish, text: () => field?.value ?? '' };
  ok.addEventListener('click', () => finish(true));
  cancel?.addEventListener('click', () => finish(false));
  body.addEventListener('keydown', (e) => {
    // Enter answers OK from the field (and from anywhere but a focused Cancel)
    if (e.key === 'Enter' && document.activeElement !== cancel && !e.isComposing) { e.preventDefault(); finish(true); }
  });
  const surface = openSurface({
    surface: hostRef.surface('dialogs'), anchor: document.activeElement instanceof HTMLElement ? document.activeElement : document.body,
    label: title, content: body, family: 'dialogs', closeOnBackdrop: false,
    initialFocus: () => field ?? (destructive && cancel ? cancel : ok),
    onClose: () => {
      if (!answered) { answered = true; job.resolve(job.kind === 'alert' ? undefined : job.kind === 'confirm' ? false : null); }
      current = null;
      queueMicrotask(show);
    },
  });
  surface.el.setAttribute('role', job.kind === 'alert' ? 'alertdialog' : 'dialog');
  surface.el.setAttribute('aria-labelledby', `${id}-t`);
  surface.el.setAttribute('aria-describedby', `${id}-m`);
  surface.el.removeAttribute('aria-label');
  current = { d, surface };
  if (field && flag('--fx-tc-dialogs-select-text', true)) requestAnimationFrame(() => field.select());
}

/** A confirm that deletes, removes, resets or drops something reads as destructive unless the caller says otherwise. */
const DESTRUCTIVE = /^\s*(delete|remove|erase|forget|uninstall|reset|clear|purge|wipe|drop|discard|end the|sign .{0,40}out|restoring replaces|reload and drop)\b/i;

function ask<T>(kind: TcDialogKind, message: string, defaultValue: string | undefined, opts: DialogOptions = {}): Promise<T> {
  const o = kind === 'confirm' && opts.destructive === undefined && DESTRUCTIVE.test(message) ? { ...opts, destructive: true } : opts;
  return new Promise<T>((resolve) => { queue.push({ kind, message, defaultValue, opts: o, resolve: resolve as (v: unknown) => void }); show(); });
}

/** The open dialog and the ones waiting (s19 API). */
export function openDialogs(): { open: Omit<OpenDialog, 'answer' | 'text'> & { text: string } | null; waiting: number } {
  const c = current?.d;
  return { open: c ? { id: c.id, kind: c.kind, title: c.title, message: c.message, defaultValue: c.defaultValue, destructive: c.destructive, at: c.at, text: c.text() } : null, waiting: queue.length };
}
export const currentDialog = (): OpenDialog | null => current?.d ?? null;

export const dialogsFamily: GlobalFamily = {
  family: 'dialogs',
  start(rt: AxfRuntime, host: LiveHost) {
    hostRef = host;
    const offProvider = setDialogProvider({
      alert: (m, o) => ask<void>('alert', m, undefined, o),
      confirm: (m, o) => ask<boolean>('confirm', m, undefined, o),
      prompt: (m, d, o) => ask<string | null>('prompt', m, d, o),
    });
    const w = globalThis as unknown as Record<string, unknown>;
    const saved = { alert: w.alert, confirm: w.confirm, prompt: w.prompt };
    const warned = new Set<string>();
    const legacy = (name: 'confirm' | 'prompt') => {
      const site = (new Error().stack ?? '').split('\n')[3]?.trim() ?? 'unknown';
      if (!warned.has(site)) { warned.add(site); rt.terminal?.warn?.('themed-controls', `window.${name}() needs a synchronous answer, so the browser's box answers it; move ${site} to dialogs.${name}() (await)`); }
    };
    w.alert = (m?: unknown) => { void ask<void>('alert', String(m ?? ''), undefined); };
    w.confirm = (m?: unknown) => { legacy('confirm'); return nativeDialogFns.confirm?.(m === undefined ? undefined : String(m)) ?? false; };
    w.prompt = (m?: unknown, d?: unknown) => { legacy('prompt'); return nativeDialogFns.prompt?.(m === undefined ? undefined : String(m), d === undefined ? undefined : String(d)) ?? null; };
    return () => {
      offProvider();
      if (w.alert !== saved.alert) w.alert = saved.alert;
      if (w.confirm !== saved.confirm) w.confirm = saved.confirm;
      if (w.prompt !== saved.prompt) w.prompt = saved.prompt;
      // anything still open or waiting is cancelled (alert: dismissed), so no caller hangs
      current?.surface.close('api');
      for (const j of queue.splice(0)) j.resolve(j.kind === 'alert' ? undefined : j.kind === 'confirm' ? false : null);
      hostRef = null;
    };
  },
  report: () => openDialogs(),
  api: () => ({ openDialogs, currentDialog }),
};
