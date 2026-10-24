# lib-selection

Your own entries in Android's text selection menu (Copy · Select all · **Read aloud** …) in every app.

```kotlin
class ReadAloudActivity : ProcessTextActivity() {
    override fun onSelectedText(selection: SelectedText) { /* selection.text, .readOnly, .entry */ }
}
SelectionMenuEntries.setEnabled(context, ".menu.ReadSlowly", on = true)   // from a setting, no restart
```

Manifest (the plugin's): the activity or one `activity-alias` per entry, each with an `android.intent.action.PROCESS_TEXT` + `text/plain` intent filter and the entry's `android:label`; a translucent no-history theme.

- `SelectionRules` (pure Kotlin): `clean` (zero-width + control characters dropped, CRLF, cap cut on a word), `preview`, `words`. Tested by `SelectionRulesTest`.
- `SelectionModule()` provides `android.process-text`.

Placeholders: `axf.selection.web`, `axf.selection.accessibility`. First user: plugin X Select (`framework/android/plugin-xselect`).
