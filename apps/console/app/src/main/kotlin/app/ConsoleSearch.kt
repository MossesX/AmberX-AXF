package ai.amberx.axf.console

import ai.amberx.axf.kernel.engine.SearchEntry
import ai.amberx.axf.kernel.runtime.AxfRuntime

/**
 * Console search providers (Android twin of apps/console-web/src/consoleSearch.ts). The search-bar widget in the banner
 * already finds pages, settings, actions, assets, windows and dialogs; these add the console's own records:
 *  - framework features in the tracker (status per item)   → opens the Tracker
 *  - catalog features (every tab › group)                 → opens the Feature catalog
 * Lists are read from the repo's state flows, so typing stays instant and new data shows on the next keystroke.
 */
object ConsoleSearch {
    val KIND_LABELS = mapOf("framework-feature" to "Framework", "feature" to "Feature")

    fun install(runtime: AxfRuntime?, repo: ConsoleRepo): () -> Unit {
        runtime ?: return {}
        for ((k, l) in KIND_LABELS) ai.amberx.axf.kernel.engine.SearchEngine.labelKind(k, l)
        val a = runtime.search.add("console.tracker") {
            repo.tracker.value.items.map { i ->
                SearchEntry("framework-feature:${i.id}", "framework-feature", i.title, detail = "Tracker › ${i.tab} › ${i.group} · ${repo.status(i.id).name.lowercase()}", icon = "check",
                    keywords = listOfNotNull(i.id, i.tag, i.module), focus = mapOf("kind" to "view", "view" to "tracker"))
            }
        }
        val b = runtime.search.add("console.catalog") {
            repo.catalog.value.items.map { i ->
                SearchEntry("feature:${i.id}", "feature", i.title, detail = "Catalog › ${i.tab} › ${i.group}", icon = "layers",
                    keywords = listOfNotNull(i.id, i.tag, i.note.takeIf { it.isNotBlank() }), focus = mapOf("kind" to "view", "view" to "catalog"))
            }
        }
        return { a(); b() }
    }
}
