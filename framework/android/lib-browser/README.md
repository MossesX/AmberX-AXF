# lib-browser

The floating library browser as a reusable library: two-pane item list → multi-select → Compare opens the selection as tabs in a floating group (undock, drag-and-drop, split, minimize, tree/grid explorer). Attaches to the tab groups declared under `libraries.browser.tabGroups` in `axf.manifest.json`; the app registers a `BrowserItemProvider` per group and renders `TabBrowserView(groupId)`. `library.json` declares the parameters the install wizard asks for (`axf install browser --app apps/x`, or the console's Install wizard).

Every install, import and hot swap writes to the kernel's **output terminal** (`runtime.terminal`, tab kind `terminal`, action `terminal.open[:channel]`, dialog `terminal`): a scrollable, auto-scrolling pane. When a project uses a component kind the active kit has no counterpart for, the resolver falls back to the default AmberX kit and notes it there once per kit × kind.
