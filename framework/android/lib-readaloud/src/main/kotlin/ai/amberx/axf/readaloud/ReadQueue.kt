package ai.amberx.axf.readaloud

/** One thing to read: the prepared text and its utterances, where it came from, and how fast. */
public data class ReadItem(val id: Long, val title: String, val text: String, val utterances: List<Utterance>, val rate: Double, val source: String = "", val addedAt: Long = 0L)

/** A finished (or stopped) read, for the history list. */
public data class ReadRecord(val title: String, val chars: Int, val finished: Boolean, val at: Long)

/**
 * The read-aloud queue as an immutable value: what's playing, what's next, and the history. [add] follows the
 * queue policy (replace what's playing / append / play next) and the size cap; pure, so the service just swaps values.
 */
public data class ReadQueue(val current: ReadItem? = null, val position: Int = 0, val next: List<ReadItem> = emptyList(), val history: List<ReadRecord> = emptyList()) {
    public val isIdle: Boolean get() = current == null

    public fun add(item: ReadItem, policy: QueuePolicy, maxSize: Int, historySize: Int, now: Long): ReadQueue {
        val cap = maxSize.coerceAtLeast(1)
        if (current == null) return copy(current = item, position = 0)
        return when (policy) {
            QueuePolicy.REPLACE -> copy(current = item, position = 0, history = (listOf(ReadRecord(current.title, current.text.length, false, now)) + history).take(historySize.coerceAtLeast(0)))
            QueuePolicy.APPEND -> if (next.size + 1 >= cap) this else copy(next = next + item)
            QueuePolicy.NEXT -> copy(next = (listOf(item) + next).take(cap - 1))
        }
    }

    /** Ends the current item ([finished] = read to the end) and moves to the next one, keeping [historySize] records. */
    public fun finish(finished: Boolean, historySize: Int, now: Long): ReadQueue {
        val c = current ?: return this
        val rec = ReadRecord(c.title, c.text.length, finished, now)
        val hist = (listOf(rec) + history).take(historySize.coerceAtLeast(0))
        return ReadQueue(next.firstOrNull(), 0, next.drop(1), hist)
    }

    public fun seek(index: Int): ReadQueue = current?.let { copy(position = index.coerceIn(0, (it.utterances.size - 1).coerceAtLeast(0))) } ?: this
    public fun clear(historySize: Int, now: Long): ReadQueue = finish(false, historySize, now).copy(current = null, position = 0, next = emptyList())

    /** 0…1 through the current item, by characters. */
    public fun progress(): Double {
        val c = current ?: return 0.0
        val total = c.utterances.sumOf { it.text.length }.coerceAtLeast(1)
        return c.utterances.take(position).sumOf { it.text.length } / total.toDouble()
    }
}

/** Builds a [ReadItem] from raw text: prepare → limit → chunk. Null when nothing is left to read or it's over a refusing limit. */
public object ReadAloudPlan {
    public fun item(raw: String, p: ReadAloudPrefs, id: Long, title: String, slow: Boolean = false, source: String = "", now: Long = 0L): ReadItem? {
        val prepared = TextPrep.prepare(raw, p)
        val limited = TextPrep.limit(prepared, p.maxChars, p.overLimit) ?: return null
        val utterances = TextChunker.chunk(limited, p)
        if (utterances.isEmpty()) return null
        return ReadItem(id, title, limited, utterances, p.rateFor(limited.length, slow), source, now)
    }

    /** Repeat rule: how many more times to start over after finishing read [readTimes] times (LOOP = always). */
    public fun shouldRepeat(p: ReadAloudPrefs, readTimes: Int): Boolean = when (p.repeat) {
        RepeatMode.OFF -> false
        RepeatMode.LOOP -> true
        RepeatMode.TIMES -> readTimes < p.repeatTimes
    }
}
