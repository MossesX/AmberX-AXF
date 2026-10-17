package {{PACKAGE}}

import ai.amberx.axf.kernel.result.AxfResult

/** The contract apps code against; real providers (per platform / vendor) implement it. */
public interface {{CLASS}}Provider {
    public val name: String
    public suspend fun status(): AxfResult<String>
}

/** Ships with the library so apps and demos work before a real provider exists. */
public class Mock{{CLASS}}Provider : {{CLASS}}Provider {
    override val name: String = "mock"
    override suspend fun status(): AxfResult<String> = AxfResult.ok("Mock {{LABEL}} provider ready")
}

/** Registered as a service; swap `provider` at startup (or from settings) to change implementations. */
public class {{CLASS}}Service(public var provider: {{CLASS}}Provider = Mock{{CLASS}}Provider())
