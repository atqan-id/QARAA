# Licensed under the Apache License, Version 2.0.
import asyncio
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.proxy import proxy_snapshot_stream


class FakeClient:
    def __init__(self):
        self.closed = 0
        self.created = []

    async def create_session(self, corpus_id, **options):
        self.created.append((corpus_id, options))
        return FakeEvent({"protocolVersion": 1, "requestId": "r", "type": "session.created", "sessionId": "s", "snapshot": {"revision": 0}})

    async def close(self):
        self.closed += 1


class FakeEvent:
    def __init__(self, payload): self.payload = payload
    def model_dump(self, **_): return self.payload


def test_lifespan_builds_one_client_reuses_it_and_closes_once():
    clients = []
    def factory(_):
        client = FakeClient(); clients.append(client); return client

    with TestClient(create_app(client_factory=factory, server_url="https://qaraa.test")) as browser:
        first = browser.post("/qaraa/sessions", json={"corpusId": "minimal-quran"})
        second = browser.post("/qaraa/sessions", json={"corpusId": "minimal-quran", "findingMode": "off"})
        assert first.status_code == second.status_code == 201
        assert first.json()["sessionId"] == "s"
        assert len(clients) == 1
        assert clients[0].created == [
            ("minimal-quran", {"initial_location": None, "finding_mode": None}),
            ("minimal-quran", {"initial_location": None, "finding_mode": "off"}),
        ]
    assert clients[0].closed == 1


class PeerClosed(Exception): pass


class FakeWebSocket:
    def __init__(self): self.accepted = False; self.sent = []
    async def accept(self): self.accepted = True
    async def send_json(self, value): self.sent.append(value)
    async def receive(self): raise PeerClosed


class BlockingStream:
    def __init__(self): self.cancelled = asyncio.Event()
    def __aiter__(self): return self
    async def __anext__(self):
        try: await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set(); raise


class StreamingClient:
    def __init__(self): self.value = BlockingStream()
    def stream(self, *_args, **_kwargs): return self.value


@pytest.mark.asyncio
async def test_downstream_disconnect_cancels_upstream_forwarding():
    socket, client = FakeWebSocket(), StreamingClient()
    with pytest.raises(PeerClosed):
        await proxy_snapshot_stream(socket, client, "session-1", 7)
    assert socket.accepted
    assert client.value.cancelled.is_set()


class CancellingWebSocket(FakeWebSocket):
    async def receive(self):
        try: await asyncio.Event().wait()
        except asyncio.CancelledError: raise


class OneSnapshotStream:
    def __init__(self): self.done = False
    def __aiter__(self): return self
    async def __anext__(self):
        if self.done: raise StopAsyncIteration
        self.done = True
        return FakeEvent({"revision": 8})


class OneSnapshotClient:
    def stream(self, *_args, **_kwargs): return OneSnapshotStream()


@pytest.mark.asyncio
async def test_upstream_completion_cancels_downstream_receiver():
    socket = CancellingWebSocket()
    await proxy_snapshot_stream(socket, OneSnapshotClient(), "session-1", 7)
    assert socket.sent == [{"revision": 8}]


@pytest.mark.asyncio
async def test_proxy_never_swallows_caller_cancellation():
    socket, client = CancellingWebSocket(), StreamingClient()
    task = asyncio.create_task(proxy_snapshot_stream(socket, client, "session-1", 0))
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
