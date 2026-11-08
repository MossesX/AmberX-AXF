<!-- memory-chunk@1 source=_claude/memory/docs/walkthrough-studio.md tokens=223 -->
## Libraries it runs on (harvested Oct 22 2026, Opus; pending `walkthrough-harvest`)
The studio's reusable parts are framework libraries now, each with **parts** (library@1: features inside a library you
include and configure one by one — a designer can list them under the library's Customize… sheet):
`lib-dnd` (drag-and-drop + pop-up trash), `lib-tree` (index tree), `lib-datagrid` (status grid), `lib-workspace` (panes,
layouts, docked/floating toolbars, customizer), `lib-recorder` (mouse/key recorder, replay, cues), `lib-docstore` (device +
axHub data server, chunked; device blobs). Installed in `axf.manifest.json → libraries.*` with their parts
(`axf install <lib> <app> --parts a,b --part a.key=value`). The studio keeps only its own model, compiler, panes and
commands. Contract: `core/library.ts` parts helpers = CLI `resolveParts`, fixture `spec/fixtures/library-parts.json`.
