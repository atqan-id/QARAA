"""Cancellation-safe WebSocket snapshot forwarding."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
import asyncio
from typing import Any


async def _send_snapshots(websocket: Any, client: Any, session_id: str, revision: int) -> None:
    async for snapshot in client.stream(session_id, last_snapshot_revision=revision):
        payload = snapshot.model_dump(mode="json", by_alias=True, exclude_unset=True)
        await websocket.send_json(payload)


async def _watch_downstream(websocket: Any) -> None:
    while True:
        message = await websocket.receive()
        if isinstance(message, dict) and message.get("type") == "websocket.disconnect":
            return


async def proxy_snapshot_stream(websocket: Any, client: Any, session_id: str, revision: int) -> None:
    """Forward snapshots until either peer completes, then cancel the other side."""
    await websocket.accept()
    tasks = {
        asyncio.create_task(_send_snapshots(websocket, client, session_id, revision)),
        asyncio.create_task(_watch_downstream(websocket)),
    }
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            error = task.exception()
            if error is not None:
                raise error
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
