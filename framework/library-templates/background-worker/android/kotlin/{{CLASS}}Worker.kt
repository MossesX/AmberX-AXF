package {{PACKAGE}}

import ai.amberx.axf.kernel.contract.WorkOutcome
import ai.amberx.axf.kernel.contract.Worker

/** The job itself. Report progress, return Success / Retry / Failure; the scheduler (WorkManager on Android) runs it. */
public class {{CLASS}}Worker : Worker {
    override suspend fun run(input: String, progress: suspend (String) -> Unit): WorkOutcome {
        progress("{{LABEL}}: working")
        return WorkOutcome.Success("{}")
    }
}
