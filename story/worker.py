"""Private Writer fiction worker. JSON lines on stdin/stdout, with no socket.

Each request finishes before the next is read. EOF closes SQLite and HTTP clients.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from pathlib import Path

import httpx

from writer_story.api import create_app


async def main():
    app = None
    client = None
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            message = json.loads(line)
            ident = message.get("id")
            try:
                if message.get("op") == "shutdown":
                    print(json.dumps({"id": ident, "ok": True}), flush=True)
                    break
                if message.get("op") == "init":
                    if app is not None:
                        raise ValueError("already initialized")
                    app = create_app(Path(message["dataDir"]))
                    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8816")
                    result = {"ok": True, "pid": os.getpid()}
                else:
                    if client is None:
                        raise ValueError("not initialized")
                    os.environ["WRITER_STORY_NARRATION"] = "1" if message.get("narration") else "0"
                    headers = {"X-Hoard-Client": "ui"} if message.get("ui") else {
                        "Authorization": "Bearer " + (app.state.data_dir / "mcp-token").read_text(encoding="utf-8").strip()
                    }
                    response = await client.request(message.get("method", "GET"), message["path"],
                        content=base64.b64decode(message.get("body", "")), headers={**headers, "Content-Type": "application/json"})
                    result = {"status": response.status_code, "type": response.headers.get("content-type", "application/octet-stream"),
                              "base64": base64.b64encode(response.content).decode("ascii")}
                print(json.dumps({"id": ident, "ok": True, "result": result}, ensure_ascii=True), flush=True)
            except Exception as error:
                print(json.dumps({"id": ident, "ok": False, "error": str(error)}), flush=True)
    finally:
        if client is not None:
            await client.aclose()
        if app is not None:
            await app.state.link.aclose()
            app.state.conn.close()


if __name__ == "__main__":
    asyncio.run(main())
