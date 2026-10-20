"""Writer project references to native objects and outputs; no source copies."""
import json
import sqlite3
from pathlib import Path

PROJECT_TOOLS = [
    {'name': 'wh_publishing_link_project', 'description': 'Persist a Writer project reference to a native library, reading, paperwork or publishing object/output.\nRetains its native ID and ownership; copies no source data.', 'inputSchema': {'type': 'object', 'properties': {'projectId': {'type': 'string', 'minLength': 1}, 'module': {'type': 'string', 'enum': ['library', 'links', 'paperwork', 'publishing']}, 'kind': {'type': 'string', 'minLength': 1}, 'object_id': {'type': 'string', 'minLength': 1}, 'title': {'type': 'string'}, 'artifact': {'type': 'object'}}, 'required': ['projectId', 'module', 'kind', 'object_id']}, 'annotations': {'readOnlyHint': False, 'destructiveHint': False, 'idempotentHint': True}},
    {'name': 'wh_publishing_project_results', 'description': 'List native source objects and publishing outputs linked to a Writer project. Does not enable engines.', 'inputSchema': {'type': 'object', 'properties': {'projectId': {'type': 'string', 'minLength': 1}}, 'required': ['projectId']}, 'annotations': {'readOnlyHint': True, 'destructiveHint': False, 'idempotentHint': True}},
]


def project_call(root, name, args):
    project = args.get('projectId')
    if not isinstance(project, str) or not project:
        raise ValueError('projectId is required')
    with sqlite3.connect(Path(root) / 'writer-project-links.db') as conn:
        conn.row_factory = sqlite3.Row
        conn.execute('CREATE TABLE IF NOT EXISTS project_results(project_id TEXT, module TEXT, kind TEXT, object_id TEXT, title TEXT, artifact TEXT, PRIMARY KEY(project_id,module,kind,object_id))')
        if name == 'wh_publishing_link_project':
            module, kind, ident = (args.get(key) for key in ('module', 'kind', 'object_id'))
            if module not in ('library', 'links', 'paperwork', 'publishing') or not isinstance(kind, str) or not kind or not isinstance(ident, str) or not ident:
                raise ValueError('Valid module, kind and native object_id are required')
            conn.execute('INSERT INTO project_results VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,module,kind,object_id) DO UPDATE SET title=excluded.title,artifact=excluded.artifact',
                         (project, module, kind, ident, args.get('title') or '', json.dumps(args.get('artifact') or {}, ensure_ascii=False)))
        rows = conn.execute('SELECT * FROM project_results WHERE project_id=? ORDER BY module,kind,object_id', (project,)).fetchall()
        return {'projectId': project, 'results': [{**dict(row), 'artifact': json.loads(row['artifact'])} for row in rows]}
