"""Bounded JSON codec for QARAA event envelopes."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
import json
from typing import Any
from pydantic import TypeAdapter, ValidationError
from .errors import TransportError
from .models import CommandEnvelope, ErrorEnvelope, QaraaEvent, QuranCorpus, ReadingSnapshot, RecitationObservation, SessionCreatedEvent, SessionDeletedEvent, SnapshotUpdatedEvent

MAX_MESSAGE_BYTES = 1024 * 1024
_EVENTS = {"session.created": SessionCreatedEvent, "snapshot.updated": SnapshotUpdatedEvent, "session.deleted": SessionDeletedEvent, "error": ErrorEnvelope}

def decode_event(value: bytes | str | dict[str, Any], *, max_bytes: int = MAX_MESSAGE_BYTES) -> QaraaEvent:
    if isinstance(value, bytes):
        if len(value) > max_bytes: raise TransportError("QARAA payload exceeds configured size limit")
        value = value.decode("utf-8")
    if isinstance(value, str):
        if len(value.encode()) > max_bytes: raise TransportError("QARAA payload exceeds configured size limit")
        try: value = json.loads(value)
        except (ValueError, UnicodeError, RecursionError) as error: raise TransportError("QARAA payload is not valid JSON") from error
    if not isinstance(value, dict) or value.get("type") not in _EVENTS: raise TransportError("QARAA payload is not a recognized event")
    try: return _EVENTS[value["type"]].model_validate(value)
    except ValidationError as error: raise TransportError("QARAA payload failed protocol validation") from error

def encode_message(value: Any, *, max_bytes: int = MAX_MESSAGE_BYTES) -> bytes:
    if hasattr(value, "model_dump"): value = value.model_dump(by_alias=True, exclude_none=False)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    if len(encoded) > max_bytes: raise TransportError("QARAA payload exceeds configured size limit")
    return encoded

def decode_message(value: bytes | str | dict[str, Any], schema: str):
    if schema == "event": return decode_event(value)
    if schema == "error":
        event=decode_event(value)
        if not isinstance(event,ErrorEnvelope): raise TransportError("QARAA payload is not an error envelope")
        return event
    if isinstance(value, (bytes, str)):
        try: value = json.loads(value)
        except (ValueError, UnicodeError, RecursionError) as error: raise TransportError("QARAA payload is not valid JSON") from error
    models = {"corpus": QuranCorpus, "observation": RecitationObservation, "snapshot": ReadingSnapshot, "command": CommandEnvelope}
    if schema not in models: raise ValueError(f"unknown schema {schema}")
    try: return models[schema].model_validate(value)
    except ValidationError as error: raise TransportError("QARAA payload failed protocol validation") from error
