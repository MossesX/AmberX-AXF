"""Console tables (postgres part C s1, s4.4 of framework/spec/DATA-INVENTORY.md): the console's own state documents,
alerts, notifications, Home cards, AmberX notes, the app catalog; views over the deploys log and the token log.
Registered in tables.py after the domain tables. Which keys move when: framework/schemas/data-cut.json (group console).
"""
from __future__ import annotations

from tables import Col
from tables_shapes import ArrayTable, KvTable, MapTable, PathRecordTable

ALERT_COLS = [Col('id'), Col('key'), Col('source'), Col('severity'), Col('title'), Col('first_at', 'firstAt', 'int'),
              Col('last_at', 'lastAt', 'int'), Col('count', type='int'), Col('ack', type='bool'), Col('resolved', type='bool'),
              Col('resolved_at', 'resolvedAt', 'int')]
NOTIFY_COLS = [Col('schema', '$axf'), Col('id'), Col('kind'), Col('source'), Col('title'), Col('at'), Col('status'), Col('severity')]
HOME_COLS = [Col('schema', '$axf'), Col('owner'), Col('updated_at', 'updatedAt')]
AMBERX_NOTE_COLS = [Col('id'), Col('kind'), Col('list'), Col('title'), Col('status'), Col('created_at', 'createdAt'), Col('updated_at', 'updatedAt')]
APP_COLS = [Col('project'), Col('name'), Col('platform'), Col('app_id', 'appId')]
APP_VERSION_COLS = [Col('version'), Col('build', type='int'), Col('version_code', 'versionCode', 'int'), Col('file'), Col('size', type='int'),
                    Col('sha256'), Col('built_at', 'builtAt'), Col('commit')]

# console/ paths that are the console's own small state documents (one KvTable family). Plugin data, journals and the
# documents with their own table (alerts, control inventory, home cards, shared/*) are not in it.
CONSOLE_STATE_RE = r'^(state|host-check|nightly|update-status|project-wizard|alerts-run|alerts-config)\.json$|^(main-gate|wall|github-app)/[^/]+\.json$'
CONSOLE_STATE = KvTable('console_state', 'console', CONSOLE_STATE_RE,
                        "the console's own state documents (state.json, host-check, nightly, update-status, project-wizard, main-gate…): one row per top-level key")
ALERTS = ArrayTable('alerts', 'console', r'^alerts\.json$', 'the alert hub (alerts@1): one row per alert, severity / ack / resolved lifted', ALERT_COLS)
ALERTS_SEEN = ArrayTable('alerts_seen', 'console', r'^alerts-seen\.json$', 'CI run ids the alert hub has already reported: one row per id')
NOTIFICATIONS = PathRecordTable('notifications', 'console', NOTIFY_COLS, 'the shared notifications inbox: one row per notification',
                                r'^shared/notifications/.+\.json$')
HOME_CARDS = PathRecordTable('home_cards', 'console', HOME_COLS, 'each owner\'s Home cards layout (home-layout@1): one row per owner',
                             r'^home-cards/[^/]+\.json$')
AMBERX_NOTES = MapTable('amberx_notes', 'console', r'^amberx-notes/items/rows-\d+\.json$', 'AmberX notes and tasks (hub-table@1 chunks): one row per item', AMBERX_NOTE_COLS)
AMBERX_NOTE_LISTS = MapTable('amberx_note_lists', 'console', r'^amberx-notes/lists/rows-\d+\.json$', 'AmberX note lists (hub-table@1 chunks): one row per list',
                             [Col('id'), Col('title'), Col('kind')])
APP_CATALOG = ArrayTable('app_catalog', 'console', r'^shared/app-catalog/catalog\.json$', 'the app catalog (app-catalog@1): one row per app, its builds in app_catalog_versions',
                         APP_COLS, list_key='apps', child=('versions', 'app_catalog_versions', APP_VERSION_COLS))

CONSOLE_TABLES: list = [CONSOLE_STATE, ALERTS, ALERTS_SEEN, NOTIFICATIONS, HOME_CARDS, AMBERX_NOTES, AMBERX_NOTE_LISTS, APP_CATALOG]
CONSOLE_HOLDS = {
    'app_catalog_versions': 'each build of each app in the app catalog (version, build, file, sha256, builtAt)',
    'console_deploys': 'view: the console deploys log (console/deploys/log), one row per deploy',
    'token_log': 'view: the token log (console/token-log/<yyyy>/<mm>/<dd>.jsonl), one row per turn',
}
CONSOLE_SQL = """
CREATE OR REPLACE VIEW console_deploys AS
  SELECT seq, at, actor, entry->>'sha' AS sha, entry->>'result' AS result, entry->>'by' AS who, entry
  FROM journal WHERE ns = 'console' AND path = 'deploys/log';
CREATE OR REPLACE VIEW token_log AS
  SELECT path, seq, at, actor, entry->>'id' AS id, entry->>'source' AS source, entry->>'session' AS session, entry->>'model' AS model, entry
  FROM journal WHERE ns = 'console' AND path LIKE 'token-log/%';
CREATE INDEX IF NOT EXISTS alerts_severity ON alerts (severity);
CREATE INDEX IF NOT EXISTS notifications_status ON notifications (status);
"""
