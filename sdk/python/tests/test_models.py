# Licensed under the Apache License, Version 2.0.
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from qaraa import ErrorEnvelope, QuranCorpus, ReadingSnapshot, RecitationObservation, decode_event

ROOT = Path(__file__).parents[3]


def fixture(name: str):
    return json.loads((ROOT / "conformance/v1" / name).read_text())


@pytest.mark.parametrize("name, model", [
    ("valid/partial-observation.json", RecitationObservation),
    ("valid/final-observation.json", RecitationObservation),
    ("valid/reading-snapshot.json", ReadingSnapshot),
    ("valid/error-envelope.json", ErrorEnvelope),
])
def test_models_round_trip_wire_aliases_and_additive_fields(name, model):
    data = fixture(name)
    data["futureField"] = {"safe": [1, True, None]}
    decoded = model.model_validate(data)
    assert decoded.model_dump(mode="json", by_alias=True, exclude_unset=True) == data


@pytest.mark.parametrize("value", [True, 1.5, -1])
def test_revision_is_strict_non_negative_integer(value):
    data = fixture("valid/reading-snapshot.json")
    data["revision"] = value
    with pytest.raises(ValidationError):
        ReadingSnapshot.model_validate(data)


def test_unknown_error_code_is_preserved():
    data = fixture("valid/error-envelope.json")
    data["code"] = "FUTURE_ERROR"
    event = decode_event(data)
    assert event.code == "FUTURE_ERROR"


@pytest.mark.parametrize("extension", [9007199254740992, float("inf")])
def test_extensions_reject_unsafe_numbers(extension):
    data = fixture("valid/reading-snapshot.json")
    data["futureField"] = extension
    with pytest.raises(ValidationError):
        ReadingSnapshot.model_validate(data)


def test_extensions_reject_excessive_json_depth():
    data = fixture("valid/reading-snapshot.json")
    extension = None
    for _ in range(66):
        extension = [extension]
    data["futureField"] = extension
    with pytest.raises(ValidationError):
        ReadingSnapshot.model_validate(data)


def test_observation_ids_reject_whitespace_in_commands_and_nullable_snapshots():
    observation = fixture("valid/partial-observation.json")
    observation["observationId"] = "   "
    with pytest.raises(ValidationError):
        RecitationObservation.model_validate(observation)

    snapshot = fixture("valid/reading-snapshot.json")
    snapshot["observationId"] = "\t"
    with pytest.raises(ValidationError):
        ReadingSnapshot.model_validate(snapshot)


def test_corpus_graph_rejects_duplicate_ids_and_dangling_references():
    base = fixture("valid/minimal-corpus.json")
    for mutate in (
        lambda data: data["symbols"].append({**data["symbols"][0]}),
        lambda data: data["words"].append({**data["words"][0]}),
        lambda data: data["words"][0].update(symbolIds=[data["words"][0]["symbolIds"][0]] * 2),
        lambda data: data["words"][0].update(symbolIds=["missing-symbol"]),
        lambda data: data["symbols"][0].update(id="  "),
        lambda data: data["words"][0].update(id="\t"),
    ):
        data = json.loads(json.dumps(base))
        mutate(data)
        with pytest.raises(ValidationError):
            QuranCorpus.model_validate(data)

    assert QuranCorpus.model_validate(fixture("valid/corpus-unused-symbol.json"))
