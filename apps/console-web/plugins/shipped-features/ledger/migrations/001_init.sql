-- feature-ledger@1 in SQLite (Shipped features). Every table keeps the normalised record in `doc` (JSON, the
-- framework/core/feature-ledger.mjs shape) and lifts the columns the grid sorts and filters on.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, type TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT '',
  plugin TEXT NOT NULL DEFAULT '', repo TEXT NOT NULL DEFAULT '', planned_at TEXT NOT NULL DEFAULT '', merged_at TEXT NOT NULL DEFAULT '',
  first_live_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '', last_edit_at TEXT NOT NULL DEFAULT '',
  edit_count INTEGER NOT NULL DEFAULT 0, being_edited INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'live',
  updated_at TEXT NOT NULL DEFAULT '', rev INTEGER NOT NULL DEFAULT 1, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS features_status ON features (status);
CREATE INDEX IF NOT EXISTS features_planned ON features (planned_at);
CREATE INDEX IF NOT EXISTS features_live ON features (first_live_at);
CREATE INDEX IF NOT EXISTS features_edited ON features (last_edit_at);
-- every earlier version of a feature (the original is rev 1): "the original version kept in history"
CREATE TABLE IF NOT EXISTS feature_history (feature_id TEXT NOT NULL, rev INTEGER NOT NULL, at TEXT NOT NULL, why TEXT NOT NULL DEFAULT '', doc TEXT NOT NULL, PRIMARY KEY (feature_id, rev));
CREATE TABLE IF NOT EXISTS feature_builds (feature_id TEXT NOT NULL, build_key TEXT NOT NULL, step_uid TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'added', PRIMARY KEY (feature_id, build_key, step_uid));
CREATE INDEX IF NOT EXISTS feature_builds_build ON feature_builds (build_key);
CREATE TABLE IF NOT EXISTS prs (key TEXT PRIMARY KEY, repo TEXT NOT NULL, number INTEGER NOT NULL, state TEXT NOT NULL, merged_at TEXT NOT NULL DEFAULT '', merge_commit TEXT NOT NULL DEFAULT '', build TEXT NOT NULL DEFAULT '', doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS builds (key TEXT PRIMARY KEY, id TEXT NOT NULL, profile TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', pr INTEGER NOT NULL DEFAULT 0, merged_at TEXT NOT NULL DEFAULT '', doc TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS builds_id ON builds (id);
CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, build TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT '', verbatim INTEGER NOT NULL DEFAULT 1, said TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS prompts_build ON prompts (build);
CREATE TABLE IF NOT EXISTS deploys (id TEXT PRIMARY KEY, target TEXT NOT NULL, sha TEXT NOT NULL, at TEXT NOT NULL, state TEXT NOT NULL, doc TEXT NOT NULL);
-- build-hook@1 events already applied (listeners are idempotent on event id)
CREATE TABLE IF NOT EXISTS events_seen (id TEXT PRIMARY KEY, at TEXT NOT NULL);
