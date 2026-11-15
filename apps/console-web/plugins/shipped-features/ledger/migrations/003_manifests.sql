-- shipped-manifest@1: what the orchestrator sent when each build landed (framework/core/shipped-manifest.mjs).
-- One row per build (the latest rev); the sidecar _claude/builds/shipped/<build>.json is the source, this is the ledger's copy.
CREATE TABLE IF NOT EXISTS manifests (
  id            TEXT PRIMARY KEY,
  build         TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 1,
  pr            INTEGER NOT NULL DEFAULT 0,
  landed_commit TEXT NOT NULL DEFAULT '',
  landed_at     TEXT NOT NULL DEFAULT '',
  shipped_at    TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',
  said          TEXT NOT NULL DEFAULT '',
  doc           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS manifests_build ON manifests (build);
CREATE INDEX IF NOT EXISTS manifests_landed ON manifests (landed_at);
