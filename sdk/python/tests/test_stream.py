# Licensed under the Apache License, Version 2.0.
import json
import asyncio
import pytest
from qaraa import AsyncQaraaClient
from test_client import SNAPSHOT


class Socket:
    def __init__(self, frames): self.frames, self.closed = iter(frames), False
    def __aiter__(self): return self
    async def __anext__(self):
        try: return next(self.frames)
        except StopIteration: raise StopAsyncIteration
    async def close(self): self.closed = True


@pytest.mark.asyncio
async def test_stream_deduplicates_resumes_and_honors_size_limit():
    urls, sockets = [], []
    def frame(revision):
        snapshot = {**SNAPSHOT, "revision": revision}
        return json.dumps({"protocolVersion": 1, "requestId": "r", "type": "snapshot.updated", "sessionId": "a/b", "snapshot": snapshot})
    batches = [[frame(2), frame(2)], [frame(1), frame(3)]]
    async def connect(url, **kwargs):
        urls.append((url, kwargs)); socket = Socket(batches.pop(0)); sockets.append(socket); return socket
    client = AsyncQaraaClient("https://e", websocket_connect=connect, sleep=lambda _: None)
    stream = client.stream("a/b", last_snapshot_revision=1)
    revisions = []
    async for snapshot in stream:
        revisions.append(snapshot.revision)
        if len(revisions) == 2: break
    await stream.aclose()
    assert revisions == [2, 3]
    assert "lastSnapshotRevision=2" in urls[1][0]
    assert urls[0][1]["max_size"] == 1024 * 1024
    await client.close()


@pytest.mark.asyncio
async def test_stream_rejects_non_json_safe_resume_revision():
    client = AsyncQaraaClient("https://example.test")
    with pytest.raises(ValueError, match="safe integer"):
        client.stream("s", last_snapshot_revision=9007199254740992)
    await client.close()


@pytest.mark.asyncio
async def test_close_while_connector_is_blocked_closes_stale_socket():
    connector_started = asyncio.Event()
    connector_release = asyncio.Event()
    stale = Socket([json.dumps({"ignored": True})])
    retries = 0

    async def blocked_connector(*_args, **_kwargs):
        connector_started.set()
        await connector_release.wait()
        return stale

    async def retry_sleep(_delay):
        nonlocal retries
        retries += 1

    client = AsyncQaraaClient(
        "https://e", websocket_connect=blocked_connector, sleep=retry_sleep
    )
    stream = client.stream("s")
    pending = asyncio.create_task(anext(stream))
    await connector_started.wait()
    await stream.aclose()
    connector_release.set()

    with pytest.raises(StopAsyncIteration):
        await pending
    assert stale.closed
    assert retries == 0
    await client.close()
