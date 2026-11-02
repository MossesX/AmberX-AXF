# Molly

One interface for **AmberX**, **axHub** and the **Dev Console**, at https://molly.amberxai.com (build `molly-opus`,
Big Dog profile, Opus; a Fable version comes later as its own build).

- Each app stays its own app at its own address (`amberx.amberxai.com`, `axhub.amberxai.com`, `console.amberxai.com`)
  and runs exactly the same on its own. Molly only frames that address: plain URL, no embed marker, nothing hidden,
  taken over or merged.
- Frames are kept alive (`src/molly/FrameDeck.tsx`): switching apps never reloads them. Reload or open the one on screen
  on its own from the Molly menu or toolbar.
- Deep links: `#/<app>/<route>` (for example `#/console/builds`) open straight on that app's route.
- The look comes from axHub only (`developer.hub`), like every app; Molly ships the shared asset set at `src/axf/assets`.
  Its own assets are its nav menu, app menu and toolbar (`src/assets/*/molly.json`). The app list is `src/molly/apps.ts`.
- The only changes outside this folder: axHub web's and AmberX's `frame-ancestors` now allow `https://molly.amberxai.com`.

```bash
npm install && npm run dev      # :5173
docker build -t molly . && docker run -p 7490:8080 molly
```
