"""Asynchronous REST and WebSocket QARAA client."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
import asyncio, inspect, uuid, weakref
from collections.abc import Awaitable, Callable, Mapping
from typing import Any
import httpx
from .client import _base_url, _command, _session_path
from .codec import MAX_MESSAGE_BYTES, decode_event, encode_message
from .errors import TransportError, exception_from_envelope
from .models import ErrorEnvelope, QuranLocation, RecitationObservation, SessionCreatedEvent, SessionDeletedEvent, SnapshotUpdatedEvent

async def _default_sleep(delay: float): await asyncio.sleep(delay)

class AsyncQaraaClient:
    def __init__(self, base_url: str, *, http_client: httpx.AsyncClient | None = None,
                 websocket_connect: Callable[..., Awaitable[Any]] | None = None,
                 timeout: float = 10, headers: Mapping[str, str] | None = None,
                 max_attempts: int = 3, sleep: Callable[[float], Awaitable[None] | None] = _default_sleep,
                 request_id: Callable[[], str] = lambda: str(uuid.uuid4()), max_response_bytes: int = MAX_MESSAGE_BYTES):
        if max_attempts < 1 or max_response_bytes < 1: raise ValueError("limits must be positive")
        self._base_url, self._http = _base_url(base_url), http_client or httpx.AsyncClient()
        self._owns_http, self._connect, self._timeout = http_client is None, websocket_connect, timeout
        self._headers, self._attempts, self._sleep, self._request_id = dict(headers or {}), max_attempts, sleep, request_id
        self._limit, self._closed, self._streams = max_response_bytes, False, weakref.WeakSet()
        self._closed_event = asyncio.Event()

    def _assert_open(self):
        if self._closed: raise TransportError("QARAA client is closed")
    async def _delay(self, seconds):
        result = self._sleep(seconds)
        if inspect.isawaitable(result):
            sleeper = asyncio.ensure_future(result)
            closed = asyncio.create_task(self._closed_event.wait())
            done, pending = await asyncio.wait((sleeper, closed), return_when=asyncio.FIRST_COMPLETED)
            for task in pending: task.cancel()
            if closed in done: raise TransportError("QARAA client is closed")
        self._assert_open()
    async def _request(self, method, path, *, payload=None, params=None, retry=False):
        self._assert_open(); body = encode_message(payload, max_bytes=self._limit) if payload is not None else None
        headers = {"accept":"application/json", "x-qaraa-protocol-version":"1", **self._headers}
        if body is not None: headers["content-type"] = "application/json"
        for attempt in range(1, self._attempts + 1):
            self._assert_open(); response = None
            try:
                request = self._http.build_request(method, self._base_url + path, headers=headers, params=params, content=body, timeout=self._timeout)
                response = await self._http.send(request, stream=True); chunks=[]; size=0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > self._limit: raise TransportError("QARAA response exceeds configured size limit")
                    chunks.append(chunk)
                event = decode_event(b"".join(chunks), max_bytes=self._limit)
            except TransportError: raise
            except (httpx.TransportError, httpx.TimeoutException) as error:
                if not retry or attempt == self._attempts: raise TransportError("QARAA transport request failed") from error
                await self._delay(min(.1 * 2 ** (attempt-1), 2)); continue
            finally:
                if response is not None: await response.aclose()
            if isinstance(event, ErrorEnvelope):
                error = exception_from_envelope(event)
                if retry and error.retryable and attempt < self._attempts: await self._delay(min(.1 * 2 ** (attempt-1),2)); continue
                raise error
            return event
        raise TransportError("QARAA retry limit exhausted")

    async def create_session(self, corpus_id, *, initial_location=None, finding_mode=None):
        values={"corpusId":corpus_id}
        if initial_location is not None: values["initialLocation"] = initial_location.model_dump(by_alias=True)
        if finding_mode is not None: values["findingMode"] = finding_mode
        event=await self._request("POST","/v1/sessions",payload=_command(self._request_id(),"session.create",**values))
        if not isinstance(event,SessionCreatedEvent): raise TransportError("QARAA create returned an unexpected event")
        return event
    async def get_snapshot(self, session_id):
        event=await self._request("GET",_session_path(session_id),params={"protocolVersion":1,"requestId":self._request_id()},retry=True)
        if not isinstance(event,SnapshotUpdatedEvent) or event.session_id != session_id: raise TransportError("QARAA get returned an unexpected event")
        return event.snapshot
    async def submit_observation(self, session_id, observation: RecitationObservation):
        payload=_command(self._request_id(),"observation.submit",sessionId=session_id,**observation.model_dump(by_alias=True,exclude_none=True))
        event=await self._request("POST",_session_path(session_id,"/observations"),payload=payload,retry=True)
        if not isinstance(event,SnapshotUpdatedEvent) or event.session_id != session_id: raise TransportError("QARAA submit returned an unexpected event")
        return event.snapshot
    async def reset_session(self, session_id, location: QuranLocation|None=None):
        values={"sessionId":session_id}
        if location is not None: values["location"]=location.model_dump(by_alias=True)
        event=await self._request("POST",_session_path(session_id,"/reset"),payload=_command(self._request_id(),"session.reset",**values))
        if not isinstance(event,SnapshotUpdatedEvent) or event.session_id != session_id: raise TransportError("QARAA reset returned an unexpected event")
        return event.snapshot
    async def delete_session(self, session_id):
        event=await self._request("DELETE",_session_path(session_id),params={"protocolVersion":1,"requestId":self._request_id()})
        if not isinstance(event,SessionDeletedEvent) or event.session_id != session_id: raise TransportError("QARAA delete returned an unexpected event")
    def stream(self, session_id, *, last_snapshot_revision=0):
        from .stream import QaraaSnapshotStream
        self._assert_open(); stream=QaraaSnapshotStream(self,session_id,last_snapshot_revision); self._streams.add(stream); return stream
    async def close(self):
        if self._closed:return
        self._closed=True
        self._closed_event.set()
        await asyncio.gather(*(stream.aclose() for stream in list(self._streams)),return_exceptions=True)
        if self._owns_http: await self._http.aclose()
    async def __aenter__(self): self._assert_open(); return self
    async def __aexit__(self,*_): await self.close()
