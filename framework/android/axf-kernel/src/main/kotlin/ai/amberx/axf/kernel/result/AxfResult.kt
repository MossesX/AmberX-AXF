package ai.amberx.axf.kernel.result

/**
 * The one failure type every kernel and library API uses. Typed, user-presentable, and retry-aware,
 * so a screen can render any failure without knowing which module produced it.
 */
public sealed class AxfFailure(public open val message: String, public open val cause: Throwable? = null) {
    /** Caller error: bad arguments, wrong state. Not retryable. */
    public data class Invalid(override val message: String, val field: String? = null, override val cause: Throwable? = null) : AxfFailure(message, cause)
    /** A declared capability nobody has built yet. The placeholder mechanism returns this. */
    public data class NotImplemented(val capability: String, override val message: String = "\"$capability\" is declared but not built yet.") : AxfFailure(message)
    /** The current role lacks a permission (UAC engine). */
    public data class Denied(val permission: String, override val message: String = "Permission \"$permission\" is required.") : AxfFailure(message)
    /** Something was not found by id/path. */
    public data class NotFound(val what: String, val id: String, override val message: String = "No $what \"$id\".") : AxfFailure(message)
    /** Transient platform/network/storage condition. Retryable. */
    public data class Unavailable(override val message: String, val retryAfterMs: Long? = null, override val cause: Throwable? = null) : AxfFailure(message, cause)
    /** A validation report with one or more messages (assets, settings, forms). */
    public data class Validation(val errors: List<String>, override val message: String = errors.joinToString("; ")) : AxfFailure(message)
    /** Anything else. */
    public data class Unexpected(override val message: String, override val cause: Throwable? = null) : AxfFailure(message, cause)

    public val retryable: Boolean get() = this is Unavailable
}

/** Result type used across the framework. Mirrors kotlin.Result but with a typed failure. */
public sealed class AxfResult<out T> {
    public data class Ok<T>(val value: T) : AxfResult<T>()
    public data class Err(val failure: AxfFailure) : AxfResult<Nothing>()

    public val isOk: Boolean get() = this is Ok
    public fun getOrNull(): T? = (this as? Ok)?.value
    public fun failureOrNull(): AxfFailure? = (this as? Err)?.failure
    public inline fun <R> map(f: (T) -> R): AxfResult<R> = when (this) { is Ok -> Ok(f(value)); is Err -> this }
    public inline fun <R> flatMap(f: (T) -> AxfResult<R>): AxfResult<R> = when (this) { is Ok -> f(value); is Err -> this }
    public inline fun onErr(f: (AxfFailure) -> Unit): AxfResult<T> { if (this is Err) f(failure); return this }
    public inline fun onOk(f: (T) -> Unit): AxfResult<T> { if (this is Ok) f(value); return this }
    public fun getOrThrow(): T = when (this) { is Ok -> value; is Err -> throw AxfException(failure) }

    public companion object {
        public fun <T> ok(v: T): AxfResult<T> = Ok(v)
        public fun err(f: AxfFailure): AxfResult<Nothing> = Err(f)
        public inline fun <T> runCatching(block: () -> T): AxfResult<T> =
            try { Ok(block()) } catch (e: AxfException) { Err(e.failure) } catch (e: Exception) { Err(AxfFailure.Unexpected(e.message ?: e::class.simpleName ?: "error", e)) }
    }
}

public class AxfException(public val failure: AxfFailure) : RuntimeException(failure.message, failure.cause)
