# Source of framework/assets/help/framework.json (hand-written help entries; run to regenerate the JSON).
import json, sys
E = []
def e(target, title, text, tryIt=None, more=None, related=None, kind=None):
    d = {"target": target, "title": title, "text": text}
    if more: d["more"] = more
    if tryIt: d["tryIt"] = tryIt
    if related: d["related"] = related
    if kind: d["kind"] = kind
    E.append(d)

# --- Help mode itself
e("action:help.mode", "Help mode", "Turns Help mode on or off. On: every button, menu, switch and tab explains itself — hover it, or on a phone tap its little ? (or long-press it). Off: no tooltips, no clutter.", "Press F1 anywhere to flip it.", "Help mode is remembered on this device only, so your phone and your desktop can differ. The first time you open a screen with Help mode on you get a short intro of its main parts; you can skip it, or turn intros off for good. Tooltips never stop a control working: tap the control itself and it does its normal thing.", ["action:help.intros.reset", "view:settings"], "toggle")
e("help-mode", "Help mode", "The same switch as the ? at the top: tooltips on everything while it's on, nothing while it's off. Remembered on this device.", "Flip it and hover any button.", kind="toggle")
e("screen-intros", "Screen intros", "While Help mode is on, a 2–4 step tour shows the first time you open a screen. Turn it off if you already know your way round.", kind="toggle")
e("action:help.intros.reset", "Show all screen intros again", "Forgets which screens you've already toured, so each intro shows once more the next time you open that screen.")
e("show-all-screen-intros-again", "Show all screen intros again", "Forgets which screens you've already toured, so each intro shows once more the next time you open that screen.")
e("action:help.intro", "Show this screen's intro", "Plays this screen's short tour again right now (turns Help mode on if it was off).")
e("what-is-this", "What is this?", "Opens a small panel with the longer story: what this thing is for, what to try, and which screens go with it.")

# --- menus
e("menu:file", "File menu", "Making, opening, saving and exporting. Most apps only use some of these.", kind="menu")
e("menu:edit", "Edit menu", "Undo, redo, cut, copy, paste and delete — the usual suspects.", kind="menu")
e("menu:view", "View menu", "What's on screen: bars, navigation, spacing and the pages you can jump to.", kind="menu")
e("menu:look", "Look menu", "Themes, layouts and the design package: change how the whole app looks in one tap.", kind="menu")
e("menu:assets", "Assets menu", "Every part of the look is a swappable asset. This menu cycles them, randomizes them or puts them back.", kind="menu")
e("menu:window", "Window menu", "Floating windows, splits and tab groups: pull pages out, dock them back.", kind="menu")
e("menu:help", "Help menu", "Help mode, the screen intros, docs, shortcuts and About. Lost? Start here.", kind="menu")
e("menu:plugins", "Plugins menu", "Every plugin's page and switch in one list.", kind="menu")
e("menu:app", "App menu", "This app's own commands.", kind="menu")
e("menu:build", "Build menu", "Start builds and check what's queued.", kind="menu")
e("menu:builds", "Builds menu", "The builds store: every build, its steps and where it's at.", kind="menu")
e("menu:approvals", "Approvals menu", "Everything waiting for your yes or no, live, with Approve and Deny right on each row.", kind="menu")
e("menu:apps", "Apps menu", "Jump to your other apps.", kind="menu")
e("menu:axhub", "AXHub menu", "Your connector hub: approvals, apps, users, your account.", kind="menu")
e("menu:console", "Console menu", "The Dev Console's own commands: reload data, search, open your other apps.", kind="menu")
e("menu:framework", "Framework menu", "Catalog, libraries, demos, modules, boilerplates — what the framework is made of.", kind="menu")
e("menu:manage", "Manage menu", "Users, devices, projects and the other admin pages.", kind="menu")

# --- generic actions (menu items everywhere)
e("action:app.settings", "Settings", "Opens Settings: the look, your account, connections, plugins and Help mode.", related=["view:settings"])
e("action:settings.open", "Settings", "Opens Settings on the tab this item names.")
e("action:help.docs", "Documentation", "Opens the docs for this app.")
e("action:help.about", "About", "Which version you're running, what's installed, and who built it.")
e("action:view.shortcuts", "Keyboard shortcuts", "Lists every keyboard shortcut. F1 is Help mode.")
e("action:edit.undo", "Undo", "Takes back the last change.")
e("action:edit.redo", "Redo", "Puts back what Undo took away.")
e("action:edit.cut", "Cut", "Copies the selection and takes it out.")
e("action:edit.copy", "Copy", "Copies the selection to the clipboard.")
e("action:edit.paste", "Paste", "Drops in what's on the clipboard.")
e("action:edit.delete", "Delete", "Deletes the selection. Depending on your behaviour theme it asks first.")
e("action:file.new", "New file", "Starts a new, empty one.")
e("action:file.open", "Open", "Opens a file.")
e("action:file.save", "Save", "Saves what you're working on.")
e("action:file.export", "Export", "Saves the active assets (the whole look) as one JSON file you can keep or share.")
e("action:run.build", "Build", "Starts a build. Pick what to build in the dialog that opens.")
e("action:run.deploy", "Deploy", "Ships it to the server. Needs the deploy permission.")
e("action:dev.console", "Developer console", "Opens the developer tools for this app.")
e("action:swap", "Hot-swap", "Swaps this part of the look for another asset, live — no reload, nothing lost. Every app on the framework is built from swappable assets.", "Try Look → Next color theme and watch everything follow.")
e("action:swap:color-theme:next", "Next color theme", "Switches every colour in the app to the next colour theme, live.")
e("action:swap:color-theme:prev", "Previous color theme", "Goes back to the colour theme before this one.")
e("action:swap:style-theme:next", "Next style theme", "Switches the shapes, shadows and glass to the next style theme.")
e("action:swap:layout:next", "Next layout", "Moves the bars and panels into the next layout. Your pages stay as they are.")
e("action:swap:nav-menu:next", "Next navigation menu", "Tries the next look for the navigation list.")
e("action:assets.random", "Randomize", "Rolls a random look from the assets in rolls. Don't like it? Roll again, or Reset to defaults.")
e("action:assets.reset", "Reset to defaults", "Puts every part of the look back to the app's defaults.")
e("action:appearance.restore", "Restore default look", "Puts the whole look back to the app's defaults.")
e("action:dialog:import-asset", "Import an asset", "Brings in an asset (a theme, layout, menu…) from JSON. It's checked before it's used.")
e("action:asset.json", "View JSON", "Shows the raw JSON of this asset.")
e("action:asset.copy", "Copy JSON", "Copies this asset's JSON to the clipboard.")
e("action:design.package", "Design package", "Applies the next design package: a whole matched look (colours, style, layout, controls) in one go.")
e("action:spacing", "Spacing", "How tight things are packed. Super tight fits the most on a phone; Regular breathes.")
e("action:slot.hide", "Show or hide", "Shows or hides this bar. Hidden isn't gone: everything it had is still in the app menu.")
e("action:terminal.open", "Output terminal", "Opens the output terminal: every install, hot swap and error this app logged.")
e("action:terminal.new", "Open terminal", "Opens a terminal tab.")
e("action:alerts.open", "Alerts", "Opens your alerts: what broke, what's fixed, what needs you.", related=["view:alerts"])

# --- chrome
e("user-account-control", "Your role", "Who you're acting as right now (Admin, Developer, Viewer…). Tap it for your account and permissions; some buttons only show for some roles.", kind="button")
e("unfold-the-toolbar", "Unfold the toolbar", "Opens the folded toolbar back up.")
e("fold-the-toolbar", "Fold the toolbar", "Folds the toolbar into a thin handle to give the page more room. Remembered on this device.")
e("clear-search", "Clear search", "Empties the search box.")
e("close-dialog", "Close", "Closes this dialog without doing anything else.")
e("dismiss", "Dismiss", "Gets this message out of your face. Nothing else happens.")
e("retry-now", "Retry now", "Tries reaching the hub again right away instead of waiting.")
e("sign-in-on-the-hub", "Sign in on the hub", "Opens axHub so you can sign in; then come back and this app reads your look and settings live.")
e("no-live-preview", "No live preview", "This build has no live preview running yet. It shows here once the session starts one.")
e("reload-the-preview", "Reload the preview", "Reloads the live preview of the screen being changed.")
e("open-in-a-new-tab", "Open in a new tab", "Opens it in its own browser tab.")

# --- Watch live / window engine
e("undock-to-floating-window", "Undock", "Pulls this page out into a floating window you can move and resize.")
e("split-vertical", "Split vertical", "Splits this window side by side.")
e("split-horizontal", "Split horizontal", "Splits this window top and bottom.")
e("four-way", "Four-way", "Splits this window into four.")
e("split", "Split", "Splits this window so two pages show at once.")
e("close-tab", "Close tab", "Closes this tab. The page is still in the menus.")
e("minimize", "Minimize", "Shrinks this window out of the way; click it to bring it back.")
e("minimize-to-corner", "Minimize to corner", "Tucks the window into a screen corner. Tap its title bar to cycle corners.")
e("minimize-to-corner-title-bar-cycles-corners", "Minimize to corner", "Tucks the window into a screen corner. Tap its title bar to cycle corners.")
e("minimize-to-floating-toolbar-at-cursor", "Minimize to a floating toolbar", "Shrinks the window to a small toolbar where your pointer is.")
e("window-settings", "Window settings", "How windows open, snap and minimize.")
e("redock", "Dock back", "Puts this floating window back into the page.")

# --- terminal
e("copy-output", "Copy output", "Copies everything in the terminal, ready to paste to Claude or into a note.")
e("clear", "Clear", "Empties the list (nothing is deleted anywhere else).")
e("all", "All", "Shows every channel at once.")

# --- arrange / banners
e("reset", "Reset", "Puts it back the way it was by default.")
e("done", "Done", "Finishes and closes this.")
e("show", "Show", "Shows it again.")
e("unhide", "Unhide", "Brings this banner back.")
e("action:banners.settings", "Banner settings", "Opens the settings of this banner: its look, how it behaves and the plugin's own settings.")
e("action:banners.show-all", "Show all banners", "Brings back every banner you hid or snoozed.")
e("hide-all-banners", "Hide all banners", "Hides every banner at once. They keep working; flip this back to see them.", kind="toggle")
e("hide-for", "Hide for a while", "Hides the banners for the time you pick, then they come back by themselves.", kind="toggle")
e("show-all-banners-and-reset-timers", "Show all banners", "Brings back every banner and cancels the hide timers.")
e("look-and-behaviour-back-to-defaults", "Back to defaults", "Puts this banner's look and behaviour back to the way it shipped.")
e("colour", "Colour", "Which theme colour this banner uses.", kind="field")
e("density", "Density", "How tight this banner is packed.", kind="field")
e("show-its-icon", "Show its icon", "Shows or hides the banner's icon.", kind="toggle")
e("icon-while-working", "Icon while working", "The icon the banner shows while it's busy.", kind="field")
e("working-animation", "Working animation", "How the banner moves while something's running.", kind="field")
e("maximum-height", "Maximum height", "How tall this banner may grow before it scrolls.", kind="field")
e("when-it-appears", "When it appears", "Always, or only when it has something to say.", kind="field")
e("hide-itself", "Hide itself", "Whether the banner tucks itself away after a while.", kind="field")
e("up", "Move up", "Moves it one place up.")
e("down", "Move down", "Moves it one place down.")
e("move-up", "Move up", "Moves it one place up the list.")
e("move-down", "Move down", "Moves it one place down the list.")
e("hide-it-inside-a-host-app-patches", "Hide inside a host app", "Hides this banner when the app runs inside another app's frame, so you don't see two.", kind="toggle")

# --- settings library
e("view:settings", "Settings", "Everything you can change: the look (Appearance), who you are (Account), what it talks to (Connections), plugins, and Help mode under About.", "Open Appearance and tap Next on any slot.", kind="screen")
e("level-toolbar", "Level toolbar", "Shows or hides the Simple / Basic / Developer / Administrator bar at the top of every settings page.", kind="field")
e("level-toolbar-menu", "Level toolbar menu", "Pick a level, edit the levels, or hide the bar.")
e("action:settings.levelbar:off", "Hide this toolbar", "Hides the settings level bar. Turn it back on under Settings → Appearance → Display.")
e("edit-levels-pick-which-settings-each-level-shows", "Edit levels", "Opens the level editor: pick which settings each level (Simple, Basic, Developer, Administrator) shows.")
e("interface-order", "Interface order", "Lists the settings in the order the page shows them.", kind="tab")
e("a-z", "A–Z", "Lists the settings alphabetically.", kind="tab")
e("by-level", "By level", "Groups the settings by the level that shows them.", kind="tab")
e("add-to-visible", "Add to visible", "Makes the selected settings show at this level.")
e("reset-mine", "Reset mine", "Throws away your own level choices and goes back to the defaults.")
e("text-size", "Text size", "Makes all the text bigger or smaller, in percent.", kind="field")
e("animations", "Animations", "Off cuts down the motion.", kind="field")
e("lock-the-look", "Lock the look", "Stops anyone (you included) changing the look on this device until it's unlocked.", kind="toggle")
e("get-the-look-from-axhub", "Get the look from axHub", "On: this app wears the look saved on your hub, live, so every app matches. Off: it keeps its own.", kind="toggle")
e("apply-settings-to-all", "Apply to all", "Uses these settings for every asset of this kind, not just this one.", kind="toggle")
e("back-to-the-theme", "Back to the theme", "Drops your own tweaks and uses the theme's values again.")
e("default", "Default", "Back to the default value.")
e("roles-and-permissions", "Roles and permissions", "Who can do what in this app.")
e("open-the-plugin-manager", "Open the Plugin Manager", "Opens the Plugin Manager: every plugin with its info, switch, logs and settings.")
e("settings", "Settings", "Opens the settings for this.")
e("details", "Details", "Shows the details.")
e("about-this-app", "About this app", "Version, framework, what's installed.")
e("shortcuts", "Shortcuts", "Every keyboard shortcut. F1 is Help mode.")
e("reset-assets-to-defaults", "Reset assets to defaults", "Puts every part of the look back to the app's defaults.")

# --- account / studio
e("save-file", "Save file", "Tests the Save permission for your role.")
e("dev-console", "Dev console", "Tests the developer tools permission for your role.")
e("deploy", "Deploy", "Ships it to the server (needs the deploy permission).")
e("import-asset", "Import asset", "Brings in an asset from JSON; it's checked before it's used.")
e("change-policy", "Change policy", "Switches the access policy: which roles exist and what each can do.")
e("randomize", "Randomize", "Rolls a random look. Roll again or reset if you hate it.")
e("import", "Import", "Brings one in from a file or pasted JSON.")
e("copy-json", "Copy JSON", "Copies the JSON to the clipboard.")
e("activate", "Activate", "Makes this asset the one in use, live.")
e("sample", "Sample", "Fills in an example so you can see the shape.")
e("choose-file", "Choose file", "Pick a file from this device.")

# --- alerts / approvals libs
e("view:alerts", "Alerts", "Everything that broke, got fixed or needs you, newest first. A red dot means unread.", kind="screen")
e("alerts", "Alerts", "Where your alerts go and what makes one.", kind="tab")
e("mark-all-seen", "Mark all seen", "Clears the unread dot. The alerts stay in the list.")
e("alert-settings", "Alert settings", "Where alerts go (bell, push, ntfy) and which sources make one.")
e("resolve", "Resolve", "Marks this alert fixed. If it breaks again it comes back by itself.")
e("random", "Random", "Makes a new random value.")
e("forget-token", "Forget token", "Removes the saved token from this device.")
e("send-a-test", "Send a test", "Sends a test alert so you can see it arrive.")
e("turn-on-for-this-device", "Turn on for this device", "Lets this browser show push notifications for alerts.")
e("turn-off-for-this-device", "Turn off for this device", "Stops push notifications on this browser.")
e("open-it-on-the-hub", "Open it on the hub", "Opens this on axHub, with the full details.")
e("all-approvals-on-axhub", "All approvals on axHub", "Opens the full approvals list on axHub.")
e("see-them-all", "See them all", "Opens the full list.")
e("full-approval-page", "Full approval page", "Opens this call's own page on axHub: the reason, the exact code, who asked, the timeline.")
e("columns", "Columns", "Pick which columns the table shows.")

# --- approvals rows + Watch live (framework/libs/approvals, react/components/WatchLive.tsx, AppMenu live rows)
e("approval-approve", "Approve", "Yes — runs the waiting call right now instead of after the countdown.", more="On a held call (veto) this skips the rest of the 90-second countdown. On a straight approval it's the only way it runs.")
e("approval-deny", "Deny", "No — the call is dropped and never runs. A denied call stays denied unless you ask again.")
e("approval-decline", "Deny", "No — the call is dropped and never runs.")
e("approval-details", "Details", "Opens the row in place: the reason, the exact code (copy it), who asked, the tool and its risk, the timeline and the result. It stays open when the list refreshes.")
e("menu-row-details", "Details", "Opens this row in place with everything about it.")
e("menu-row-approve", "Approve", "Runs this call now. The row flips to Running, then drops off.")
e("menu-row-deny", "Deny", "Drops this call; it never runs.")
e("menu-row-decline", "Deny", "Drops this call; it never runs.")
e("approvals-badge", "Approvals waiting", "How many calls are waiting on axHub. Tap for the list with Approve and Deny on each.")
e("shelve-pause-the-countdown-until-you-decide", "Shelve", "Pauses the countdown so nothing runs until you Approve or Deny it.")
e("watch-live", "Watch live", "Pops up the exact screen this session is changing, hot-rendering as it works, with the part it's on outlined.", "Tap it while a build runs.")
e("copy-command", "Copy command", "Copies the exact command the call will run.")
e("copy-arguments", "Copy arguments", "Copies the call's arguments.")

# --- the verbs every screen uses
V = {
 "refresh": ("Refresh", "Reloads this from the server, so you're looking at what's true right now."),
 "reload": ("Reload", "Reads it again from the server."),
 "save": ("Save", "Saves your changes. Nothing sticks until you tap it."),
 "cancel": ("Cancel", "Backs out without changing a thing."),
 "close": ("Close", "Closes this. Nothing is lost."),
 "delete": ("Delete", "Deletes it. Depending on your behaviour theme it asks first — don't come crying."),
 "remove": ("Remove", "Takes it off the list."),
 "add": ("Add", "Adds a new one."),
 "new": ("New", "Starts a new one."),
 "open": ("Open", "Opens it."),
 "copy": ("Copy", "Copies it to the clipboard, ready to paste."),
 "export": ("Export", "Saves a copy to a file you can keep or share."),
 "apply": ("Apply", "Puts the change into effect now."),
 "restore": ("Restore", "Brings back an earlier version."),
 "rename": ("Rename", "Gives it a new name."),
 "edit": ("Edit", "Lets you change it."),
 "next": ("Next", "On to the next one."),
 "back": ("Back", "Back one step."),
 "skip": ("Skip", "Skips this one."),
 "start": ("Start", "Starts it now."),
 "stop": ("Stop", "Stops it."),
 "play": ("Play", "Plays it."),
 "retry": ("Retry", "Tries the same thing again."),
 "discard": ("Discard", "Throws away the changes you haven't applied. The saved version stays."),
 "share": ("Share", "Sends a link or a copy to someone or somewhere."),
 "look": ("Look", "How this looks: colours, style and layout."),
 "name": ("Name", "What it's called. Keep it short and plain so you find it later.", "field"),
 "show-more": ("Show more", "Shows the rest of the list."),
 "clear-filters": ("Clear filters", "Shows everything again."),
 "approve": ("Approve", "Says yes: the waiting call runs now instead of after the countdown."),
 "reject": ("Reject", "Says no and sends it back."),
 "deny": ("Deny", "Says no: the held call is dropped and never runs."),
 "approve-now": ("Approve now", "Runs the held call right now instead of waiting for the countdown."),
 "approve-on-axhub": ("Approve on axHub", "Opens this approval on axHub, where you can approve it."),
 "copy-brief": ("Copy brief", "Copies the ready-made first message for the next Claude session."),
 "terminal": ("Terminal", "Opens the terminal for this."),
 "minimize": ("Minimize", "Shrinks it out of the way; tap it to bring it back."),
 "check": ("Check", "Checks it right now."),
 "sign-in": ("Sign in", "Signs you in."),
 "sign-out": ("Sign out", "Signs you out on this device."),
 "role": ("Role", "Who you're acting as; it decides what you can do.", "field"),
 "email": ("Email", "The email address.", "field"),
 "search": ("Search", "Finds things as you type.", "field"),
 "filter": ("Filter", "Narrows the list to what matches."),
 "upload": ("Upload", "Uploads a file from this device."),
 "download": ("Download", "Downloads a copy to this device."),
 "details": ("Details", "Shows the details."),
 "expand": ("Expand", "Opens it up to show the details in place."),
 "collapse": ("Collapse", "Folds it back up."),
 "install": ("Install", "Installs it."),
 "uninstall": ("Uninstall", "Removes it completely — code, data, everything."),
 "enable": ("Enable", "Turns it on."),
 "disable": ("Disable", "Turns it off."),
 "test": ("Test", "Runs a quick check to see if it works."),
 "send": ("Send", "Sends it."),
 "select": ("Select", "Picks it so the next action works on it."),
 "select-all": ("Select all", "Picks everything in the list."),
 "merge": ("Merge", "Joins them into one."),
 "move": ("Move", "Moves it somewhere else."),
 "status": ("Status", "Where it's at.", "column"),
 "open-project": ("Open project", "Opens one of your projects."),
 "download-the-latest": ("Download the latest", "Downloads the newest build."),

 "create": ("Create", "Makes it."),
 "previous": ("Previous", "Back to the one before."),
 "sort": ("Sort", "Changes the order of the list."),
 "log": ("Log", "The history: what happened, newest first."),
 "find": ("Find", "Looks it up."),
 "try-again": ("Try again", "Has another go."),
 "check-now": ("Check now", "Checks right now instead of waiting for the next round."),
 "earlier": ("Earlier", "Shows older ones."),
 "later": ("Later", "Puts it off; it'll ask again."),
 "continue": ("Continue", "Carries on from here."),
 "got-it": ("Got it", "Closes this. You've seen it."),
 "archive": ("Archive", "Files it away out of the list. Nothing is deleted."),
 "clean-up": ("Clean up", "Clears out the old leftovers."),
 "close-all": ("Close all", "Closes every one of them."),
 "description": ("Description", "A plain sentence on what it is.", "field"),
 "profile": ("Profile", "Which profile this is for.", "field"),
 "scope": ("Scope", "Where it applies.", "field"),
 "app": ("App", "Which app.", "field"),
 "set": ("Set", "Saves this value."),
 "spacing": ("Spacing", "How tight everything is packed: Super tight, Compact or Regular."),
 "color-theme": ("Color theme", "Every colour in the app. Pick one and the whole app follows, live."),
 "style-theme": ("Style theme", "Shapes, corners, shadows and glass."),
 "layout": ("Layout", "Where the bars and panels sit."),
 "windows": ("Windows", "Floating windows and tab groups."),
 "dialogs": ("Dialogs", "Every dialog this app has; pick one to open it."),
 "every-page": ("Every page", "Every page in the app, even ones the navigation hides."),
 "all-bars-and-menus": ("All bars and menus", "Show or hide each bar and menu."),
 "navigation-items": ("Navigation items", "Everything in the navigation list, in a menu."),
 "toolbar-items": ("Toolbar items", "Everything on the toolbar, in a menu."),
 "settings-pages": ("Settings pages", "Jump straight to a settings tab."),
 "hub-pages": ("Hub pages", "The axHub pages."),
 "waiting-for-approval": ("Waiting for approval", "Every call waiting on you, live, with Approve and Deny on each row."),
 "load-more": ("Load more", "Shows the next batch."),
 "open-on-the-hub": ("Open on the hub", "Opens this on axHub."),
 "open-on-axhub": ("Open on axHub", "Opens this on axHub."),
 "open-it-on-axhub": ("Open it on axHub", "Opens this on axHub."),
 "empty": ("Empty", "Clears it out."),
 "item": ("Item", "One entry.", "field"),
 "create-a-new-one": ("Create", "Makes a new one."),
}
for slug, v in V.items():
    if any(x["target"] == slug for x in E): continue
    e(slug, v[0], v[1], kind=v[2] if len(v) > 2 else None)
for col, txt in {"name": "What it's called.", "status": "Where it's at: running, done, failed, waiting…", "model": "Which Claude model does (or did) the work: Fable or Opus.", "time": "How long it took, or how long it's expected to take.", "cost": "What it cost (or is expected to cost) in dollars.", "updated": "When it last changed.", "created": "When it was made.", "source": "Where it came from.", "when": "When it happened.", "who": "Who asked for it.", "what": "What it is.", "id": "Its id — the name the code uses."}.items():
    e(f"column:{col}", col.capitalize() if col != "id" else "Id", f"The {col} column: {txt} Tap the header to sort by it.", kind="column")

intros = [
 {"screen": "settings", "title": "Settings", "steps": [
   {"say": "Every setting lives here, split into tabs: Appearance, Account, Connections, Plugins and About.", "target": ".axf-settings"},
   {"say": "The level bar at the top picks how much you see: Simple hides the nerdy stuff, Administrator shows it all.", "target": ".axf-settings-levelbar"},
   {"say": "Help mode has its own switch under About — or just hit F1 anywhere.", "target": ""}]},
 {"screen": "assets", "title": "Assets", "steps": [
   {"say": "Everything you see is an asset: themes, layouts, menus, buttons. Pick one on the left to look at it.", "target": ""},
   {"say": "Activate swaps it in live. Nothing reloads, nothing is lost.", "target": ""}]},
 {"screen": "account", "title": "Account", "steps": [
   {"say": "Your role decides what you can do. Switch it here to see the app as someone else would.", "target": ""},
   {"say": "The buttons below test each permission for the role you picked.", "target": ""}]},
]

pack = {
 "$axf": "asset@1", "type": "help", "id": "framework", "name": "Framework help",
 "version": "1.0.0",
 "description": "Help mode entries for everything the framework draws in every app: the menu bar, Help mode itself, the standard menus and actions, banners, windows, the terminal, Settings and the words every screen uses (Refresh, Save, Delete…). Written by hand for Brett: short, plain, a little attitude.",
 "author": "AmberX AXF", "tags": ["help", "framework"],
 "data": {"scope": "framework", "entries": E, "intros": intros},
}
seen=set()
for x in E:
    assert x["target"] not in seen, x["target"]; seen.add(x["target"])
json.dump(pack, open(sys.argv[1], "w"), indent=2, ensure_ascii=False); open(sys.argv[1], "a").write("\n")
print(len(E), "entries")
