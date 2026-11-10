/**
 * The master switch "Inline edit mode": one value on the console server (GET/PUT mode, so REST, MCP, the CLI and voice
 * can read and flip it), mirrored into the runtime setting `axf.inline-edit.mode` that the capture layer watches
 * (framework/inline-edit/capture.mjs `bindInlineEditMode`). Flipping the switch in Settings writes the server; a flip from
 * anywhere else reaches every open console within seconds (poll every 5 s while visible, and on focus).
 */
import type { AxfRuntime } from '@console/axf/core';
import { INLINE_EDIT_MODE_KEY, inlineEditModeOn } from '../../../framework/index.mjs';
import { getMode, setMode } from './api';

export const MODE_KEY = INLINE_EDIT_MODE_KEY;

export function startModeSync(rt: AxfRuntime, onError: (msg: string) => void): () => void {
  let server: boolean | null = null;
  let applying = false;
  let writing = false;

  const mirror = (on: boolean) => {
    server = on;
    if (inlineEditModeOn(rt.settings.get(MODE_KEY)) === on) return;
    applying = true;
    try { rt.settings.set(MODE_KEY, on); } finally { applying = false; }
  };
  const pull = async () => {
    if (writing) return;
    try { mirror((await getMode()).on); } catch { /* server part off or unreachable: the local setting still works */ }
  };
  const off = rt.settings.onChange(MODE_KEY, (v) => {
    if (applying) return;
    const on = inlineEditModeOn(v);
    if (server === on) return;
    writing = true;
    setMode(on ? 'on' : 'off')
      .then((m) => { server = m.on; })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => { writing = false; });
  });
  const onFocus = () => void pull();
  globalThis.addEventListener('focus', onFocus);
  const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void pull(); }, 5_000);
  void pull();
  return () => { off(); clearInterval(timer); globalThis.removeEventListener('focus', onFocus); };
}
