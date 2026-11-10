// First: Mic off guards getUserMedia and SpeechRecognition before any module captures them (micguard.ts).
import './micguard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AxfProvider } from './axf/react';
import { createAmberXRuntime } from './runtime';
import { App } from './App';
import { HUB } from './hub/useHub';
import { installVetoHost, routeHubFetch } from './native';
import './axf/ui/axf.css';

// Inside the Android shell, hub reads go through the native side (the hub session lives in Android's cookie store).
routeHubFetch(HUB);
// The veto banner plugin's phone side: Deny / Approve / Shelve with the phone's session, the alarm, notification taps.
installVetoHost();

// The runtime, its assets and the look from axHub (src/runtime.ts, shared with the native surface in src/surface.tsx).
const axf = createAmberXRuntime();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
