---
name: shorts-controller-app
description: ActiveX — Android app Brett is designing, hands-free YouTube control (Shorts scrolling + full YouTube actions) via voice, hand and face gestures; design decisions and planned tech
sources: [voice, chat]
aliases: [ActiveX, shorts scroller, youtube shorts controller, shorts controller, voice gesture app]
---

# Concept
- [stated] App is now named ActiveX (renamed Oct 2026 from "Shorts Controller"); he sees it as an entire YouTube control suite, not just a Shorts scroller — Shorts scroller stays the default/lead feature on the home screen
- [stated] Actions are tagged by context (Shorts / long-form video / anywhere) and each trigger has a "works in" setting so e.g. a Shorts swipe is ignored on a regular video
- [stated] Building an Android app that runs in the background and lets him scroll YouTube Shorts hands-free, via voice triggers and camera hand gestures
- [stated] Both input methods are selectable in settings (toggle each on/off); both can be active at the same time

# Voice triggers
- [stated] Spoken triggers like "next"/"back" simulate the swipe
- [stated] Wants a sensitivity slider so the playing video's audio doesn't falsely trigger it
- [stated] In settings, "add new trigger" lets him record a custom audio trigger (custom wake word)
- [stated] "Add new trigger" for audio should also show a list of factory predefined triggers to select from. Wants it dense: single column, tight rows (no multiple columns); can scroll — doesn't need to fit one page, just not excessively long
- [stated] Agreed to include echo cancellation (subtract the video's own audio from mic input) to reduce false triggers

# Gestures
- [stated] Camera gestures: thumbs up = next, thumbs down = back
- [stated] Wants hand-motion swipes too (up/down, left/right); can also add custom gestures in settings
- [stated] Swipe gesture will be done with a single finger sticking up (index finger pointing), moved left or right to swipe; right = next
- [stated] "Add new gesture" should also show a dense list of factory predefined gestures to pick from — same style as the audio list (single column, tight rows, can scroll, not excessively long)

# Technical approach (Kotlin/Compose Android project scaffolded Oct 2026; design mockups live on a Claude Design canvas)
- [stated] Asked to build the app (Oct 2026); project delivered as a Kotlin/Jetpack Compose Android Studio project — lives in his GitHub repo MossesX/ActiveX (https://github.com/MossesX/ActiveX, renamed from "activex"), pushed Oct 2 2026. Asked for a downloadable APK: a GitHub Actions workflow builds a debug APK on every push to main and posts it to the repo's Releases page (first successful build Oct 2 2026). Voice triggers stay off until a Picovoice key is added as the PICOVOICE_ACCESS_KEY repo secret and .ppn keyword files are added
- [stated] Overlay must be draggable and resizable, show motion trails, and have an optional scrolling detection-log text overlay listing every trigger seen with confidence 0.01–99.99%; tapping a log line adjusts that trigger's threshold
- Foreground service for always-on listening/camera
- [stated] Voice engine switched from Picovoice to Vosk (done Oct 8 2026, build green) — no key needed, custom triggers are text phrases; "jump to"/"find" take the argument from the same utterance. Installed the debug APK on his Samsung; accessibility consent dialog's Continue button was hidden behind the 3-button nav bar
- [stated] When the detection overlay is hidden, show fired triggers in a small top-left strip: max 3 lines, each visible 3 s (added Oct 8 2026, with a fix so "show overlay" reopens it)
- Hand gestures via MediaPipe gesture recognizer (thumbs built in; swipes need custom motion tracking across frames)
- Accessibility Service to dispatch the actual swipe gestures system-wide
- All input methods funnel to the same two actions (swipe up / swipe down)
- [stated] Custom gestures can be recorded in settings
- [stated] Settings include a user-selectable static "arming" pose that must be seen before motion gestures fire; set per gesture, with a global override
- [stated] Each trigger gesture gets an "always armed" setting (no arming pose required); user stays armed across multiple swipes without lowering hand

# Unified triggers
- [stated] Gestures and audio are unified as "triggers"; tapping "add trigger" first asks you to pick gesture or audio
- [stated] After picking the trigger type, user selects the action from a dense list (same style as the predefined lists) of all possible YouTube actions — e.g. next, back, search, home, go back, playlist, add to playlist, create new playlist — every conceivable YouTube action
- [stated] Action execution rule: anything the YouTube Data API can do uses the API; anything it can't uses the accessibility (screen) layer
- [stated] Action picker in "add trigger" has tabs: YouTube commands (split into API actions vs. accessibility-layer actions that need the video ID) , app settings commands, and YouTube settings — three tabs total
- [stated] Wants a list of permanent (built-in, non-removable) triggers. One is "jump to" + a spoken time, e.g. "jump to one minute thirty-eight seconds" seeks the current video to 1:38 (or whichever video is playing)
- [stated] Another permanent trigger: "find" + spoken keyword(s) searches video captions for that word, e.g. "find Jimmy John"
- [stated] Third trigger type: face gestures — nod up, nod down, shake head up/down, shake head left/right, blink, stick out tongue, open mouth wide, etc.
- [stated] Settings toggle for a picture-in-picture camera overlay that shows live detection (landmarks/what's being recognized); the overlay should draw a box around the detected motion being tracked
- [stated] Approved a first-run permissions flow (welcome/why → mic, camera, accessibility, notifications checklist → accessibility settings hand-off → battery-optimization exemption + done) and an error state for when Android kills the accessibility service
- [stated] Major settings must also be voice-controllable, e.g. "close camera overlay" / "hide overlay", toggling gesture detection on/off
- [stated] Action picker has a search bar that acts as a live filter across the action list; it's pinned at the top permanently regardless of which tab is active, and filters across all three tabs showing which tab each match comes from

- [stated] Wants a settings switch for phone control: say "open app" + an app name to launch any installed app (added Oct 14 2026 as "Open apps by voice", off by default, permanent trigger)

# Main screen
- [stated] Opening the app lands directly on the settings screen
