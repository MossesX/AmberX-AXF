-- feature-edit@1: a later build, addendum, PR or fix that touches an existing feature is an edit of it, not a new feature.
CREATE TABLE IF NOT EXISTS edits (
  id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'changed', summary TEXT NOT NULL,
  build TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL DEFAULT '', pr INTEGER NOT NULL DEFAULT 0, repo TEXT NOT NULL DEFAULT '',
  commit_sha TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '',
  session TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, at TEXT NOT NULL, merged_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS edits_feature ON edits (feature_id, at);
CREATE INDEX IF NOT EXISTS edits_status ON edits (status);
CREATE INDEX IF NOT EXISTS edits_build ON edits (build);
