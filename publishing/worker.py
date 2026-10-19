"""Writer's library/reading/paperwork/editorial JSON-lines worker; no listener."""
from __future__ import annotations
import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit


def stdin_lines():
    """Never leave a synchronous Windows ReadFile pending during native DLL imports.

    OpenBLAS checks the inherited pipe with PeekNamedPipe while loading. Windows
    serializes that check behind a blocking read on the same handle. Read only
    the bytes already available, so native module activation can finish.
    """
    try:
        descriptor = sys.stdin.fileno()
    except (OSError, ValueError):
        # In-memory readers used by cold-discovery tests have no OS handle.
        async def in_memory():
            return sys.stdin.readline()
        return in_memory
    if sys.platform == 'win32':
        import ctypes
        import msvcrt
        from ctypes import wintypes
        read_file = ctypes.WinDLL('kernel32', use_last_error=True).ReadFile
        read_file.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                              ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
        read_file.restype = wintypes.BOOL
        peek = ctypes.WinDLL('kernel32', use_last_error=True).PeekNamedPipe
        peek.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, wintypes.LPVOID,
                         ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
        peek.restype = wintypes.BOOL
        handle = msvcrt.get_osfhandle(descriptor)

        def chunk():
            available = wintypes.DWORD()
            if not peek(handle, None, 0, None, ctypes.byref(available), None):
                error = ctypes.get_last_error()
                if error == 109:
                    return b''
                raise ctypes.WinError(error)
            if not available.value:
                return None
            buffer = ctypes.create_string_buffer(65536)
            count = wintypes.DWORD()
            if not read_file(handle, buffer, min(len(buffer), available.value), ctypes.byref(count), None):
                error = ctypes.get_last_error()
                if error == 109:  # ERROR_BROKEN_PIPE: parent closed its input.
                    return b''
                raise ctypes.WinError(error)
            return buffer.raw[:count.value]
    else:
        def chunk():
            return os.read(descriptor, 65536)

    pending = bytearray()
    async def line():
        while b'\n' not in pending:
            value = chunk() if sys.platform == 'win32' else await asyncio.to_thread(chunk)
            if value is None:
                await asyncio.sleep(0.01)
                continue
            if not value:
                value = bytes(pending)
                pending.clear()
                return value.decode('utf-8')
            pending.extend(value)
        value, _, remainder = pending.partition(b'\n')
        pending[:] = remainder
        return value.decode('utf-8')
    return line


async def stream_asgi(app, message, ident, credit):
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
            await credit.acquire()
            payload = {'event': 'chunk', 'base64': base64.b64encode(event.get('body', b'')).decode('ascii')}
        else:
            return
        print(json.dumps({'id': ident, **payload}), flush=True)
    await app(scope, receive, send)


async def serve(reader=None, app_factory=None):
    from fusion.cancellation import join_tasks
    app = client = lifespan = None
    lifespan_exited = False
    tasks, credits = {}, {}
    controls = asyncio.Lock()
    read_line = stdin_lines() if reader is None else None

    def reply(ident, **payload):
        print(json.dumps({'id': ident, **payload}, ensure_ascii=True), flush=True)

    async def handle(message):
        nonlocal app, client, lifespan
        ident = message.get('id')
        op = message.get('op')
        try:
            if op == 'init':
                async with controls:
                    if app is not None:
                        raise ValueError('already initialized')
                    import httpx
                    if app_factory is None:
                        from fusion.app import create_app
                        app = create_app(Path(message['dataDir']), port=5174)
                    else:
                        app = app_factory(Path(message['dataDir']))
                    for module in app.state.modules.values():
                        module.desired = module.automatic = False
                    lifespan = app.router.lifespan_context(app)
                    await lifespan.__aenter__()
                    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:5174')
                    result = {'pid': os.getpid()}
            elif op == 'set':
                async with controls:
                    if lifespan_exited and message['enabled']:
                        raise ValueError('Owner shutdown is pending; complete OFF before enabling another module')
                    module = app.state.modules[message['module']]
                    automatic = bool(message.get('automatic', False))
                    if module.automatic != automatic and module.app is not None:
                        await module.set_enabled(False)
                    module.automatic = automatic
                    result = await module.set_enabled(message['enabled'])
            elif op == 'cancel':
                target = tasks.get(message['target'])
                if target is not None:
                    await join_tasks([target], cancel=True)
                result = {'cancelled': message['target']}
            elif op == 'status':
                result = {'modules': [module.status() for module in app.state.modules.values()]}
            elif op == 'stream':
                await stream_asgi(app, message, ident, credits[ident])
                result = {'stream_done': True}
            else:
                if client is None:
                    raise ValueError('not initialized')
                headers = {**message.get('headers', {}), 'Authorization': 'Bearer ' + app.state.token}
                response = await client.request(message.get('method', 'GET'), message['path'],
                    content=base64.b64decode(message.get('body', '')), headers=headers)
                result = {'status': response.status_code, 'type': response.headers.get('content-type', 'application/octet-stream'),
                          'headers': dict(response.headers), 'base64': base64.b64encode(response.content).decode('ascii')}
            reply(ident, ok=True, result=result)
        except asyncio.CancelledError:
            # Acknowledge only after ASGI cancellation has unwound its owner/finally.
            reply(ident, ok=True, result={'stream_done': True, 'cancelled': True})
            raise
        except Exception as error:
            reply(ident, ok=False, error=f'{type(error).__name__}: {error}')
        finally:
            tasks.pop(ident, None)
            if op == 'stream':
                credits.pop(ident, None)

    async def read():
        return await reader() if reader else await read_line()

    async def drain():
        await join_tasks([tasks[ident] for ident in list(credits) if ident in tasks], cancel=True)
        await join_tasks(list(tasks.values()))

    async def close_host():
        nonlocal lifespan, lifespan_exited
        if lifespan is not None:
            if not lifespan_exited:
                lifespan_exited = True
                await lifespan.__aexit__(None, None, None)
            else:
                await app.state.shutdown()
            lifespan = None

    try:
        while line := await read():
            message = json.loads(line)
            op, ident = message.get('op'), message.get('id')
            if op == 'flow':
                if message['target'] in credits:
                    credits[message['target']].release()
                continue
            if op == 'shutdown':
                try:
                    await drain()
                    await close_host()
                except Exception as error:
                    reply(ident, ok=False, error=f'{type(error).__name__}: {error}')
                    continue
                if client:
                    await client.aclose()
                    client = None
                reply(ident, ok=True)
                break
            if op == 'stream':
                credits[ident] = asyncio.Semaphore(0)
            task = asyncio.create_task(handle(message))
            tasks[ident] = task
            # Init is the one ordering barrier; subsequent requests are independent.
            if op == 'init':
                await task
    finally:
        await drain()
        # EOF has no surviving caller to retry a temporarily failing cleanup.
        # Keep this owner alive and retry closure, never re-enter native work.
        while lifespan is not None:
            try:await close_host()
            except Exception:
                await asyncio.sleep(.25)
        if client:
            await client.aclose()


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
