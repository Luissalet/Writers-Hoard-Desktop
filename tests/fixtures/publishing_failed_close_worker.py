"""Real worker and four native factories; fail each shutdown twice before closing."""
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'publishing'))
os.environ['HOARD_EVENTS']='0'
os.environ['BORGES_EMBED']='none'
import httpx
from fusion.app import create_app
from worker import serve

def blocked(*a,**kw):raise AssertionError('No live HTTP in native failed-close fixture')
httpx.HTTPTransport.handle_request=blocked
httpx.AsyncHTTPTransport.handle_async_request=blocked

def factory(data_dir):
    app=create_app(data_dir,port=5174)
    for key,module in app.state.modules.items():
        create=module.factory
        def create_native(name,path,automatic,create=create,key=key):
            native=create(name,path,automatic)
            lifetime=native.router.lifespan_context
            @asynccontextmanager
            async def retained(application):
                async with lifetime(application):
                    shutdown=application.state.shutdown
                    attempts=0
                    async def close():
                        nonlocal attempts
                        attempts+=1
                        marker=data_dir/(key+'-close.json')
                        marker.write_text(json.dumps({'attempts':attempts,'closed':False}),encoding='utf8')
                        if attempts<3:raise OSError('Synthetic transient failure before real native shutdown')
                        await shutdown()
                        marker.write_text(json.dumps({'attempts':attempts,'closed':True}),encoding='utf8')
                    application.state.shutdown=close
                    yield
            native.router.lifespan_context=retained
            return native
        module.factory=create_native
    return app

asyncio.run(serve(app_factory=factory))
