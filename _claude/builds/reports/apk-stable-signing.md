# apk-stable-signing

**Result:** every CI build of the console app (and the Dev Console) is now signed with one fixed key, so each new APK installs over the previous one.

**Brett: uninstall the console app ONE last time**, install the next build, and every later APK updates in place. Same for the Dev Console (console-debug.apk) and the other CI APKs.

## Why it broke
- versionCode was fine: it already followed the CI run number.
- The signing key was the problem. Eight console-app-debug.apk artifacts from eight runs (two on main, six on pull requests) carried eight different certificates, even though each run logged "using the stable debug key" from the `ANDROID_DEBUG_KEYSTORE` secret. A different key per build means Android refuses the update ("App not installed").
- Why the secret's key never reached the APK is not established: the secret cannot be read from here.

## Fix
- `apps/console-droid/app/debug.keystore`: a committed debug key (standard debug credentials, protects nothing).
- `apps/console-droid/app/build.gradle`: the debug variant signs with that key through an explicit `signingConfigs.debug`; versionCode stays the run number (1 locally). versionName stays `0.2.0`: the app already shows the build next to it (`0.2.0+<build>`), and the console's dialog rules test pins that exact line (a `0.2.<build>` name failed it in CI).
- `.github/workflows/android.yml`: every run hands the same keystore to every app build explicitly (AGP injected signing properties in the Gradle user home), which covers console-debug.apk and the other app APKs without touching their Gradle files. Only dropping the key at the default `~/.android/debug.keystore` was not enough: the first CI run of this change still signed the Dev Console with a fresh key, and the new check caught it. The secret is no longer used.
- New CI step: `apksigner` checks both console APKs against the committed certificate and fails the job if the key ever drifts again.

## Checks
- No JDK or Android SDK on the build host, so nothing was built locally.
- CI on the pull request: console-app-debug.apk and console-debug.apk both carry the committed certificate (f320c09a…6aeb), checked by the new step.
- `node apps/console-web/src/native/nativeRules.test.mjs` passes locally.

## Leftovers
- `install_instructions.md` still lists `ANDROID_DEBUG_KEYSTORE` as a needed secret (outside this build's allowed files). The secret can be deleted.
