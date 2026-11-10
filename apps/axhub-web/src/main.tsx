import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AxfProvider } from './axf/react';
import { App } from './App';
import { createHubWebRuntime } from './runtime';
import { installRouter } from './hub/route';
import './hub.css';
import './axf/ui/axf.css';

// The runtime, its assets and the look from axHub (src/runtime.ts, shared with the native surface in src/surface.tsx).
const axf = createHubWebRuntime();
// The address bar follows the page (the hub sends its old links here as #/<route>).
installRouter(axf);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
