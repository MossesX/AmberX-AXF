import { installFetchShare } from './fetchShare';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AxfProvider } from './axf/react';
import manifest from '../axf.manifest.json';
import { createConsoleRuntime } from './runtime';
import { App } from './App';
import './axf/ui/axf.css';
import './console.css';

// One shared read per source for every card, a quiet background tab and 5xx backoff (src/fetchShare.ts).
installFetchShare();

// The runtime and its assets (src/runtime.ts, shared with the native surface in src/surface.tsx).
const axf = createConsoleRuntime();

// One-time move to the new default toolbar for browsers that saved their choices before saves recorded the
// app's defaults (newer saves carry them, and the runtime adopts a changed default by itself).
try {
  const raw = localStorage.getItem(`axf:${manifest.app.id}`);
  const saved = raw ? (JSON.parse(raw) as { active?: { toolbar?: string }; defaults?: unknown }) : null;
  if (saved && !saved.defaults && saved.active?.toolbar === 'standard-icons') axf.swapAll({ toolbar: manifest.defaults.toolbar });
} catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
