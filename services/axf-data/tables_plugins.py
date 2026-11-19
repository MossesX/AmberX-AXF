"""Plugin tables (postgres part C s2 + s3, s4.5 of framework/spec/DATA-INVENTORY.md): agent-swarm, the lander, UI Review
screenshots, the remaining plugin data folders, Phone Connect, plus the catch-alls plugin_settings (a plugin's top-level
JSON documents) and plugin_docs (its nested documents); views over plugin journals (plugin_audit) and image keys.
Registered in tables.py after the domain and console tables. Keys move per framework/schemas/data-cut.json
(groups plugins-large, plugins-rest).
"""
from __future__ import annotations

import json

from psycopg.types.json import Jsonb

from store import canonical
from tables import Col, DocTable, ListSpec, RecordTable, _ddl_cols, lift
from tables_shapes import ArrayTable, KvTable, PathRecordTable, TextTable

# s2 (s4.5a): the large plugin documents. Keys of the open `plugins` namespace are `<folder>/<rest>`.
SWARM_RUN_COLS = [Col('schema', '$axf'), Col('kind'), Col('job_id', 'jobId'), Col('build_id', 'buildId'), Col('step_id', 'stepId'), Col('job_type', 'jobType'),
                  Col('agent'), Col('model'), Col('started_at', 'startedAt'), Col('ended_at', 'endedAt'), Col('status'), Col('reason'), Col('turns', type='int')]
SWARM_MSG_COLS = [Col('id'), Col('at'), Col('sender', 'from'), Col('kind'), Col('text'), Col('job_id', 'jobId')]
SWARM_NOTICE_COLS = [Col('at'), Col('agent'), Col('text')]
LAND_COLS = [Col('id'), Col('title'), Col('branch'), Col('pr', type='int'), Col('head'), Col('state'), Col('reason'), Col('since'), Col('checked_at', 'checkedAt'), Col('agent')]
LINE_COLS = [Col('schema', '$axf'), Col('id'), Col('pr', type='int'), Col('build'), Col('branch'), Col('title'), Col('agent'), Col('priority'), Col('head'),
             Col('state'), Col('since'), Col('added_at', 'addedAt'), Col('attempts', type='int'), Col('main_sha', 'mainSha')]
SHOT_COLS = [Col('id'), Col('source'), Col('app'), Col('screen'), Col('viewport'), Col('session'), Col('branch'), Col('name'), Col('grp', 'group'),
             Col('added_at', 'addedAt'), Col('submitted_by', 'submittedBy'), Col('size', type='int')]
SWARM_RUNS = ArrayTable('swarm_runs', 'plugins', r'^agent-swarm/runs\.json$', 'agent-swarm runs (swarm-run@1): one row per run', SWARM_RUN_COLS, list_key='runs')
SWARM_STATE = DocTable('swarm_messages', 'plugins', 'agent-swarm/state.json',
                       {'messages': ListSpec('swarm_messages', SWARM_MSG_COLS, 'messages'), 'notices': ListSpec('swarm_notices', SWARM_NOTICE_COLS, 'notices')},
                       'agent-swarm state: one row per crew message (swarm_messages) and notice (swarm_notices); agents, rules, cards in store_heads')
SWARM_SAID = KvTable('swarm_sections_said', 'plugins', r'^agent-swarm/sections-said\.json$', 'crew sections already said: one row per section key (when)', map_key='said')
SWARM_JOBS = TextTable('swarm_jobs', 'plugins', r'^agent-swarm/job-(briefs|reports)/[^/]+\.md$', 'agent-swarm job briefs and reports (Markdown): one row per file')
LAND = DocTable('land_items', 'plugins', 'push-banner/land.json', {'items': ListSpec('land_items', LAND_COLS, 'items')},
                'the auto-lander (push-banner land.json): one row per build it lands; order, managed, flags in store_heads')
LANDING_LINE = DocTable('landing_line', 'plugins', 'push-banner/landing-line.json',
                        {'entries': ListSpec('landing_line', LINE_COLS, 'entries'), 'history': ListSpec('landing_line', LINE_COLS, 'history')},
                        'the landing line: one row per PR in line (section entries) and per PR that left it (section history)')
MERGE_QUEUE = KvTable('merge_queue', 'plugins', r'^push-banner/merge-queue\.json$', 'the merge queue state: one row per field (depth, mode, mainSha, history…)')
UI_SHOTS = DocTable('ui_review_screenshots', 'ui-review', 'screenshots/index.json', {'shots': ListSpec('ui_review_screenshots', SHOT_COLS, 'shots')},
                    'UI Review screenshots index: one row per screenshot (the image is a blob); groups in store_heads')
UI_PREDICTIONS = PathRecordTable('ui_review_predictions', 'ui-review', [Col('hash'), Col('at'), Col('item')], 'UI Review look predictions: one row per prediction',
                                 r'^predictions/[^/]+\.json$')

# s3 (s4.5b): the remaining plugin data folders (framework/spec/DATA-INVENTORY.md §4).
class PluginDocTable(RecordTable):
    """Every JSON document below a plugin's top folder (conversations/, whatsnew/, memory/, plans/, reports/…) that no
    table above claims: one row per document, with the plugin and its sub-folder lifted so a plugin's documents are one
    query (`WHERE plugin = 'ai-assistant' AND folder = 'conversations'`)."""

    def __init__(self):
        super().__init__('plugin_docs', 'plugins', [Col('schema', '$axf'), Col('id'), Col('title'), Col('name'), Col('kind'), Col('status')],
                         "plugins' documents in sub-folders (conversations, whatsnew, memory, plans, reports…): one row per document",
                         r'^[a-z0-9][a-z0-9-]*/.+/[^/]+\.json$')

    def match(self, ns: str, path: str, kind: str, content_type: str, body: bytes) -> bool:
        return kind == 'record' and ns == self.ns and bool(self.path_re.match(path)) and body.lstrip().startswith(b'{')

    def write(self, cur, ns: str, path: str, body: bytes) -> None:
        doc = json.loads(body.decode('utf-8'))
        vals, extra = lift(doc, self.cols)
        plugin, _, rest = path.partition('/')
        names = ''.join(f', "{c.name}"' for c in self.cols)
        sets = ', '.join(f'"{c.name}"=EXCLUDED."{c.name}"' for c in self.cols)
        cur.execute(f'INSERT INTO "{self.name}" (ns, path, plugin, folder{names}, extra) VALUES (%s, %s, %s, %s{", %s" * len(self.cols)}, %s) '
                    f'ON CONFLICT (ns, path) DO UPDATE SET plugin=EXCLUDED.plugin, folder=EXCLUDED.folder, {sets}, extra=EXCLUDED.extra',
                    (ns, path, plugin, rest.rpartition('/')[0], *[vals[c.name] for c in self.cols], Jsonb(extra, dumps=canonical)))

    def ddl(self) -> str:
        return (f'CREATE TABLE IF NOT EXISTS "{self.name}" (ns TEXT NOT NULL, path TEXT NOT NULL, plugin TEXT NOT NULL, folder TEXT NOT NULL{_ddl_cols(self.cols)}, '
                f'extra JSONB NOT NULL DEFAULT \'{{}}\', PRIMARY KEY (ns, path));\n'
                f'CREATE INDEX IF NOT EXISTS plugin_docs_plugin ON plugin_docs (plugin, folder);')


AGENT_RUNS = ArrayTable('agent_runs', 'plugins', r'^agent-manager/runs\.json$', 'Agent Manager runs: one row per run',
                        [Col('id'), Col('agent'), Col('status'), Col('at'), Col('model')], list_key='items')
AGENT_HUB_RUNS = ArrayTable('agent_hub_runs', 'plugins', r'^agent-manager/hub-runs\.json$', 'Agent Manager runs on axHub: one row per run',
                            [Col('id'), Col('agent'), Col('status'), Col('at')])
TODO = DocTable('todo_items', 'plugins', 'todo-manager/store.json',
                {'entries': ListSpec('todo_items', [Col('id'), Col('list'), Col('title'), Col('status'), Col('type'), Col('due')], 'entries'),
                 'lists': ListSpec('todo_lists', [Col('id'), Col('title'), Col('kind')], 'lists')},
                'To-do manager: one row per entry (todo_items) and per list (todo_lists); types in store_heads')
HEALTH_CHECKS = KvTable('health_checks', 'plugins', r'^systems-check/health-state\.json$', 'the systems check health@1 state: one row per check (its last result)', map_key='checks')
WORKERS = ArrayTable('worker_accounts', 'plugins', r'^claude-accounts/workers\.json$', 'Claude worker accounts: one row per worker; limits and routing in store_heads',
                     [Col('id'), Col('name'), Col('account'), Col('kind')], list_key='workers')
TERMINAL_FEEDS = KvTable('terminal_feeds', 'plugins', r'^console-terminal/feeds\.json$', 'console terminal feeds: one row per feed', map_key='feeds')
ASSISTANT_USAGE = KvTable('assistant_usage', 'plugins', r'^ai-assistant/usage\.json$', 'AI assistant usage: one row per day', map_key='days')
GLOSSARY = ArrayTable('glossary_terms', 'plugins', r'^glossary-index/catalog\.json$', 'the glossary index: one row per term',
                      [Col('id'), Col('kind'), Col('name'), Col('title')], list_key='entries')
SHIPPED_FEED = ArrayTable('shipped_feed', 'plugins', r'^whats-shipped/feed\.json$', "What's shipped feed: one row per item",
                          [Col('id'), Col('title'), Col('at'), Col('pr', type='int'), Col('build')], list_key='items')
COMMAND_CATALOG = ArrayTable('command_catalog', 'plugins', r'^console-commands/catalog-owner\.json$', 'the console command catalog: one row per command',
                             [Col('id'), Col('title'), Col('plugin'), Col('kind')], list_key='items')
PHONE_DEVICES = PathRecordTable('phone_devices', 'phone', [Col('schema', '$axf'), Col('device_id', 'deviceId'), Col('name'), Col('app'), Col('platform'), Col('state')],
                                'Phone Connect devices: one row per device', r'^devices/[^/]+\.json$')
PHONE_PAIRINGS = PathRecordTable('phone_pairings', 'phone', [Col('schema', '$axf'), Col('id'), Col('device_id', 'deviceId'), Col('state')],
                                 'Phone Connect pairings: one row per pairing', r'^pairings/[^/]+\.json$')
PHONE_COMMANDS = PathRecordTable('phone_commands', 'phone', [Col('schema', '$axf'), Col('id'), Col('device_id', 'deviceId'), Col('state'), Col('kind')],
                                 'Phone Connect commands: one row per command', r'^commands/.+\.json$')
PLUGIN_DOCS = PluginDocTable()

# The plugins' small single-object documents (config, settings, control, state files at the top of a plugin's data folder)
# that no table above claims: one row per setting. Last in TABLES, so every specific table wins.
PLUGIN_SETTINGS = KvTable('plugin_settings', 'plugins', r'^[a-z0-9][a-z0-9-]*/[^/]+\.json$',
                          "plugins' small documents (settings, config, control, state at the top of a data folder): one row per top-level key")

PLUGIN_TABLES: list = [SWARM_RUNS, SWARM_STATE, SWARM_SAID, SWARM_JOBS, LAND, LANDING_LINE, MERGE_QUEUE, UI_SHOTS, UI_PREDICTIONS,
                       AGENT_RUNS, AGENT_HUB_RUNS, TODO, HEALTH_CHECKS, WORKERS, TERMINAL_FEEDS, ASSISTANT_USAGE, GLOSSARY, SHIPPED_FEED,
                       COMMAND_CATALOG, PHONE_DEVICES, PHONE_PAIRINGS, PHONE_COMMANDS, PLUGIN_SETTINGS, PLUGIN_DOCS]  # catch-alls last
PLUGIN_HOLDS = {
    'todo_lists': 'To-do manager lists (one row per list)',
    'plugin_audit': "view: every plugin journal line (audit.jsonl, history, logs) with its plugin and action",
    'phone_log': 'view: the Phone Connect log, one row per line',
    'swarm_notices': 'agent-swarm notices (one row per notice)',
    'ui_review_shots': 'view: every UI Review image (shots/, screenshots/files/) with its key, size and blob',
    'chat_audio': 'view: Chat viewer audio clips (console/chat-viewer/audio/…) with their blob',
    'land_log': 'view: the lander logs (push-banner land-runs, land-batches, gate-log), one row per line',
}
PLUGIN_SQL = """
CREATE OR REPLACE VIEW ui_review_shots AS
  SELECT path, size, content_type, blob_sha, at, actor FROM keys WHERE ns = 'ui-review' AND (path LIKE 'shots/%' OR path LIKE 'screenshots/files/%') AND NOT deleted;
CREATE OR REPLACE VIEW chat_audio AS
  SELECT path, size, content_type, blob_sha, at, actor FROM keys WHERE ns = 'console' AND path LIKE 'chat-viewer/audio/%' AND NOT deleted;
CREATE OR REPLACE VIEW land_log AS
  SELECT split_part(path, '/', 2) AS log, seq, at, actor, entry FROM journal WHERE ns = 'plugins' AND path IN ('push-banner/land-runs.jsonl', 'push-banner/land-batches.jsonl', 'push-banner/gate-log.jsonl');
CREATE OR REPLACE VIEW plugin_audit AS
  SELECT split_part(path, '/', 1) AS plugin, path, seq, at, actor, entry->>'action' AS action, COALESCE(entry->>'by', actor) AS who, entry
  FROM journal WHERE ns = 'plugins';
CREATE OR REPLACE VIEW phone_log AS
  SELECT seq, at, actor, entry->>'kind' AS kind, entry->>'device' AS device, entry FROM journal WHERE ns = 'phone' AND path = 'log';
CREATE INDEX IF NOT EXISTS swarm_runs_status ON swarm_runs (status);
"""
