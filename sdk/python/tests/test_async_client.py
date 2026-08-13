# Licensed under the Apache License, Version 2.0.
import httpx
import asyncio
import pytest
from qaraa import AsyncQaraaClient, RecitationObservation, TransportError
from test_client import updated


@pytest.mark.asyncio
async def test_async_submit_and_close_ownership():
    calls = []
    async def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, json=updated("s"))
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    observation = RecitationObservation.model_validate({"observationId": "o", "sourceRevision": 0, "isFinal": True, "receivedAtMs": 1, "tokens": []})
    async with AsyncQaraaClient("https://e", http_client=http) as client:
        await client.submit_observation("s", observation)
    assert calls == ["/v1/sessions/s/observations"]
    assert not http.is_closed


@pytest.mark.asyncio
async def test_close_rejects_queued_retry_work():
    client = AsyncQaraaClient("https://e", http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda r: (_ for _ in ()).throw(httpx.ConnectError("x", request=r)))), sleep=lambda _: None)
    await client.close()
    with pytest.raises(TransportError, match="closed"):
        await client.get_snapshot("s")


@pytest.mark.asyncio
async def test_close_cancels_pending_retry_delay():
    sleeping=asyncio.Event()
    async def delay(_): sleeping.set();await asyncio.Event().wait()
    def fail(request): raise httpx.ConnectError('x',request=request)
    client=AsyncQaraaClient('https://e',http_client=httpx.AsyncClient(transport=httpx.MockTransport(fail)),sleep=delay)
    task=asyncio.create_task(client.get_snapshot('s'));await sleeping.wait();await client.close()
    with pytest.raises(TransportError,match='closed'): await task
