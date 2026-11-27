/** Load a gate read and keep it fresh every `sec` seconds while the tab is shown; `reload` after a press. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { gateCall } from './api';

export function usePoll<T>(path: string, sec: number): { data: T | null; error: string; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const live = useRef(true);
  const reload = useCallback(async () => {
    try { const r = await gateCall<T>(path); if (live.current) { setData(r as T); setError(''); } }
    catch (e) { if (live.current) setError((e as Error).message); }
  }, [path]);
  useEffect(() => {
    live.current = true; void reload();
    const t = window.setInterval(() => { if (!document.hidden) void reload(); }, Math.max(5, sec) * 1000);
    return () => { live.current = false; window.clearInterval(t); };
  }, [reload, sec]);
  return { data, error, reload };
}
