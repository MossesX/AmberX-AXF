
## axHub = "Patches" (Brett, Nov 3 2026, voice, top priority)
Brett said (verbatim): "From now on, AXHub is going to be referenced by patches."
- When Brett says "Patches" he means axHub (the connector hub on the VPS, axhub.amberxai.com, MCP hub, approvals, Vinnie). Call it Patches when talking to him.
- Not the old Patches wrapper app (killed and archived Nov 3 2026 in kill-patches-pilot); that one is gone.
- Whether to rename axHub in code/UI/domain is NOT decided yet; ask before renaming anything.

## Update (Brett, Nov 3 2026, voice): the name is "Patch Hub"
Brett said (verbatim): "Let's call it Patch Hub." and yes to renaming the app.
- axHub is now **Patch Hub** (supersedes "Patches" above). Say Patch Hub.
- Rename build `patch-hub-rename` launched: visible name everywhere; internal ids, MCP namespace `axhub`, env vars and the axhub.amberxai.com address stay so nothing breaks. New web address only if Brett asks.

## Update 2 (Brett, Nov 3 2026, voice) - SUPERSEDES the two sections above
- axHub stays **axHub**. No rename anywhere ("I ain't gonna risk breaking it. Too many reference points to break."). patch-hub-rename build cancelled before it started.
- **Patches** = the build orchestrator, as a crew member ("Let's make Patches the orchestrator"). Patches and Marco are named after Brett's cats ("our kitties").
- **Marco** = proposed Supervisor (Brett: "We need to find something for Marco too... Supervisor?"). Pending Brett's go.

## Update 3 (Brett, Nov 3 2026, voice): org chart
- **Brett** = the boss.
- **Marco** = **VP**, one below Brett ("He's the VP, he's one below me."). Oversees Patches and the whole crew, gives Brett the rundown, only escalates what needs the boss.
- **Patches** = the build orchestrator, runs the floor (order, steps, who works on what).
- Crew under Patches: Landin' Lenny, Ping Paulie, Reel Rhonda, Janitor Joey, Snap Sully, Earl the Ear. Vinnie = axHub's approval bot.
- Guard: Marco/Patches never approve owner-only things (passes, No wait, irreversible deletes, model upgrades) - those stay Brett's click.

## Update 4 (Brett, Nov 3 2026, voice): duties split (agreed)
- **Patches** (orchestrator) runs the floor: hands out jobs, keeps the line moving, clears stuck work (ghost slots, re-queues, bumps fixes).
- **Marco** (VP, desk job - "he can't really do much laboring"): watches the money (spend vs caps, pauses builds over cap), signs off on what ships (merge/deploy go-ahead when UI Review + CI are clear), recommends raises and write-ups for Brett to decide, daily rundown to Brett. Not the custodian (Janitor Joey already exists).
- All of it plain scripts, zero tokens. Not built yet (feature freeze); build after CI is green and merges are caught up, unless Brett says now.

## Update 5 (Brett, Nov 3 2026, voice): Molly is NOT an agent anymore
Brett said (verbatim): "She ain't an agent no more. Get her out of there. She's too good to be an agent. She's the one who brings everything together in her little app there. So she's like the entertainer."
- **Molly** = the one app that brings everything together (apps/molly: Console, axHub, AmberX in one) - 'the entertainer' / host. Remove her as an agent (AmberX agent Molly, Agent manager entry, 'Molly guide' / 'Ask Molly' persona). Keep the guide/walkthrough FEATURES; who takes them over is pending Brett (suggested: Reel Rhonda, who already does walkthroughs).
- Amber = Brett's right hand / chief architect (talks with Brett, writes briefs, launches the crew, drives his screens).

## Update 6 (Brett, Nov 3 2026, voice): Gizmo rehired
Brett said (verbatim): "Hire Gizmo, give him his job back."
- **Gizmo** is back on the crew and takes over Molly's old guide job: walkthroughs, 'Ask Gizmo' (replaces 'Ask Molly'), the AmberX guide/voice helper. Like every agent he is an all-rounder (standing rules 3/5), booked at $7.50/h, with an agent card + avatar.
- To do after the freeze (with the Molly-not-an-agent change): swap agent Molly -> Gizmo in AmberX, Agent manager, Molly guide plugin/cards, walkthrough texts.
- Gizmo's pay: **$8.00/h** (Brett: "You gotta give Gizmo eight bucks."), set by Brett himself - above the $7.50 minimum the rest of the crew is on.

## Update 7 (Brett, Nov 3 2026, voice)
- **Polo** hired ("Polo, man... Trust me, he won't give you no problems. He's good."). Fills the 8th build slot as an all-rounder, $7.50/h, agent card + avatar. Whether he also takes Security or QA is up to Brett.
- Amber is named after one of Brett's cats who passed away. (Marco, Patches, Polo, Gizmo are cat names too.)
- **Brownie** = QA inspector (checks each build works before it hits Brett's UI Review). **Ashes** = Security (watches keys, logins, secrets, approvals; flags anything off). Both are all-rounders who also own that duty (rules 3/5), $7.50/h.
- **Jennifer** = the lunch lady ("Make Jennifer the lunch lady."): runs the breakroom - group chat banter, break times, crew morale. Fun role.
- To set up after the freeze: agent cards + avatars for Polo, Brownie, Ashes, Jennifer, Gizmo; Marco/Patches roles; Molly removed as an agent.
- **Conrad** = librarian: keeps the Notes Vault, docs, sync files and memory files tidy so nothing gets lost. All-rounder, $7.50/h.
- Still open: **front desk** (greets each new Claude session, runs the agent picker, routes Brett's requests).
- **Chachi** = front desk: greets each new Claude session, runs the agent picker (agent-pick build), routes Brett's requests. All-rounder, $7.50/h.
- Correction: **Chachi is a she** (Brett: "It's a she, don't you misgender anybody."). Use she/her for Chachi.
