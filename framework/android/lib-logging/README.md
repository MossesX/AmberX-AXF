# lib-logging

Logging engine for every AXF app: wraps the platform logger, ring buffer (2000 entries) for the live viewer, rolling file sink, extra sinks via `ExtensionPoints.LOG_SINKS` (remote shipping is a placeholder), crash capture with breadcrumbs from kernel events, `LogsScreen` viewer with filters/copy/crash-test, and `DiagnosticsCard`.
