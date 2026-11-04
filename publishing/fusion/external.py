"""Links and Kafka are their own Hoards; Writer reaches them by reference.

The reading/links and paperwork modules no longer carry engine copies. When a
module is ON, Writer forwards its native API paths (``/links/api/...``,
``/paperwork/api/...``) to the running Links Hoard and Kafka's Hoard, located
through Hoard Hub's registry. A Hoard that is not running answers with a clear
``hoard_offline`` state and Writer offers to start it through the Hub.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from starlette.requests import Request

HUB_URL = os.environ.get('WRITER_HUB_URL', 'http://127.0.0.1:8810').rstrip('/')
FAMILY = Path(__file__).resolve().parents[3]
EXTERNAL = {
    'links': {'app': 'links', 'name': 'Links Hoard', 'port': 5181, 'folder': 'Links Hoard', 'env': 'WRITER_LINKS'},
    'paperwork': {'app': 'kafka', 'name': "Kafka's Hoard", 'port': 5200, 'folder': "Kafka's Hoard", 'env': 'WRITER_KAFKA'},
}
HOP = {'host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization',
       'proxy-connection', 'authorization', 'origin', 'referer', 'cookie'}
_registry: dict = {'at': 0.0, 'apps': None, 'error': ''}
TRANSPORT = None  # tests put an in-memory Hoard here; None is the real network


def _client(**options) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=TRANSPORT, trust_env=False, **options)


def _hub_apps(refresh: bool = False):
    """The Hub's app list, cached briefly; None when the Hub does not answer."""
    if not refresh and _registry['apps'] is not None and time.monotonic() - _registry['at'] < 15:
        return _registry['apps']
    try:
        with httpx.Client(timeout=2.5, trust_env=False) as client:
            apps = client.get(HUB_URL + '/api/apps').raise_for_status().json().get('apps') or []
        _registry.update(at=time.monotonic(), apps={a.get('id'): a for a in apps if isinstance(a, dict)}, error='')
    except Exception as exc:  # noqa: BLE001 - the Hub is optional; a fixed fallback follows
        _registry.update(at=time.monotonic(), apps=None, error=f'{type(exc).__name__}: {exc}')
    return _registry['apps']


def target(key: str, refresh: bool = False) -> dict:
    """Where the Hoard behind a Writer module lives: env override, Hub registry, then the family default."""
    spec = EXTERNAL[key]
    env = spec['env']
    if os.environ.get(env + '_URL'):
        return {'url': os.environ[env + '_URL'].rstrip('/'), 'token_file': os.environ.get(env + '_TOKEN_FILE', ''),
                'source': 'env', 'hub': None}
    apps = _hub_apps(refresh)
    app = (apps or {}).get(spec['app'])
    if app and app.get('url'):
        return {'url': str(app['url']).rstrip('/'), 'token_file': app.get('token_file') or '', 'source': 'hub',
                'hub': {'state': app.get('state') or '', 'manually_stopped': bool(app.get('manually_stopped'))}}
    return {'url': f"http://127.0.0.1:{spec['port']}", 'token_file': str(FAMILY / spec['folder'] / 'data' / 'mcp-token'),
            'source': 'default', 'hub': None}


def token(where: dict) -> str:
    try:
        return Path(os.path.expandvars(where['token_file'])).read_text(encoding='utf-8').strip() if where['token_file'] else ''
    except OSError:
        return ''


def with_reason(raw: bytes) -> bytes:
    """Kafka's Hoard journals every agent write with a reason (3-300 chars); Writer's tool schemas predate it."""
    try:
        payload = json.loads(raw or b'{}')
    except ValueError:
        return raw
    if not isinstance(payload, dict):
        return raw
    args = payload.get('arguments') if isinstance(payload.get('arguments'), dict) else {}
    if not str(payload.get('reason') or args.get('reason') or '').strip():
        payload['reason'] = f"Requested from Writer's Hoard ({str(payload.get('name') or 'tool')[:80]})"
    return json.dumps(payload, ensure_ascii=False).encode('utf-8')


def offline_body(key: str, where: dict, error: str = '') -> dict:
    name = EXTERNAL[key]['name']
    return {'error': f"{name} no está en marcha ({where['url']}). Arráncalo desde Writer o desde Hoard Hub",
            'code': 'hoard_offline', 'hint': f"Writer usa {name} como app propia de la familia Hoard; sus datos siguen en esa app.",
            'module': key, 'app': EXTERNAL[key]['app'], 'url': where['url'], 'detail': error,
            'start': {'rest': f'/api/external/{key}/start', 'mcp': 'wh_publishing_external_start'}}


async def status(key: str, refresh: bool = True) -> dict:
    """Connection state of one external Hoard; never starts anything."""
    spec = EXTERNAL[key]
    where = await asyncio.to_thread(target, key, refresh)
    out = {'module': key, 'app': spec['app'], 'name': spec['name'], 'url': where['url'], 'source': where['source'],
           'hub_url': HUB_URL, 'hub_reachable': _registry['apps'] is not None or where['source'] == 'env',
           'hub_state': (where['hub'] or {}).get('state', ''), 'token': bool(token(where)), 'running': False,
           'service': '', 'version': '', 'error': ''}
    try:
        async with _client(timeout=3.0) as client:
            health = (await client.get(where['url'] + '/api/health')).raise_for_status().json()
        out.update(running=True, service=str(health.get('service') or ''), version=str(health.get('version') or ''))
    except Exception as exc:  # noqa: BLE001
        out['error'] = f'{type(exc).__name__}: {exc}'
    out['can_start'] = not out['running'] and out['hub_reachable'] and where['source'] != 'env'
    return out


async def status_all() -> dict:
    items = await asyncio.gather(*(status(key) for key in EXTERNAL))
    return {'hoards': list(items), 'hub_url': HUB_URL,
            'note': 'Writer keeps its reading and paperwork views; the data and engines live in Links Hoard and Kafka\'s Hoard.'}


async def start(key: str, wait_s: float = 25.0) -> dict:
    """Ask Hoard Hub to start the Hoard, then wait until its health answers."""
    if key not in EXTERNAL:
        raise ValueError('Unknown external module: ' + str(key))
    current = await status(key)
    if current['running']:
        return {**current, 'started': False, 'message': f"{current['name']} ya estaba en marcha."}
    app = EXTERNAL[key]['app']
    try:
        async with _client(timeout=20.0) as client:
            reply = await client.post(f'{HUB_URL}/api/apps/{app}/start')
        hub = {'status': reply.status_code, 'body': reply.text[:400]}
    except Exception as exc:  # noqa: BLE001
        return {**current, 'started': False, 'message': f'Hoard Hub no responde en {HUB_URL}: abre Hoard Hub y vuelve a intentarlo.',
                'error': f'{type(exc).__name__}: {exc}'}
    deadline = time.monotonic() + max(1.0, min(90.0, float(wait_s)))
    while time.monotonic() < deadline:
        current = await status(key)
        if current['running']:
            return {**current, 'started': True, 'hub': hub, 'message': f"{current['name']} está en marcha."}
        await asyncio.sleep(0.75)
    return {**current, 'started': False, 'hub': hub, 'message': f"Hoard Hub recibió la orden pero {current['name']} aún no responde."}


def create_app(key: str, data_dir):
    """ASGI app for an ON module: every request goes to the running Hoard, streamed both ways."""
    from contextlib import asynccontextmanager
    from fastapi import FastAPI
    from starlette.background import BackgroundTask
    from starlette.responses import JSONResponse, RedirectResponse, StreamingResponse
    from .cleanup import Shutdown, close_client

    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    local_token = data_dir / 'mcp-token'
    if not local_token.exists():
        import secrets
        local_token.write_text(secrets.token_hex(32), encoding='utf-8')
    client = _client(follow_redirects=False,
                     timeout=httpx.Timeout(connect=3.0, read=None, write=None, pool=None))

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            await app.state.shutdown()

    app = FastAPI(lifespan=lifespan)
    app.state.client = client
    app.state.external = key

    async def close():
        await close_client(client)
    app.state.shutdown = Shutdown(close)

    @app.api_route('/{path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    async def forward(path: str, request: Request):
        where = await asyncio.to_thread(target, key)
        page = request.method == 'GET' and not path.startswith('api/') and (
            path in ('', 'index.html') or 'text/html' in request.headers.get('accept', ''))
        if page:  # the Hoard's own web app lives at its own address
            return RedirectResponse(where['url'] + '/' + path + (('?' + request.url.query) if request.url.query else ''), status_code=307)
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP}
        secret = await asyncio.to_thread(token, where)
        if secret:
            headers['authorization'] = 'Bearer ' + secret
        body = request.stream() if request.method not in ('GET', 'HEAD', 'OPTIONS') else None
        if key == 'paperwork' and request.method == 'POST' and path == 'api/agent/call':
            body = with_reason(await request.body())
            headers.pop('content-length', None)
        outgoing = client.build_request(request.method, where['url'] + '/' + path, params=request.url.query or None,
                                        headers=headers, content=body)
        try:
            upstream = await client.send(outgoing, stream=True)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            return JSONResponse(offline_body(key, where, f'{type(exc).__name__}: {exc}'), status_code=503)
        base = urlsplit(where['url'])
        out = []
        for name, value in upstream.headers.raw:
            name = name.lower()
            if name in (b'connection', b'keep-alive', b'transfer-encoding'):
                continue
            if name == b'location':
                place = urlsplit(value.decode('latin-1'))
                if place.netloc == base.netloc:
                    value = (place.path + (('?' + place.query) if place.query else '')).encode('latin-1')
            out.append((name, value))
        response = StreamingResponse(upstream.aiter_raw(), status_code=upstream.status_code, background=BackgroundTask(upstream.aclose))
        response.raw_headers = out
        return response

    return app


EXTERNAL_TOOLS = [
    {'name': 'wh_publishing_external_hoards',
     'description': "Connection state of Links Hoard and Kafka's Hoard, the apps behind Writer's reading/links and paperwork modules: "
                    'address, running, version and Hoard Hub state. Never starts anything. Estado de Links y Kafka.',
     'inputSchema': {'type': 'object', 'properties': {}},
     'annotations': {'readOnlyHint': True, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}},
    {'name': 'wh_publishing_external_start',
     'description': "Start Links Hoard (module links) or Kafka's Hoard (module paperwork) through Hoard Hub and wait until it answers. "
                    'Use when a reading or paperwork call reports hoard_offline. Arrancar Links o Kafka.',
     'inputSchema': {'type': 'object', 'properties': {'module': {'type': 'string', 'enum': list(EXTERNAL)},
                                                       'wait_s': {'type': 'number', 'minimum': 1, 'maximum': 90, 'default': 25}},
                     'required': ['module']},
     'annotations': {'readOnlyHint': False, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}},
]


async def external_call(name: str, args: dict) -> dict:
    if name == 'wh_publishing_external_hoards':
        return await status_all()
    module = str(args.get('module') or '')
    if module not in EXTERNAL:
        raise ValueError('module must be one of: ' + ', '.join(EXTERNAL))
    return await start(module, float(args.get('wait_s') or 25))
