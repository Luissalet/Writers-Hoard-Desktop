"""Refresh Writer's links/paperwork tool entries from the running Links Hoard and Kafka's Hoard.

Writer forwards these tools to the two apps by reference (publishing/fusion/external.py),
so its frozen catalogue should list what the apps offer now. Published names, module
ownership and Writer's per-tool timeouts are kept; new tools are added with the app's
current description, annotations and schema. Kafka requires a ``reason`` on agent
writes: Writer's proxy fills it in, so the property stays optional in Writer's schema.
Run with both apps running, then ``python scripts/build-publishing-catalog.py``.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'publishing')]
os.environ.setdefault('HOARD_EVENTS', '0')
import httpx
from fusion import external

CATALOG = ROOT / 'publishing/fusion/catalog.json'
CAPABILITIES = ROOT / 'publishing/provenance/CAPABILITIES.md'
DEFAULT_TIMEOUT_S = {'audio_status': 120, 'crawl_site': 120, 'crawl_status': 60, 'crawl_delete': 30, 'map_site': 120,
                     'read_post': 120, 'watch_list_preview': 120, 'kafka_dossier': 300, 'kafka_dossier_refresh': 300,
                     'kafka_dossier_status': 60, 'kafka_dossier_delete': 30, 'kafka_requirements_diff': 120}


def timeout_for(name):
    if name in DEFAULT_TIMEOUT_S:
        return DEFAULT_TIMEOUT_S[name]
    return 1260 if name.startswith('audio_') else None


def optional_reason(schema):
    schema = json.loads(json.dumps(schema))
    if 'reason' in (schema.get('required') or []):
        schema['required'] = [item for item in schema['required'] if item != 'reason']
        if not schema['required']:
            schema.pop('required')
        prop = schema.get('properties', {}).get('reason')
        if isinstance(prop, dict):
            prop['description'] = (prop.get('description', '') + ' Optional in Writer: when absent, Writer sends one naming itself and the tool.').strip()
    return schema


async def live_tools(key):
    where = await asyncio.to_thread(external.target, key, True)
    secret = external.token(where)
    async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
        reply = await client.get(where['url'] + '/api/agent/tools', headers={'Authorization': 'Bearer ' + secret} if secret else {})
    reply.raise_for_status()
    body = reply.json()
    return body['tools'] if isinstance(body, dict) else body


def merge(module, current, live):
    by_native = {entry.get('native_name') or entry['name']: entry for entry in current}
    merged, added = [], []
    for tool in live:
        old = by_native.get(tool['name'])
        entry = {'name': old['name'] if old else tool['name'], 'description': tool.get('description', ''),
                 'annotations': tool.get('annotations') or {}, 'inputSchema': optional_reason(tool.get('inputSchema') or {'type': 'object', 'properties': {}}),
                 'module': module, 'native_name': tool['name']}
        seconds = (old or {}).get('x-timeout-s') or timeout_for(tool['name'])
        if seconds:
            entry['x-timeout-s'] = seconds
        merged.append(entry)
        if not old:
            added.append(tool['name'])
    gone = [name for name in by_native if name not in {tool['name'] for tool in live}]
    if gone:  # never drop a tool Writer already exposes; the app answers for it
        merged += [by_native[name] for name in gone]
    return merged, added, gone


def capabilities(catalog):
    rows = [entry for entry in catalog if entry['module'] in ('library', 'links', 'paperwork')]
    counts = {module: sum(1 for entry in rows if entry['module'] == module) for module in ('library', 'links', 'paperwork')}
    text = ['# Preserved native tools', '',
            "Since 04-11-2026 the links and paperwork tools keep these names in Writer but run in Links Hoard and Kafka's Hoard, "
            'which Writer calls by reference (`publishing/fusion/external.py`). Refreshed from the running apps with '
            '`scripts/refresh-external-catalog.py`.', '', '| Module | Tools |', '|---|---:|']
    text += [f'| {module} | {count} |' for module, count in counts.items()]
    text += ['', '| Module | Published name | Native name |', '|---|---|---|']
    text += [f"| {entry['module']} | `{entry['name']}` | `{entry.get('native_name') or entry['name']}` |" for entry in rows]
    return '\n'.join(text) + '\n'


async def main():
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    out = []
    for module, key in (('library', None), ('links', 'links'), ('paperwork', 'paperwork'), ('publishing', None)):
        current = [entry for entry in catalog if entry.get('module') == module]
        if key is None:
            out += current
            continue
        merged, added, gone = merge(module, current, await live_tools(key))
        print(f'{module}: {len(current)} -> {len(merged)}; added {added}; kept although not listed {gone}')
        out += merged
    CATALOG.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    CAPABILITIES.write_text(capabilities(out), encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())
