# Licensed under the Apache License, Version 2.0.
import json
from pathlib import Path
import pytest
from qaraa import TransportError, decode_message

ROOT=Path(__file__).parents[3]
MANIFEST=json.loads((ROOT/'conformance/v1/manifest.json').read_text())
@pytest.mark.parametrize('entry',MANIFEST,ids=lambda row:row['file'])
def test_shared_fixture(entry):
    data=json.loads((ROOT/'conformance/v1'/entry['file']).read_text())
    if not entry['valid']:
        with pytest.raises(TransportError): decode_message(data,entry['schema'])
        return
    decoded=decode_message(data,entry['schema'])
    assert decoded.model_dump(mode='json',by_alias=True,exclude_unset=True)==data


def test_error_schema_rejects_non_error_events():
    event = json.loads((ROOT/'conformance/v1/valid/session-deleted-event.json').read_text())
    with pytest.raises(TransportError):
        decode_message(event, 'error')
