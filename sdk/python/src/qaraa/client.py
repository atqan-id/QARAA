"""Synchronous QARAA protocol-v1 client."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
import time
import uuid
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import quote
import httpx
from .codec import MAX_MESSAGE_BYTES, decode_event, encode_message
from .errors import TransportError, exception_from_envelope
from .models import ErrorEnvelope, QuranLocation, ReadingSnapshot, RecitationObservation, SessionCreatedEvent, SessionDeletedEvent, SnapshotUpdatedEvent

def _base_url(value: str) -> str:
    value = value.rstrip("/")
    if not value.startswith(("http://", "https://")): raise ValueError("base_url must use http or https")
    return value

def _session_path(session_id: str, suffix: str = "") -> str:
    if not session_id.strip(): raise ValueError("session_id must be non-empty")
    return f"/v1/sessions/{quote(session_id, safe='')}{suffix}"

def _command(request_id: str, type_: str, **values: Any) -> dict[str, Any]:
    return {"protocolVersion": 1, "requestId": request_id, "type": type_, **values}

class QaraaClient:
    def __init__(self, base_url: str, *, http_client: httpx.Client | None = None,
                 timeout: float = 10, headers: Mapping[str, str] | None = None,
                 max_attempts: int = 3, sleep: Callable[[float], None] = time.sleep,
                 request_id: Callable[[], str] = lambda: str(uuid.uuid4()),
                 max_response_bytes: int = MAX_MESSAGE_BYTES):
        if max_attempts < 1: raise ValueError("max_attempts must be positive")
        if max_response_bytes < 1: raise ValueError("max_response_bytes must be positive")
        self._base_url, self._timeout, self._headers = _base_url(base_url), timeout, dict(headers or {})
        self._http = http_client or httpx.Client(); self._owns_http = http_client is None
        self._attempts, self._sleep, self._request_id = max_attempts, sleep, request_id
        self._limit, self._closed = max_response_bytes, False

    def _assert_open(self):
        if self._closed: raise TransportError("QARAA client is closed")

    def _request(self, method: str, path: str, *, payload: dict[str, Any] | None = None,
                 params: dict[str, Any] | None = None, retry: bool = False):
        self._assert_open()
        body = encode_message(payload, max_bytes=self._limit) if payload is not None else None
        headers = {"accept": "application/json", "x-qaraa-protocol-version": "1", **self._headers}
        if body is not None: headers["content-type"] = "application/json"
        for attempt in range(1, self._attempts + 1):
            self._assert_open()
            request = self._http.build_request(method, self._base_url + path, headers=headers, params=params, content=body, timeout=self._timeout)
            response = None
            try:
                response = self._http.send(request, stream=True)
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > self._limit: raise TransportError("QARAA response exceeds configured size limit")
                    chunks.append(chunk)
                event = decode_event(b"".join(chunks), max_bytes=self._limit)
            except TransportError:
                raise
            except (httpx.TransportError, httpx.TimeoutException) as error:
                if not retry or attempt == self._attempts: raise TransportError("QARAA transport request failed") from error
                self._sleep(min(.1 * 2 ** (attempt - 1), 2)); continue
            finally:
                if response is not None: response.close()
            if isinstance(event, ErrorEnvelope):
                error = exception_from_envelope(event)
                if retry and error.retryable and attempt < self._attempts:
                    self._sleep(min(.1 * 2 ** (attempt - 1), 2)); continue
                raise error
            return event
        raise TransportError("QARAA retry limit exhausted")

    def create_session(self, corpus_id: str, *, initial_location: QuranLocation | None = None, finding_mode: str | None = None) -> SessionCreatedEvent:
        values: dict[str, Any] = {"corpusId": corpus_id}
        if initial_location is not None: values["initialLocation"] = initial_location.model_dump(by_alias=True)
        if finding_mode is not None: values["findingMode"] = finding_mode
        event = self._request("POST", "/v1/sessions", payload=_command(self._request_id(), "session.create", **values))
        if not isinstance(event, SessionCreatedEvent): raise TransportError("QARAA create returned an unexpected event")
        return event

    def get_snapshot(self, session_id: str) -> ReadingSnapshot:
        event = self._request("GET", _session_path(session_id), params={"protocolVersion": 1, "requestId": self._request_id()}, retry=True)
        if not isinstance(event, SnapshotUpdatedEvent) or event.session_id != session_id: raise TransportError("QARAA get returned an unexpected event")
        return event.snapshot

    def submit_observation(self, session_id: str, observation: RecitationObservation) -> ReadingSnapshot:
        payload = _command(self._request_id(), "observation.submit", sessionId=session_id, **observation.model_dump(by_alias=True, exclude_none=True))
        event = self._request("POST", _session_path(session_id, "/observations"), payload=payload, retry=True)
        if not isinstance(event, SnapshotUpdatedEvent) or event.session_id != session_id: raise TransportError("QARAA submit returned an unexpected event")
        return event.snapshot

    def reset_session(self, session_id: str, location: QuranLocation | None = None) -> ReadingSnapshot:
        values: dict[str, Any] = {"sessionId": session_id}
        if location is not None: values["location"] = location.model_dump(by_alias=True)
        event = self._request("POST", _session_path(session_id, "/reset"), payload=_command(self._request_id(), "session.reset", **values))
        if not isinstance(event, SnapshotUpdatedEvent) or event.session_id != session_id: raise TransportError("QARAA reset returned an unexpected event")
        return event.snapshot

    def delete_session(self, session_id: str) -> None:
        event = self._request("DELETE", _session_path(session_id), params={"protocolVersion": 1, "requestId": self._request_id()})
        if not isinstance(event, SessionDeletedEvent) or event.session_id != session_id: raise TransportError("QARAA delete returned an unexpected event")

    def close(self):
        if self._closed: return
        self._closed = True
        if self._owns_http: self._http.close()

    def __enter__(self): self._assert_open(); return self
    def __exit__(self, *_): self.close()
