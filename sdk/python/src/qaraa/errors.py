"""Typed transport and protocol failures."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
from typing import Any
from .models import ErrorEnvelope

class QaraaError(Exception):
    def __init__(self, code: str, message: str, retryable: bool, details: dict[str, Any]):
        super().__init__(message); self.code = code; self.retryable = retryable; self.details = details

class InvalidCorpusError(QaraaError): pass
class InvalidObservationError(QaraaError): pass
class StaleRevisionError(QaraaError): pass
class UnsupportedProtocolError(QaraaError): pass
class SessionNotFoundError(QaraaError): pass
class InternalServerError(QaraaError): pass
class UnknownQaraaError(QaraaError): pass
class TransportError(Exception): pass

_ERRORS = {"INVALID_CORPUS": InvalidCorpusError, "INVALID_OBSERVATION": InvalidObservationError,
           "STALE_REVISION": StaleRevisionError, "UNSUPPORTED_PROTOCOL": UnsupportedProtocolError,
           "SESSION_NOT_FOUND": SessionNotFoundError, "INTERNAL_ERROR": InternalServerError}

def exception_from_envelope(envelope: ErrorEnvelope) -> QaraaError:
    return _ERRORS.get(envelope.code, UnknownQaraaError)(envelope.code, envelope.message, envelope.retryable, envelope.details)
