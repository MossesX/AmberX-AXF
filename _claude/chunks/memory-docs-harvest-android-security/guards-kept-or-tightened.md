<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md lines=52-62 tokens=396 -->
## Guards kept or tightened
- **Fails closed** everywhere: no lock service → gate never opens by itself and locks at once on leaving; storage read error is `SecretState.Error`, never "missing"; no activity for the sheet / no PIN → stays locked with a note.
- **Stricter where the copies differed:**
  - AXHub only checked the delay on return; Voice Vault also locked on a timer while away. The gate does both for both apps (AXHub now drops to locked even if never reopened).
  - AXHub had no lock-mode guard; it has Voice Vault's now. The guard also stops a possible revert loop (the write-back is accepted once without re-checking).
  - AXHub's return check skipped a leave at time 0 (`leftAt > 0`); the gate uses an away flag (a unit test caught this).
  - Voice Vault's "Nothing more" still needs the voice code (`firstStep`); AXHub's "Nothing more" opens only once settings have loaded (`ready`).
  - Library views (settings, lock-pin) now go through the app's `viewGuard`, so a view a library adds later can't skip the lock (before, each app had to remember to wrap it).
- Kept as-is: lockout timing (5 free, 30 s doubling, max 15 min) and its stored format; PBKDF2 120k / 16-byte salt / constant-time compare; first 3 distinct heard alternatives only; empty codes never match; sensitive clip flag + tag check; zeroed plaintext buffers; erase deletes the key; vault never in backups; AXHub reset ends the hub session before turning the lock off.
- `AppLock.modeProblem` with no `context` refuses a fingerprint pick (`LockModule()` without the Application can't check the sensor).
