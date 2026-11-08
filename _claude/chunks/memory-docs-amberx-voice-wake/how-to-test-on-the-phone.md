<!-- memory-chunk@1 source=_claude/memory/docs/amberx-voice-wake.md tokens=284 -->
## How to test on the phone

1. Install the CI APK (`amberx-debug.apk`). Open AmberX → Voice and leave Hands-free on.
2. First run: the overlay shows **MODEL 0% … 100%**, then **LOADING**, then **IDLE · WAKE**. Wi-Fi is best: it's about 40 MB, once.
3. Idle: no tone at all, for minutes. The level graph moves when you talk. Notification sounds still play (nothing is muted while idle).
4. Say "hey amberx": the chip changes to **LISTENING**, with no tone. Say "open approvals": the words show live, the page opens,
   and the reply is spoken. Then the chip goes back to **IDLE · WAKE**.
5. Screen off / another app: say "hey amberx", then "what's waiting". AmberX opens and runs it.
6. Turn on **Play tone on trigger**: the tone plays at step 4 only.
7. Sensitivity: on Low, a quiet "hey amberx" shouldn't trigger. On High, it triggers on the first partial.
8. Always armed: say "open settings" with no wake phrase. It runs as heard by Vosk.
9. Hands-free mode → Classic: the old behaviour (with its tone) comes back.
10. Do Not Disturb on: triggers still work. If Android refuses the mute, it's skipped silently and the tone may play.
