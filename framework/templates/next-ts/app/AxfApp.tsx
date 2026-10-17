'use client';

import { useEffect, useState } from 'react';
import { createAxf, type AxfManifest, type AxfRuntime } from '../src/axf/core';
import { AxfProvider } from '../src/axf/react';
import { registerActions } from '../src/actions';
import { App } from '../src/App';

/**
 * Creates the AXF runtime once in the browser and mounts the shell. The runtime restores the user's hot-swap
 * choices from localStorage, so it is created after mount (nothing browser-specific is rendered on the server,
 * which keeps hydration clean); until then a token-styled loading shell is shown.
 */
export function AxfApp({ manifest, assets }: { manifest: AxfManifest; assets: unknown[] }) {
  const [axf, setAxf] = useState<AxfRuntime | null>(null);
  useEffect(() => {
    const rt = createAxf({ manifest, assets });
    registerActions(rt);
    if (rt.loadErrors.length) console.warn('[axf] assets skipped:', rt.loadErrors);
    setAxf(rt);
  }, [manifest, assets]);
  if (!axf) return <div className="fx-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><span className="fx-muted">Loading {manifest.app.name}…</span></div>;
  return <AxfProvider runtime={axf}><App /></AxfProvider>;
}
