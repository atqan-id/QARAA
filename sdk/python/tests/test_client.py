# Licensed under the Apache License, Version 2.0.
import json

import httpx
import pytest

from qaraa import QaraaClient, RecitationObservation, StaleRevisionError, TransportError

SNAPSHOT = {"revision": 1, "observationId": "obs-1", "display": {"location": {"surah": 1, "ayah": 1, "word": 1, "symbol": 1}, "isReread": False, "activeWordId": None}, "commit": {"location": {"surah": 1, "ayah": 1, "word": 1, "symbol": 1}, "completedWordIds": []}, "confidence": None, "finding": None}


def updated(session="a/b"):
    return {"protocolVersion": 1, "requestId": "r", "type": "snapshot.updated", "sessionId": session, "snapshot": SNAPSHOT}


def observation():
    return RecitationObservation.model_validate({"observationId": "stable-id", "sourceRevision": 0, "isFinal": False, "receivedAtMs": 1, "tokens": [{"id": "t", "text": "بِ", "phonemes": ["bi"]}]})


def test_actual_paths_aliases_and_submit_reuses_observation_id():
    requests = []
    def handler(request):
        requests.append(request)
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["type"] == "observation.submit"
            assert body["observationId"] == "stable-id"
        return httpx.Response(200, json=updated())
    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = QaraaClient("https://example.test/root/", http_client=http, request_id=lambda: "r")
    client.get_snapshot("a/b")
    client.submit_observation("a/b", observation())
    assert requests[0].url.raw_path.split(b"?")[0] == b"/root/v1/sessions/a%2Fb"
    assert requests[1].url.raw_path == b"/root/v1/sessions/a%2Fb/observations"
    client.close()
    assert not http.is_closed


def test_get_retries_transport_but_reset_and_delete_do_not():
    attempts = {"GET": 0, "POST": 0, "DELETE": 0}
    def handler(request):
        attempts[request.method] += 1
        if attempts[request.method] == 1:
            raise httpx.ConnectError("ambiguous", request=request)
        return httpx.Response(200, json=updated("s") if request.method != "DELETE" else {"protocolVersion": 1, "requestId": "r", "type": "session.deleted", "sessionId": "s"})
    client = QaraaClient("https://e", http_client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _: None)
    assert client.get_snapshot("s").revision == 1
    with pytest.raises(TransportError): client.reset_session("s")
    with pytest.raises(TransportError): client.delete_session("s")
    assert attempts == {"GET": 2, "POST": 1, "DELETE": 1}


def test_submit_retries_same_id_and_typed_errors_and_limit():
    bodies = []
    def handler(request):
        bodies.append(request.content)
        if len(bodies) == 1: raise httpx.ReadError("lost acknowledgement", request=request)
        return httpx.Response(200, json=updated("s"))
    client = QaraaClient("https://e", http_client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _: None)
    client.submit_observation("s", observation())
    assert bodies[0] == bodies[1]

    error = {"protocolVersion": 1, "requestId": "r", "type": "error", "code": "STALE_REVISION", "message": "stale", "retryable": False, "details": {}}
    typed = QaraaClient("https://e", http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(409, json=error))))
    with pytest.raises(StaleRevisionError): typed.get_snapshot("s")

    huge = b"{" + b" " * (1024 * 1024) + b"}"
    limited = QaraaClient("https://e", http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=huge))))
    with pytest.raises(TransportError, match="size limit"): limited.get_snapshot("s")


def test_reset_allows_observation_id_reuse():
    submitted=[]
    def handler(request):
        if request.url.path.endswith('/observations'): submitted.append(json.loads(request.content)['observationId'])
        return httpx.Response(200,json=updated('s'))
    client=QaraaClient('https://e',http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.submit_observation('s',observation());client.reset_session('s');client.submit_observation('s',observation())
    assert submitted==['stable-id','stable-id']
