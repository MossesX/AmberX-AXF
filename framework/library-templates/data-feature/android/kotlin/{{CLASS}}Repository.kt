package {{PACKAGE}}

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** One record of this feature. */
public data class {{CLASS}}Item(val id: String, val title: String, val done: Boolean = false, val createdAt: Long = System.currentTimeMillis())

/** In-memory repository with an observable list. Persist it with axf-data (JsonDocumentStore / OfflineFirstRepository) when the feature needs it. */
public class {{CLASS}}Repository {
    private val _items = MutableStateFlow<List<{{CLASS}}Item>>(emptyList())
    public val items: StateFlow<List<{{CLASS}}Item>> get() = _items
    public fun add(title: String) { if (title.isNotBlank()) _items.update { it + {{CLASS}}Item(System.nanoTime().toString(36), title.trim()) } }
    public fun toggle(id: String) { _items.update { list -> list.map { if (it.id == id) it.copy(done = !it.done) else it } } }
    public fun remove(id: String) { _items.update { list -> list.filterNot { it.id == id } } }
}
