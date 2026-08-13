"""Immutable, additive-compatible QARAA protocol-v1 models."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
import math
from typing import Annotated, Any, Literal
from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StrictBool, StrictInt, model_validator

Revision = Annotated[StrictInt, Field(ge=0)]
PositiveInt = Annotated[StrictInt, Field(ge=1)]
def _not_boolean(value):
    if isinstance(value, bool): raise ValueError("boolean is not a JSON number")
    return value
ProtocolFloat = Annotated[float, BeforeValidator(_not_boolean)]
UnitFloat = Annotated[ProtocolFloat, Field(ge=0, le=1)]
def _non_blank(value: str) -> str:
    if not value.strip(): raise ValueError("string must not be blank")
    return value
NonBlankString = Annotated[str, Field(min_length=1), AfterValidator(_non_blank)]


class WireModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow", populate_by_name=True)

    @model_validator(mode="after")
    def validate_extensions(self):
        for value in (self.__pydantic_extra__ or {}).values(): _safe_json(value)
        return self

def _safe_json(value, depth=0):
    if depth > 64: raise ValueError("extension JSON nesting exceeds 64")
    if value is None or isinstance(value, (bool, str)): return
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > 9007199254740991: raise ValueError("extension integer exceeds JSON safe range")
        return
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError("extension number must be finite")
        return
    if isinstance(value, list):
        for item in value: _safe_json(item, depth+1)
        return
    if isinstance(value, dict) and all(isinstance(key,str) for key in value):
        for item in value.values(): _safe_json(item, depth+1)
        return
    raise ValueError("extension value must be JSON-safe")


class QuranLocation(WireModel):
    surah: PositiveInt; ayah: PositiveInt; word: PositiveInt; symbol: PositiveInt


class ObservationToken(WireModel):
    id: Annotated[str, Field(min_length=1)]
    text: str
    phonemes: tuple[str, ...]
    start_ms: Annotated[ProtocolFloat, Field(ge=0)] | None = Field(None, alias="startMs")
    end_ms: Annotated[ProtocolFloat, Field(ge=0)] | None = Field(None, alias="endMs")
    confidence: UnitFloat | None = None


class RecitationObservation(WireModel):
    observation_id: NonBlankString = Field(alias="observationId")
    source_revision: Revision = Field(alias="sourceRevision")
    is_final: StrictBool = Field(alias="isFinal")
    received_at_ms: Annotated[ProtocolFloat, Field(ge=0)] = Field(alias="receivedAtMs")
    tokens: tuple[ObservationToken, ...]

    @model_validator(mode="after")
    def validate_partial(self):
        if not self.is_final and not self.tokens: raise ValueError("partial observation requires a token")
        previous = -1.0
        for token in self.tokens:
            if token.start_ms is not None and token.start_ms < previous: raise ValueError("token timestamps must not decrease")
            if token.end_ms is not None and token.start_ms is not None and token.end_ms < token.start_ms: raise ValueError("token timestamps must not decrease")
            if token.end_ms is not None: previous = token.end_ms
        return self


class WordLocation(WireModel):
    surah: PositiveInt; ayah: PositiveInt; word: PositiveInt


class CorpusSymbol(WireModel):
    id: NonBlankString; text: str
    phoneme: Annotated[str, Field(min_length=1)]; location: QuranLocation


class CorpusWord(WireModel):
    id: NonBlankString; text: str
    symbol_ids: tuple[NonBlankString, ...] = Field(alias="symbolIds", min_length=1)
    location: WordLocation


class QuranCorpus(WireModel):
    corpus_id: Annotated[str, Field(min_length=1)] = Field(alias="corpusId")
    revision: Annotated[str, Field(min_length=1)]
    symbols: tuple[CorpusSymbol, ...]
    words: tuple[CorpusWord, ...]

    @model_validator(mode="after")
    def validate_graph(self):
        symbol_ids = [symbol.id for symbol in self.symbols]
        word_ids = [word.id for word in self.words]
        if len(set(symbol_ids)) != len(symbol_ids): raise ValueError("corpus symbol IDs must be unique")
        if len(set(word_ids)) != len(word_ids): raise ValueError("corpus word IDs must be unique")
        known_symbols = set(symbol_ids)
        for word in self.words:
            if len(set(word.symbol_ids)) != len(word.symbol_ids): raise ValueError("word symbolIds must be unique")
            if not set(word.symbol_ids).issubset(known_symbols): raise ValueError("word symbolIds must reference corpus symbols")
        return self


class DisplayState(WireModel):
    location: QuranLocation
    is_reread: StrictBool = Field(alias="isReread")
    active_word_id: str | None = Field(alias="activeWordId")


class CommitState(WireModel):
    location: QuranLocation
    completed_word_ids: tuple[str, ...] = Field(alias="completedWordIds")


class Confidence(WireModel):
    alignment: UnitFloat; stability: UnitFloat; lookahead: UnitFloat
    matched_lookahead_count: Revision = Field(alias="matchedLookaheadCount")
    margin: Annotated[ProtocolFloat, Field(ge=0)]
    acoustic: UnitFloat | None
    combined: UnitFloat


class SubstitutionOperation(WireModel):
    kind: Literal["substitution"]
    actual_index: Revision = Field(alias="actualIndex")
    reference_index: Revision = Field(alias="referenceIndex")
    score: ProtocolFloat


class Finding(WireModel):
    type: Literal["substitution"]
    confirmation: Literal["immediate", "final", "soft"]
    observation_id: NonBlankString = Field(alias="observationId")
    operation: SubstitutionOperation
    actual_phoneme: str = Field(alias="actualPhoneme")
    reference_phoneme: str = Field(alias="referencePhoneme")
    reference_symbol_id: str = Field(alias="referenceSymbolId")
    location: QuranLocation
    confidence: Confidence
    confirmations: PositiveInt


class ReadingSnapshot(WireModel):
    revision: Revision
    observation_id: NonBlankString | None = Field(alias="observationId")
    display: DisplayState
    commit: CommitState
    confidence: Confidence | None
    finding: Finding | None


class ErrorEnvelope(WireModel):
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    request_id: str = Field(alias="requestId")
    type: Literal["error"]
    code: str
    message: str
    retryable: StrictBool
    details: dict[str, Any]

    @model_validator(mode="after")
    def validate_details(self):
        _safe_json(self.details)
        return self


class SessionCreatedEvent(WireModel):
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    request_id: str = Field(alias="requestId")
    type: Literal["session.created"]
    session_id: str = Field(alias="sessionId")
    snapshot: ReadingSnapshot


class SnapshotUpdatedEvent(WireModel):
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    request_id: str = Field(alias="requestId")
    type: Literal["snapshot.updated"]
    session_id: str = Field(alias="sessionId")
    snapshot: ReadingSnapshot


class SessionDeletedEvent(WireModel):
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    request_id: str = Field(alias="requestId")
    type: Literal["session.deleted"]
    session_id: str = Field(alias="sessionId")

QaraaEvent = SessionCreatedEvent | SnapshotUpdatedEvent | SessionDeletedEvent | ErrorEnvelope


class CommandEnvelope(WireModel):
    protocol_version: Literal[1] = Field(alias="protocolVersion")
    request_id: Annotated[str, Field(min_length=1)] = Field(alias="requestId")
    type: Literal["session.create", "session.get", "session.reset", "session.delete", "observation.submit", "session.resume"]
    session_id: str | None = Field(None, alias="sessionId")
    corpus_id: str | None = Field(None, alias="corpusId")
    observation_id: NonBlankString | None = Field(None, alias="observationId")
    source_revision: Revision | None = Field(None, alias="sourceRevision")
    is_final: StrictBool | None = Field(None, alias="isFinal")
    received_at_ms: Annotated[ProtocolFloat, Field(ge=0)] | None = Field(None, alias="receivedAtMs")
    tokens: tuple[ObservationToken, ...] | None = None
    last_snapshot_revision: Revision | None = Field(None, alias="lastSnapshotRevision")
    location: QuranLocation | None = None
    initial_location: QuranLocation | None = Field(None, alias="initialLocation")
    finding_mode: Literal["off", "substitutions"] | None = Field(None, alias="findingMode")

    @model_validator(mode="after")
    def validate_variant(self):
        required = {
            "session.create": (self.corpus_id,), "session.get": (self.session_id,),
            "session.reset": (self.session_id,), "session.delete": (self.session_id,),
            "session.resume": (self.session_id, self.last_snapshot_revision),
            "observation.submit": (self.session_id, self.observation_id, self.source_revision, self.is_final, self.received_at_ms, self.tokens),
        }[self.type]
        if any(value is None for value in required): raise ValueError(f"required field missing for {self.type}")
        if self.type == "observation.submit" and self.is_final is False and not self.tokens: raise ValueError("partial observation requires a token")
        return self
