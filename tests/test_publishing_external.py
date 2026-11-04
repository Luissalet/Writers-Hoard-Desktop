"""Writer's reading and paperwork modules call Links Hoard and Kafka's Hoard by reference.

An in-memory stand-in plays both Hoards and Hoard Hub: no network, no real profile data.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'publishing'))
os.environ['HOARD_EVENTS'] = '0'
os.environ['BORGES_EMBED'] = 'none'
from fusion import external
from fusion.app import create_app

TOKENS = {'links': 'links-synthetic-token', 'kafka': 'kafka-synthetic-token'}


def family(running=None):
    """Links Hoard, Kafka's Hoard and Hoard Hub in one ASGI app, chosen by Host."""
    state = {'running': {'links': True, 'kafka': True, **(running or {})}, 'calls': [], 'files': {}, 'starts': []}
    fake = FastAPI()

    @fake.api_route('/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE'])
    async def serve(path: str, request: Request):
        host = request.headers['host'].split(':')[0].split('.')[0]
        if host == 'hub':
            if path == 'api/apps':
                return {'apps': [{'id': app, 'url': f'http://{app}.test', 'token_file': '', 'state': 'running' if up else 'stopped'}
                                 for app, up in state['running'].items()]}
            app = path.split('/')[2]
            state['starts'].append(app)
            state['running'][app] = True
            return {'ok': True, 'id': app}
        if not state['running'][host]:
            raise httpx.ConnectError('connection refused (synthetic)')
        if path == 'api/health':
            return {'service': host + '-hoard', 'version': '9.9'}
        if request.headers.get('authorization') != 'Bearer ' + TOKENS[host]:
            return JSONResponse({'error': 'unauthorized'}, status_code=401)
        if path == 'api/agent/call':
            body = json.loads(await request.body())
            state['calls'].append((host, body))
            return {'tool': body['name'], 'reason': body.get('reason'), 'arguments': body.get('arguments')}
        if path == 'api/documents/upload':
            state['files']['d_1'] = await request.body()
            return {'results': [{'documents': [{'id': 'd_1'}]}]}
        if path == 'api/documents/d_1/file':
            return Response(state['files']['d_1'], media_type='application/octet-stream')
        if path == 'api/moved':
            return Response(status_code=303, headers={'location': f'http://{host}.test/api/health'})
        return JSONResponse({'error': 'not found', 'path': path}, status_code=404)
    return fake, state


@pytest.fixture
def hoards(tmp_path, monkeypatch):
    fake, state = family()
    monkeypatch.setattr(external, 'TRANSPORT', httpx.ASGITransport(app=fake))
    for env, app in (('WRITER_LINKS', 'links'), ('WRITER_KAFKA', 'kafka')):
        secret = tmp_path / f'{app}-token'
        secret.write_text(TOKENS[app], encoding='utf-8')
        monkeypatch.setenv(env + '_URL', f'http://{app}.test')
        monkeypatch.setenv(env + '_TOKEN_FILE', str(secret))
    return state


def via_hub(monkeypatch, tmp_path, state):
    """Drop the env override: the Hub's registry decides where each Hoard lives."""
    for env, app in (('WRITER_LINKS', 'links'), ('WRITER_KAFKA', 'kafka')):
        monkeypatch.delenv(env + '_URL', raising=False)
    monkeypatch.setattr(external, 'HUB_URL', 'http://hub.test')
    tokens = {app: str(tmp_path / f'{app}-token') for app in ('links', 'kafka')}
    monkeypatch.setattr(external, '_hub_apps', lambda refresh=False: (
        external._registry.update(apps={a: {'id': a, 'url': f'http://{a}.test', 'token_file': tokens[a],
                                           'state': 'running' if up else 'stopped'} for a, up in state['running'].items()})
        or external._registry['apps']))


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:5174', timeout=30)


@pytest.mark.asyncio
async def test_reading_and_paperwork_tools_reach_the_external_hoards(tmp_path, hoards):
    app = create_app(tmp_path / 'writer', port=5174)
    async with app.router.lifespan_context(app):
        async with client_for(app) as client:
            auth = {'Authorization': 'Bearer ' + app.state.token}
            listed = (await client.get('/api/agent/tools')).json()['tools']
            assert {'wh_publishing_external_hoards', 'wh_publishing_external_start'} <= {tool['name'] for tool in listed}
            for module in ('links', 'paperwork'):
                assert (await client.put('/api/modules/' + module, json={'enabled': True})).status_code == 200
            reply = await client.post('/api/agent/call', headers=auth, json={'name': 'list_links', 'arguments': {'limit': 2}})
            assert reply.status_code == 200 and reply.json()['tool'] == 'list_links'
            write = await client.post('/api/agent/call', headers=auth, json={'name': 'deadline_add', 'arguments': {'title': 'Synthetic', 'date': '2030-12-31'}})
            assert write.status_code == 200 and write.json()['reason'].startswith("Requested from Writer's Hoard (deadline_add")
            kept = await client.post('/api/agent/call', headers=auth, json={'name': 'deadline_add', 'arguments': {'title': 'Synthetic', 'date': '2030-12-31', 'reason': 'user asked for it'}})
            assert kept.json()['reason'] is None and kept.json()['arguments']['reason'] == 'user asked for it'
            found = (await client.post('/api/agent/call', headers=auth, json={'name': 'borges_search_all', 'arguments': {'q': 'synthetic'}})).json()
            assert [source['status'] for source in found['sources']] == ['module_disabled', 'ok', 'ok']
            status = (await client.post('/api/agent/call', headers=auth, json={'name': 'wh_publishing_external_hoards', 'arguments': {}})).json()
            assert [(item['app'], item['running'], item['version']) for item in status['hoards']] == [('links', True, '9.9'), ('kafka', True, '9.9')]
            assert sorted(host for host, _ in hoards['calls']) == ['kafka', 'kafka', 'kafka', 'links', 'links']
            for module in ('links', 'paperwork'):
                native = app.state.modules[module].app
                assert (await client.put('/api/modules/' + module, json={'enabled': False})).status_code == 200
                assert native.state.client.is_closed
    # Writer keeps only its own token per module; every record lives in the Hoards.
    for module in ('links', 'paperwork'):
        assert {p.name for p in (tmp_path / 'writer' / module).iterdir()} <= {'mcp-token', 'copilot-space-id'}


@pytest.mark.asyncio
async def test_binary_upload_file_stream_and_redirects_pass_through(tmp_path, hoards):
    app = create_app(tmp_path / 'writer', port=5174)
    async with app.router.lifespan_context(app):
        async with client_for(app) as client:
            assert (await client.put('/api/modules/paperwork', json={'enabled': True})).status_code == 200
            payload = bytes(range(256)) * 4096
            uploaded = await client.post('/paperwork/api/documents/upload', files={'files': ('synthetic.bin', payload, 'application/octet-stream')})
            assert uploaded.status_code == 200, uploaded.text
            assert payload in hoards['files']['d_1']
            streamed = await client.get('/paperwork/api/documents/d_1/file')
            assert streamed.status_code == 200 and streamed.content == hoards['files']['d_1']
            moved = await client.get('/paperwork/api/moved', follow_redirects=False)
            assert moved.status_code == 303 and moved.headers['location'] == '/paperwork/api/health'
            page = await client.get('/paperwork/', headers={'accept': 'text/html'}, follow_redirects=False)
            assert page.status_code == 307 and page.headers['location'] == 'http://kafka.test/'
            assert (await client.put('/api/modules/paperwork', json={'enabled': False})).status_code == 200


@pytest.mark.asyncio
async def test_offline_hoard_reports_state_and_starts_through_the_hub(tmp_path, hoards, monkeypatch):
    hoards['running']['links'] = False
    via_hub(monkeypatch, tmp_path, hoards)
    app = create_app(tmp_path / 'writer', port=5174)
    async with app.router.lifespan_context(app):
        async with client_for(app) as client:
            assert (await client.put('/api/modules/links', json={'enabled': True})).status_code == 200
            down = await client.get('/links/api/links')
            assert down.status_code == 503
            body = down.json()
            assert body['code'] == 'hoard_offline' and body['app'] == 'links' and body['start']['mcp'] == 'wh_publishing_external_start'
            state = (await client.get('/api/external/links')).json()
            assert state['running'] is False and state['can_start'] is True and state['source'] == 'hub'
            started = (await client.post('/api/external/links/start')).json()
            assert started['started'] is True and started['running'] is True and hoards['starts'] == ['links']
            again = (await client.post('/api/agent/call', headers={'Authorization': 'Bearer ' + app.state.token},
                                       json={'name': 'wh_publishing_external_start', 'arguments': {'module': 'links'}})).json()
            assert again['started'] is False and hoards['starts'] == ['links']
            assert (await client.get('/links/api/links')).status_code == 404  # reached the Hoard: its own answer
            bad = await client.post('/api/agent/call', headers={'Authorization': 'Bearer ' + app.state.token},
                                    json={'name': 'wh_publishing_external_start', 'arguments': {'module': 'library'}})
            assert bad.status_code == 400
            assert (await client.put('/api/modules/links', json={'enabled': False})).status_code == 200


def test_hub_down_falls_back_to_family_default(monkeypatch):
    for env in ('WRITER_LINKS_URL', 'WRITER_KAFKA_URL'):
        monkeypatch.delenv(env, raising=False)
    monkeypatch.setattr(external, 'HUB_URL', 'http://127.0.0.1:9')
    monkeypatch.setattr(httpx.Client, 'get', lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError('hub down (synthetic)')))
    where = external.target('paperwork', refresh=True)
    assert where['source'] == 'default' and where['url'] == 'http://127.0.0.1:5200'
    assert where['token_file'].endswith(os.path.join("Kafka's Hoard", 'data', 'mcp-token'))


@pytest.mark.asyncio
async def test_identity_and_local_token_survive_reopen(tmp_path, hoards):
    app = create_app(tmp_path / 'writer', port=5174)
    async with app.router.lifespan_context(app):
        async with client_for(app) as client:
            for module in ('links', 'paperwork'):
                assert (await client.put('/api/modules/' + module, json={'enabled': True})).status_code == 200
                identity = (await client.get('/api/writer-identity/' + module)).json()
                assert identity['app_id'] == ('links' if module == 'links' else 'kafka')
                token = (app.state.modules[module].data_dir / 'mcp-token').read_bytes()
                assert (await client.put('/api/modules/' + module, json={'enabled': False})).status_code == 200
                assert (await client.get(f'/{module}/api/health')).status_code == 409
                assert (await client.put('/api/modules/' + module, json={'enabled': True})).status_code == 200
                assert (await client.get('/api/writer-identity/' + module)).json() == identity
                assert (app.state.modules[module].data_dir / 'mcp-token').read_bytes() == token
                assert (await client.put('/api/modules/' + module, json={'enabled': False})).status_code == 200
