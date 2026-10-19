"""Real native owners survive two cleanup failures and close on the third OFF."""
import asyncio
import os
from pathlib import Path
import sys
import threading
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'publishing'))
os.environ['HOARD_EVENTS']='0'
os.environ['BORGES_EMBED']='none'


@pytest.mark.asyncio
@pytest.mark.parametrize('key',['library','links','paperwork','publishing'])
async def test_native_factories_retry_real_owned_resources(key,tmp_path,monkeypatch):
    from fusion.app import create_app
    app=create_app(tmp_path,port=5174)
    module=app.state.modules[key]
    await module.set_enabled(True)
    native=module.app
    attempts=0
    if key=='library':
        resource=native.state.services.db
        original=resource.close
        def close():
            nonlocal attempts
            attempts+=1
            if attempts<3:raise OSError('Retained native SQLite')
            original()
        monkeypatch.setattr(resource,'close',close)
        live=lambda:native.state.services._stop_completed<5
    elif key=='links':
        engine=native.state.engine
        process=engine.process
        original=engine.send
        async def send(message):
            nonlocal attempts
            if message.get('type')=='stop':
                attempts+=1
                if attempts<3:raise OSError('Retained native Node process')
            await original(message)
        monkeypatch.setattr(engine,'send',send)
        live=lambda:process.returncode is None
    elif key=='paperwork':
        llm=native.state.services.llm
        link=llm._get_link()
        loop=link.sync._ensure_loop()
        inner=link.sync._twin()
        transport=inner._client._transport
        original=transport.aclose
        released=False
        hold=threading.Event()
        entered=threading.Event()
        release=threading.Event()
        async def close():
            nonlocal attempts,released
            attempts+=1
            if attempts<3:raise OSError('Retained actual SDK twin/client')
            if hold.is_set():
                entered.set()
                await asyncio.to_thread(release.wait)
            await original()
            released=True
        monkeypatch.setattr(transport,'aclose',close)
        # Reproduce HTTPX's real early CLOSED transition INSIDE transport
        # cleanup, then demand two further failing OFFs and an effective third.
        poisoned=asyncio.run_coroutine_threadsafe(inner._client.aclose(),loop)
        with pytest.raises(OSError):poisoned.result()
        assert inner._client.is_closed and not released
        attempts=0
        live=lambda:link.sync._loop is loop and link.sync._thread.is_alive() and not released
    else:
        from gutenberg_hoard.engine_sessions import sessions
        await asyncio.to_thread(sessions.execute,[],session_id='synthetic-close')
        original=sessions._close_all
        async def close():
            nonlocal attempts
            attempts+=1
            if attempts<3:raise OSError('Retained actual editorial MCP session')
            await original()
        monkeypatch.setattr(sessions,'_close_all',close)
        live=lambda:bool(sessions._sessions) and sessions._thread.is_alive()
    for count in (1,2):
        with pytest.raises(OSError):await module.set_enabled(False)
        assert module.app is native and module.stopping and module.error and attempts==count and live()
        with pytest.raises(RuntimeError):await module.set_enabled(True)
        assert module.app is native and attempts==count
    if key=='paperwork':
        hold.set()
        closing=asyncio.create_task(module.set_enabled(False))
        assert await asyncio.to_thread(entered.wait,5)
        closing.cancel()
        await asyncio.sleep(.03)
        assert not closing.done() and module.app is native and live()
        release.set()
        with pytest.raises(asyncio.CancelledError):await closing
    else:
        await module.set_enabled(False)
    assert module.app is None and not module.stopping and not module.error and attempts==3 and not live()
    await module.set_enabled(False)
    assert attempts==3


@pytest.mark.asyncio
async def test_httpcore_pool_keeps_connections_until_physical_close():
    import httpx
    from httpcore import Origin
    from httpcore._async.connection import AsyncHTTPConnection
    from httpcore._async.http11 import AsyncHTTP11Connection
    from fusion.cleanup import close_client

    class Stream:
        attempts=0
        opened=True
        async def aclose(self):
            if not self.opened:return
            self.attempts+=1
            if self.attempts<3:raise OSError('Retained HTTPcore network stream')
            self.opened=False

    # Actual HTTPX transport, HTTPcore pool/HTTP connection/HTTP11 close path.
    # Only the network stream is synthetic: no socket or service is contacted.
    transport=httpx.AsyncHTTPTransport()
    client=httpx.AsyncClient(transport=transport,trust_env=False)
    origin=Origin(b'https',b'synthetic.invalid',443)
    stream=Stream()
    connection=AsyncHTTPConnection(origin)
    connection._connection=AsyncHTTP11Connection(origin,stream)
    transport._pool._connections.append(connection)
    for attempt in (1,2):
        with pytest.raises(OSError):await close_client(client)
        assert stream.opened and stream.attempts==attempt
        assert connection in transport._pool._connections
    await close_client(client)
    assert not stream.opened and stream.attempts==3
    assert not transport._pool._connections and client.is_closed
    await close_client(client)
    assert stream.attempts==3
