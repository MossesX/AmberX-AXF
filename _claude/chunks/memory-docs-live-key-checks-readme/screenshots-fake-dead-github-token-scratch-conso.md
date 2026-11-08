<!-- memory-chunk@1 source=_claude/memory/docs/live-key-checks/README.md tokens=172 -->
## Screenshots (fake dead GitHub token, scratch console)
| Phone | Desktop |
|---|---|
| ![banners phone](shots/banners-phone.png) | ![banners desktop](shots/banners-desktop.png) |
| ![keys dialog phone](shots/keys-dialog-phone.png) | ![keys dialog desktop](shots/keys-dialog-desktop.png) |

Taken with `framework/cli/rebuild-shots.mjs` (`AXF_APPEARANCE_HUB=off`). In headless Chromium the banner strip kept
`data-fx-empty="on"` although its banners had content (framework `useStripEmpty`, `framework/react/components/Slots.tsx`),
so the shots add a style that shows the strip anyway. Worth a look in a real browser: if the strip ever hides real
banners there, nothing here can be seen.
