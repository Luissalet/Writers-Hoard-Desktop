"""Private native API/MCP contract checks. No Hub, model or real profile."""
from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'publishing'))
os.environ['HOARD_EVENTS'] = '0'
os.environ['BORGES_EMBED'] = 'none'
from fusion.app import create_app


@pytest.fixture(autouse=True)
def no_external_io(monkeypatch):
    def reject(*args, **kwargs):
        raise AssertionError('No external HTTP transport in synthetic publishing QA')
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', reject)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', reject)


@pytest.mark.asyncio
async def test_catalog_and_disabled_calls_do_not_create_engines(tmp_path):
    app = create_app(tmp_path, port=5174)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:5174') as client:
            catalog = (await client.get('/api/agent/tools')).json()['tools']
            native = json.loads((ROOT / 'publishing/fusion/catalog.json').read_text(encoding='utf-8'))
            served = {tool['name']: tool for tool in catalog}
            assert len(served) == len(catalog)
            for tool in native:
                assert served[tool['name']]['inputSchema'] == tool['inputSchema']
            for module in app.state.modules.values():
                assert module.app is None
                assert not module.data_dir.exists()
            failed = await client.post('/api/agent/call', headers={'Authorization': 'Bearer ' + app.state.token}, json={'name': 'gutenberg_publications', 'arguments': {}})
            assert failed.status_code == 409
            assert all(module.app is None for module in app.state.modules.values())


@pytest.mark.asyncio
async def test_native_api_tools_identity_and_reopen(tmp_path):
    app = create_app(tmp_path, port=5174)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:5174') as client:
            headers = {'Authorization': 'Bearer ' + app.state.token}
            for module, tool in [('library', 'library_collections'), ('paperwork', 'docs_list'), ('publishing', 'gutenberg_publications'), ('links', 'list_links')]:
                response = await client.put('/api/modules/' + module, json={'enabled': True})
                assert response.status_code == 200, response.text
                assert response.json()['automatic'] is False
                identity = (await client.get('/api/writer-identity/' + module)).json()
                token = (app.state.modules[module].data_dir / 'mcp-token').read_bytes()
                response = await client.post('/api/agent/call', headers=headers, json={'name': tool, 'arguments': {}})
                assert response.status_code == 200, response.text
                off = await client.put('/api/modules/' + module, json={'enabled': False})
                assert off.status_code == 200
                assert app.state.modules[module].app is None
                assert (await client.get('/' + module + '/api/health')).status_code == 409
                assert (await client.put('/api/modules/' + module, json={'enabled': True})).status_code == 200
                assert (await client.get('/api/writer-identity/' + module)).json() == identity
                assert (app.state.modules[module].data_dir / 'mcp-token').read_bytes() == token
                assert (await client.put('/api/modules/' + module, json={'enabled': False})).status_code == 200


@pytest.mark.asyncio
async def test_paperwork_write_visible_through_native_tool_and_binary_upload(tmp_path):
    app = create_app(tmp_path, port=5174)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:5174') as client:
            assert (await client.put('/api/modules/paperwork', json={'enabled': True})).status_code == 200
            saved = await client.post('/paperwork/api/ui/call', json={'name': 'deadline_add', 'arguments': {'title': 'Synthetic editorial deadline', 'date': '2030-12-31', 'kind': 'other'}})
            assert saved.status_code == 200, saved.text
            record = saved.json()
            ident = record.get('id') or record.get('deadline', {}).get('id')
            assert ident, record
            response = await client.post('/api/agent/call', headers={'Authorization': 'Bearer ' + app.state.token}, json={'name': 'deadline_get', 'arguments': {'deadline': ident}})
            assert response.status_code == 200, response.text
            assert 'Synthetic editorial deadline' in response.text
            uploaded = await client.post('/paperwork/api/documents/upload', files={'files': ('synthetic.txt', b'PRIVATE SYNTHETIC QA\x00tail\xff', 'text/plain')})
            assert uploaded.status_code in (200, 201), uploaded.text
            assert list((tmp_path / 'paperwork/files').rglob('*'))


def test_stdio_catalog_starts_without_engine_or_socket(tmp_path):
    messages = [{'id': 1, 'op': 'init', 'dataDir': str(tmp_path)}, {'id': 2, 'method': 'GET', 'path': '/api/agent/tools'}, {'id': 3, 'op': 'shutdown'}]
    result = subprocess.run([sys.executable, str(ROOT / 'publishing/worker.py')], input=''.join(json.dumps(message) + '\n' for message in messages), capture_output=True, text=True, timeout=30, env={**os.environ, 'HOARD_EVENTS': '0'})
    assert result.returncode == 0, result.stderr
    replies = [json.loads(line) for line in result.stdout.splitlines()]
    assert [reply['id'] for reply in replies] == [1, 2, 3]
    assert all(reply['ok'] for reply in replies), replies
    assert not any((tmp_path / module).exists() for module in ('library', 'links', 'paperwork', 'publishing'))


def test_worker_media_cli_dispatch_without_download_or_model():
    worker = str(ROOT / 'publishing/worker.py')
    version = subprocess.run([sys.executable, worker, '--version'], capture_output=True, text=True, timeout=20)
    assert version.returncode == 0 and version.stdout.startswith('Python ')
    package = subprocess.run([sys.executable, worker, '-m', 'yt_dlp', '--version'], capture_output=True, text=True, timeout=20)
    assert package.returncode == 0 and package.stdout.strip()
    probe = subprocess.run([sys.executable, worker, '-c', 'print("owned-runtime-probe")'], capture_output=True, text=True, timeout=20)
    assert probe.returncode == 0 and probe.stdout.strip() == 'owned-runtime-probe'
