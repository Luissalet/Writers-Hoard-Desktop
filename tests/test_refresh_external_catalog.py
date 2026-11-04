"""The Links/Kafka catalogue refresh keeps Writer's names and timeouts, adds new tools and never drops one."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('refresh_external_catalog', ROOT / 'scripts/refresh-external-catalog.py')
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


def test_merge_keeps_names_timeouts_and_adds_new_tools():
    current = [{'name': 'list_links', 'native_name': 'list_links', 'module': 'links', 'description': 'old', 'annotations': {},
                'inputSchema': {'type': 'object', 'properties': {}}, 'x-timeout-s': 45},
               {'name': 'gone_tool', 'native_name': 'gone_tool', 'module': 'links', 'description': '', 'annotations': {}, 'inputSchema': {'type': 'object'}}]
    live = [{'name': 'list_links', 'description': 'new', 'annotations': {'readOnlyHint': True}, 'inputSchema': {'type': 'object', 'properties': {'q': {'type': 'string'}}}},
            {'name': 'crawl_site', 'description': 'crawl', 'annotations': {}, 'inputSchema': {'type': 'object', 'properties': {}}},
            {'name': 'audio_find', 'description': 'find', 'annotations': {}, 'inputSchema': {'type': 'object', 'properties': {}}}]
    merged, added, gone = refresh.merge('links', current, live)
    by = {entry['name']: entry for entry in merged}
    assert by['list_links']['description'] == 'new' and by['list_links']['x-timeout-s'] == 45
    assert by['list_links']['inputSchema']['properties'] == {'q': {'type': 'string'}}
    assert added == ['crawl_site', 'audio_find'] and by['crawl_site']['x-timeout-s'] == 120 and by['audio_find']['x-timeout-s'] == 1260
    assert gone == ['gone_tool'] and 'gone_tool' in by
    assert all(entry['module'] == 'links' and entry['native_name'] for entry in merged)


def test_kafka_reason_stays_optional_in_writer():
    schema = {'type': 'object', 'properties': {'doc': {'type': 'string'}, 'reason': {'type': 'string', 'minLength': 3}}, 'required': ['doc', 'reason']}
    out = refresh.optional_reason(schema)
    assert out['required'] == ['doc'] and 'reason' in out['properties'] and 'Writer' in out['properties']['reason']['description']
    assert schema['required'] == ['doc', 'reason']
    only = refresh.optional_reason({'type': 'object', 'properties': {'reason': {'type': 'string'}}, 'required': ['reason']})
    assert 'required' not in only


def test_committed_catalogue_lists_the_newer_tools_with_optional_reason():
    catalog = json.loads((ROOT / 'publishing/fusion/catalog.json').read_text(encoding='utf-8'))
    names = {entry['name'] for entry in catalog}
    assert {'crawl_site', 'map_site', 'read_post', 'watch_list_preview', 'audio_find', 'kafka_dossier', 'kafka_requirements_diff'} <= names
    assert not [entry['name'] for entry in catalog if 'reason' in (entry['inputSchema'].get('required') or [])]
