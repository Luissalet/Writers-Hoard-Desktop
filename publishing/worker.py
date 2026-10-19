"""Writer's library/reading/paperwork/editorial JSON-lines worker; no listener."""
from __future__ import annotations
import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit


async def stream_asgi(app, message, ident):
    """Forward native file/range response chunks without buffering the file."""
    url = urlsplit(message['path'])
    headers = {**message.get('headers', {}), 'host': '127.0.0.1:5174', 'authorization': 'Bearer ' + app.state.token}
    scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.4'}, 'http_version': '1.1',
             'scheme': 'http', 'method': message.get('method', 'GET'), 'path': url.path, 'raw_path': url.path.encode(),
             'query_string': url.query.encode(), 'root_path': '', 'headers': [(key.lower().encode(), value.encode()) for key, value in headers.items()],
             'client': ('127.0.0.1', 1), 'server': ('127.0.0.1', 5174)}
    received = False
    async def receive():
        nonlocal received
        if not received:
            received = True
            return {'type': 'http.request', 'body': b'', 'more_body': False}
        await asyncio.Event().wait()
    async def send(event):
        if event['type'] == 'http.response.start':
            payload = {'event': 'start', 'status': event['status'], 'headers': {key.decode(): value.decode() for key, value in event.get('headers', [])}}
        elif event['type'] == 'http.response.body':
            payload = {'event': 'chunk', 'base64': base64.b64encode(event.get('body', b'')).decode('ascii')}
        else:
            return
        print(json.dumps({'id': ident, **payload}), flush=True)
    await app(scope, receive, send)


async def serve():
    app = client = lifespan = None
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            message = json.loads(line)
            ident = message.get('id')
            try:
                op = message.get('op')
                if op == 'shutdown':
                    print(json.dumps({'id': ident, 'ok': True}), flush=True)
                    break
                if op == 'init':
                    if app is not None:
                        raise ValueError('already initialized')
                    import httpx
                    from fusion.app import create_app
                    app = create_app(Path(message['dataDir']), port=5174)
                    # Electron owns persistence and explicit activation. A worker restart
                    # must never resurrect modules from the former standalone shell.
                    for module in app.state.modules.values():
                        module.desired = module.automatic = False
                    lifespan = app.router.lifespan_context(app)
                    await lifespan.__aenter__()
                    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:5174')
                    result = {'pid': os.getpid()}
                elif op == 'set':
                    module = app.state.modules[message['module']]
                    automatic = bool(message.get('automatic', False))
                    if module.automatic != automatic and module.app is not None:
                        await module.set_enabled(False)
                    module.automatic = automatic
                    result = await module.set_enabled(message['enabled'])
                elif op == 'stream':
                    await stream_asgi(app, message, ident)
                    result = {'stream_done': True}
                else:
                    if client is None:
                        raise ValueError('not initialized')
                    headers = {**message.get('headers', {}), 'Authorization': 'Bearer ' + app.state.token}
                    response = await client.request(message.get('method', 'GET'), message['path'],
                        content=base64.b64decode(message.get('body', '')), headers=headers)
                    result = {'status': response.status_code, 'type': response.headers.get('content-type', 'application/octet-stream'),
                              'headers': dict(response.headers), 'base64': base64.b64encode(response.content).decode('ascii')}
                print(json.dumps({'id': ident, 'ok': True, 'result': result}, ensure_ascii=True), flush=True)
            except Exception as error:
                print(json.dumps({'id': ident, 'ok': False, 'error': f'{type(error).__name__}: {error}'}), flush=True)
    finally:
        if client:
            await client.aclose()
        if lifespan:
            await lifespan.__aexit__(None, None, None)


if __name__ == '__main__':
    # The incorporated media resolver invokes this owned Python runtime with
    # --version, -m and -c, including in frozen desktop builds. Without dispatch
    # a frozen worker would report a false successful CLI probe on stdin EOF.
    args = sys.argv[1:]
    if not args:
        asyncio.run(serve())
    elif args == ['--version']:
        import platform
        print('Python ' + platform.python_version())
    elif len(args) >= 2 and args[0] == '-m':
        import runpy
        sys.argv = args[1:]
        runpy.run_module(args[1], run_name='__main__', alter_sys=True)
    elif len(args) >= 2 and args[0] == '-c':
        sys.argv = args
        exec(args[1], {'__name__': '__main__'})
    else:
        raise SystemExit('Unsupported publishing worker runtime arguments')
