"""Native cleanup checkpoints stay owned across failed shutdown attempts."""
import asyncio
import inspect
import threading
from .cancellation import join_tasks


async def owned(awaitable):
    task=asyncio.create_task(awaitable)
    try:return await asyncio.shield(task)
    except asyncio.CancelledError:
        await join_tasks([task])
        raise


async def invoke(callback):
    if inspect.iscoroutinefunction(callback):return await callback()
    result=await asyncio.to_thread(callback)
    if inspect.isawaitable(result):return await result


class Shutdown:
    def __init__(self,*steps):
        self.steps,self.completed=steps,0
        self.lock=asyncio.Lock()
    async def __call__(self):
        async with self.lock:
            while self.completed<len(self.steps):
                await invoke(self.steps[self.completed])
                self.completed+=1


async def close_client(client):
    """HTTPX marks CLOSED before transport cleanup; never use it as evidence.

    Own connections before HTTPcore empties its pool, then their transports.
    CLOSED flags and an emptied pool are not evidence of released resources.
    """
    shutdown=getattr(client,'_writer_shutdown',None)
    if shutdown is None:
        resources=[]
        for transport in (client._transport,*client._mounts.values()):
            if transport is None:continue
            for resource in (*getattr(getattr(transport,'_pool',None),'_connections',()),transport):
                if all(resource is not other for other in resources):resources.append(resource)
        shutdown=client._writer_shutdown=Shutdown(*(resource.aclose for resource in resources))
    await shutdown()
    client._state=type(client._state).CLOSED


def close_link(link):
    """Close the owned SDK twin without its swallowing/timeout close facade.

    SDK bytes remain unchanged. Do not clear loop/client ownership on failure.
    """
    sync=link.sync
    loop,thread,inner=sync._loop,sync._thread,sync._inner
    if thread is threading.current_thread():raise RuntimeError('Cannot close from the client loop thread')
    if loop is not None:
        if inner is not None and inner._owns_client:
            asyncio.run_coroutine_threadsafe(close_client(inner._client),loop).result()
        loop.call_soon_threadsafe(loop.stop)
    if thread is not None:thread.join()
    if loop is not None:loop.close()
    sync._loop=sync._thread=sync._inner=None
    if link._owns_client:asyncio.run(close_client(link._client))
