"""CAS2 regression: concurrent causes must all await the same retained finally."""
import asyncio
import contextlib
import io
import json
from pathlib import Path
import sys
from contextlib import asynccontextmanager

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'publishing'))
from fastapi import FastAPI
from starlette.responses import Response
from fusion.runtime import create_runtime
from worker import serve


@pytest.mark.parametrize('cause', ['off', 'shutdown', 'eof'])
def test_shared_cancel_waits_for_asynchronous_finally(tmp_path, cause):
    async def scenario():
        commands = asyncio.Queue()
        started, cleaning, release = (asyncio.Event() for _ in range(3))
        observed = []
        state = {'cleanup_count':0, 'owner_closed':False}
        holder = {}
        output = io.StringIO()

        def app_factory(data_dir):
            def factory(key, module_dir, automatic):
                @asynccontextmanager
                async def lifetime(app):
                    yield
                    assert state['cleanup_count'] == 1
                    state['owner_closed'] = True
                app = FastAPI(lifespan=lifetime)
                class Retained(Response):
                    async def __call__(self, scope, receive, send):
                        try:
                            await send({'type':'http.response.start','status':200,'headers':[(b'content-type',b'text/event-stream')]})
                            started.set()
                            await asyncio.Event().wait()
                        finally:
                            cleaning.set()
                            await release.wait()
                            state['cleanup_count'] += 1
                @app.get('/retained')
                async def retained():
                    return Retained()
                return app
            app = create_runtime(name='Synthetic', product='borges', root=ROOT / 'publishing/fusion',
                                 data_dir=data_dir, specs=[{'id':'paperwork','name':'paperwork'}],factory=factory,port=5174)
            holder['app'] = app
            return app

        async def read():
            line = await commands.get()
            observed.append(json.loads(line).get('id') if line else 'eof')
            return line

        async def send(**message):
            await commands.put(json.dumps(message))

        def replies():
            return [json.loads(line) for line in output.getvalue().splitlines()]

        async def wait(predicate):
            async with asyncio.timeout(5):
                while not predicate():
                    await asyncio.sleep(0)

        async def reply(ident):
            await wait(lambda:any(r.get('id')==ident and 'ok' in r for r in replies()))

        with contextlib.redirect_stdout(output):
            server = asyncio.create_task(serve(reader=read, app_factory=app_factory))
            try:
                await send(id=1,op='init',dataDir=str(tmp_path))
                await reply(1)
                await send(id=2,op='set',module='paperwork',enabled=True)
                await reply(2)
                await send(id=3,op='stream',path='/paperwork/retained',method='GET')
                await started.wait()
                await send(id=4,op='cancel',target=3)
                await cleaning.wait()
                await send(id=5,op='cancel',target=3)
                if cause=='off':
                    await send(id=6,op='set',module='paperwork',enabled=False)
                    await wait(lambda:holder['app'].state.modules['paperwork'].stopping or any(r.get('id')==6 for r in replies()))
                    assert holder['app'].state.modules['paperwork'].stopping, (state, output.getvalue())
                elif cause=='shutdown':
                    await send(id=6,op='shutdown')
                    await wait(lambda:6 in observed)
                else:
                    await commands.put('')
                    await wait(lambda:'eof' in observed)
                for _ in range(3):
                    await asyncio.sleep(0)
                assert not any(r.get('id') in (3,4,5,6) and 'ok' in r for r in replies())
                assert state=={'cleanup_count':0,'owner_closed':False}
                assert not server.done()
                release.set()
                if cause=='off':
                    await reply(6)
                    assert state=={'cleanup_count':1,'owner_closed':True}
                    await send(id=7,op='set',module='paperwork',enabled=True)
                    await reply(7)
                    await send(id=8,op='set',module='paperwork',enabled=False)
                    await reply(8)
                    await commands.put('')
                await asyncio.wait_for(server,5)
                assert state['cleanup_count']==1 and state['owner_closed']
            finally:
                release.set()
                if not server.done():
                    await commands.put('')
                    await asyncio.wait_for(server,5)
    asyncio.run(scenario())


def test_cancelled_waiter_cannot_cancel_cleanup():
    from fusion.cancellation import join_tasks
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        async def target():
            try:
                await asyncio.Event().wait()
            finally:
                entered.set()
                await release.wait()
        task = asyncio.create_task(target())
        await asyncio.sleep(0)
        first = asyncio.create_task(join_tasks([task],cancel=True))
        await entered.wait()
        first.cancel()
        second = asyncio.create_task(join_tasks([task],cancel=True))
        await asyncio.sleep(0)
        assert not task.done() and task.cancelling()==1 and not first.done() and not second.done()
        release.set()
        await asyncio.gather(first,second,return_exceptions=True)
        assert task.done()
    asyncio.run(scenario())
