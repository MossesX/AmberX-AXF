import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createFrame, type FrameManifest } from './frame/core';
import { FrameProvider } from './frame/react';
import manifest from '../frame.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import './frame/ui/frame.css';

// Every JSON file under src/assets is registered as a hot-swappable asset.
const assetModules = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });

const frame = createFrame({
  manifest: manifest as FrameManifest,
  assets: Object.values(assetModules),
});
registerActions(frame);

if (frame.loadErrors.length) console.warn('[frame] assets skipped:', frame.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FrameProvider runtime={frame}>
      <App />
    </FrameProvider>
  </StrictMode>,
);
