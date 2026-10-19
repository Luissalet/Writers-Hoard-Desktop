"""Cancel once per owner task and shield every join until its cleanup finishes."""
import asyncio
import anyio


async def join_tasks(tasks, *, cancel=False):
    owned = list(dict.fromkeys(tasks))
    if cancel:
        for task in owned:
            if not task.done() and not task.cancelling():
                task.cancel()
    joined = asyncio.gather(*owned, return_exceptions=True)
    interrupted = False
    with anyio.CancelScope(shield=True):
        while True:
            try:
                result = await asyncio.shield(joined)
                break
            except asyncio.CancelledError:
                # A cancelled waiter cannot inject another cancellation into an
                # upstream that is already awaiting its asynchronous finally.
                interrupted = True
    if interrupted:
        raise asyncio.CancelledError
    return result
