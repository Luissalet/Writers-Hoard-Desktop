"""Actual worker/runtime with inert ASGI owners; no engines, listeners or models."""
import asyncio
from pathlib import Path
import sys
from contextlib import asynccontextmanager

OWNER = Path(__file__).resolve().parents[2] / 'publishing'
sys.path.insert(0, str(OWNER))
from fastapi import FastAPI
from starlette.responses import Response
from fusion.runtime import create_runtime
from worker import serve


def app_factory(data_dir):
    def factory(key, module_dir, automatic):
        @asynccontextmanager
        async def lifespan(app):
            yield
            if key == 'paperwork':
                assert not app.state.active
                if (data_dir / 'hold-shutdown').exists():
                    (data_dir / 'shutdown-entered').write_text('waiting', encoding='utf-8')
                    while not (data_dir / 'release-shutdown').exists():
                        await asyncio.sleep(0.01)
        app = FastAPI(lifespan=lifespan)
        app.state.active = False

        class Retained(Response):
            async def __call__(self, scope, receive, send):
                app.state.active = True
                try:
                    await send({'type': 'http.response.start', 'status': 206, 'headers': [(b'content-type', b'application/octet-stream'), (b'content-range', b'bytes 1-3/4')]})
                    await send({'type': 'http.response.body', 'body': b'abc', 'more_body': True})
                    await asyncio.Event().wait()
                finally:
                    app.state.active = False
                    (data_dir / 'cancelled.txt').write_text('ASGI finally completed', encoding='utf-8')

        @app.get('/retained')
        async def retained():
            return Retained()

        @app.get('/api/health')
        async def health():
            return {'ok': True, 'module': key}
        return app

    specs = [{'id': key, 'name': key} for key in ('library', 'paperwork')]
    return create_runtime(name='Synthetic Writer', product='borges', root=OWNER / 'fusion', data_dir=data_dir,
                          specs=specs, factory=factory, port=5174)


asyncio.run(serve(app_factory=app_factory))
