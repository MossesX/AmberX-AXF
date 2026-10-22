/**
 * API client library (`ai.amberx.axf.apiclient`) — the token + call layer every AXF web app had its own copy of.
 *
 * - `createTokenStore({ key })`: the app's token in localStorage (every access wrapped; a change event on window).
 * - `createApiClient({ url, tokens, messages })`: Bearer `call` / `post` / `put` / `patch` / `del`, `ApiError` with the
 *   HTTP status, the standard 401 / 404 messages, `download` (Content-Disposition name) and `blob`.
 * - `<TokenDialog tokens={…} close={…} />` (or `tokenDialog({...})` for a DialogMap entry): paste / change / forget the
 *   token, built from the framework's React controls and theme classes only.
 *
 * Streams: `framework/core/sse.ts` (`readSse`, `followSse`). Pure core in `./client.ts` (no React).
 */
import { useState, type ReactNode } from 'react';
import { Button, useRuntime, type DialogDef } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import type { TokenStore } from './client';

export * from './client';

export const APICLIENT_LIBRARY_ID = 'ai.amberx.axf.apiclient';

export interface TokenDialogProps {
  tokens: TokenStore;
  close: () => void;
  /** text above the field (what the token is and where it comes from) */
  description?: ReactNode;
  /** field placeholder, e.g. `AXF_TOKEN` */
  placeholder?: string;
  /** a visible label around the field (default: none; the field gets `ariaLabel`) */
  label?: string;
  ariaLabel?: string;
  /** toast after saving / clearing (default: none) */
  savedToast?: string;
  clearedToast?: string;
  /** show a Forget token button when a token is saved */
  allowForget?: boolean;
  /** Save stays disabled while the field is empty (default false: saving empty clears the token) */
  requireValue?: boolean;
  saveIcon?: string;
  autoFocus?: boolean;
  /** called after the token changed (saved, cleared or forgotten) */
  onChange?: (token: string) => void;
}

/** Paste / change the app's token. Uses only framework controls (`Button`) and theme classes (`fx-*`). */
export function TokenDialog(p: TokenDialogProps) {
  const rt = useRuntime();
  const [value, setValue] = useState(() => p.tokens.get());
  const done = (t: string) => {
    p.tokens.set(t);
    const msg = t ? p.savedToast : p.clearedToast;
    if (msg) rt.toast(msg, 'success');
    p.close();
    p.onChange?.(t);
  };
  const input = (
    <input className="fx-input fx-mono" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)}
      placeholder={p.placeholder} aria-label={p.label ? undefined : p.ariaLabel ?? p.placeholder ?? 'Token'} autoFocus={p.autoFocus} />
  );
  return (
    <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); done(value.trim()); }}>
      {p.description != null && <p className="fx-muted" style={{ margin: 0 }}>{p.description}</p>}
      {p.label ? <label className="fx-field">{p.label}{input}</label> : input}
      <div className="fx-row" style={{ justifyContent: 'flex-end' }}>
        {p.allowForget && p.tokens.get() && <Button tone="ghost" onClick={() => done('')}>Forget token</Button>}
        <Button onClick={p.close}>Cancel</Button>
        <Button tone="primary" icon={p.saveIcon ?? 'save'} type="submit" disabled={p.requireValue ? !value.trim() : false}>Save</Button>
      </div>
    </form>
  );
}

/** A DialogMap entry for the token dialog: `dialogs = { token: tokenDialog({ title: 'App token', tokens, … }) }`. */
export function tokenDialog(o: Omit<TokenDialogProps, 'close'> & { title: string; icon?: string }): DialogDef {
  const { title, icon, ...props } = o;
  return { title, icon: icon ?? 'lock', render: (_p, close) => <TokenDialog {...props} close={close} /> };
}

/** Nothing to register: apps use the functions and the dialog directly; the entry lists the library in Settings → Plugins. */
export const library: AxfWebLibrary = {
  id: APICLIENT_LIBRARY_ID,
  label: 'API client',
  version: '0.1.0',
  provides: ['axf.apiclient'],
};
