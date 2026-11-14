/**
 * Vite plugin for apps using the alerts library: serves its web push service worker at a fixed path (`/alerts-sw.js`
 * by default) in dev and copies it into the build. A service worker must be a real same-origin file — Vite would
 * otherwise inline a small file as a data: URL, which browsers refuse to register.
 *
 *   import { alertsServiceWorker } from './src/axf/libs/alerts/vite-plugin.mjs';
 *   plugins: [alertsServiceWorker(), ...]
 *   createAlertsLibrary({ transport, serviceWorkerUrl: '/alerts-sw.js' })
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function alertsServiceWorker({ at = '/alerts-sw.js' } = {}) {
  const file = fileURLToPath(new URL('./alerts-sw.js', import.meta.url));
  const name = at.replace(/^\//, '');
  return {
    name: 'axf-alerts-service-worker',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== at) return next();
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: name, source: readFileSync(file) });
    },
  };
}
