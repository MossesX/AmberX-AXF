/** One press: run the call, toast the server's answer (or its error), then reload. `busy` is the key of the press in flight. */
import { useCallback, useState } from 'react';
import { useRuntime } from '@console/axf/react';

export function useAct(title: string, after?: () => void | Promise<void>) {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');
  const act = useCallback(async <T,>(key: string, run: () => Promise<T>, done: string | ((r: T) => string)): Promise<T | null> => {
    setBusy(key);
    try {
      const r = await run();
      rt.toast(typeof done === 'function' ? done(r) : done, 'success', title);
      await after?.();
      return r;
    } catch (e) { rt.toast((e as Error).message, 'danger', title); return null; } finally { setBusy(''); }
  }, [rt, title, after]);
  return { busy, act };
}
