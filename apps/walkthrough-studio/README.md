# Walkthrough Studio

A video walkthrough assembly suite built on **AmberX AXF** (`react-ts`, developer app). It plans a narrated screen
walkthrough of the framework piece by piece, records the mouse over live pages, and compiles everything into one timeline
that can be swapped around and recompiled in an instant. The first project it opens is **AmberX AXF — the complete
walkthrough**: every engine, setting, switch, plugin, data flow and action flow, axHub, MCP, GitHub automation, Coolify,
Hostinger and Moshi, each as a narrated piece with its cue track and the effect to show.

```bash
npm install
VITE_AXF_HUB=off npm run dev   # local: settings on this device (the deployed app follows axHub like every developer app)
npm run build
npx -y tsx test.mts            # model + compiler self-test
```

## What's in it

| Part | Where |
| --- | --- |
| Projects column — new, duplicate, rename, compile, export, import, delete (toolbar + right-click) | `src/studio/panes/outline.tsx` |
| Index — categorized multi-level tree, search, status / kind / recorded filters, drag-and-drop | `panes/outline.tsx` |
| Status grid — sub-grid per category, expandable rows, status, progress bar, clip length, estimate, target, hideable + sortable columns, drag to arrange or to the pop-up trash can | `panes/grid.tsx`, `columns.ts`, `dnd.tsx` |
| Script — narration (spoken with the browser's voice) + cue track | `panes/writing.tsx` |
| Live browser + recorder (capture layer / same-site events, optional screen video), Recordings, Event track, Files (project files + a folder on this device) | `panes/capture.tsx` |
| Compiler — chapter cards, timed captions, cue timing, incremental recompile, warnings; Preview (voice, captions, cursor), Timeline (drag to swap), Captions, Export (timeline JSON, SRT, VTT, script, shot list, EDL, Claude brief) | `compiler.ts`, `panes/video.tsx` |
| Dashboard, Project settings (desired length — no limit —, piece length, voice, speed, picture, captions, leave-out statuses), Trash, Log | `panes/project.tsx` |
| Workspace — 7 layouts (IDE, Grid, Record, Write, Review, Compile, Focus), 18 panes shown / hidden / moved / floated at any time, splitters, maximise | `Workspace.tsx`, `ui.ts` |
| Toolbars — two by default, any number more, docked on any edge or floating; customizer with a categorized, sortable, searchable tree of every command, pane, layout, column, framework action, view, setting and look | `Workspace.tsx`, `dialogs.tsx`, `commands.ts` |
| Application menu, banner (built %, recording, review count, search, compile, day/night, clock), icon-rail navigation | `src/assets/*/walkthrough-studio.json`, `wiring.ts` |

Projects are `walkthrough-project@1` on this device; **Keep projects on axHub** also saves them to the hub's data server
(`/data/walkthrough-studio/…`, a head document + piece chunks under 64 KB each). Screen video stays on the device.
