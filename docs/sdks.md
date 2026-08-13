# Native SDKs

The Python, Go, and Dart packages are protocol-v1 clients for `@atqan/qaraa-server`. They never execute tokenization, alignment, confidence gates, finding classification, tracker state, recognition, or UI locally.

| SDK | Runtime contract | REST and cancellation | WebSocket behavior | Conformance and status |
| --- | --- | --- | --- | --- |
| Python | 3.10–3.14 | Sync + async clients; async close interrupts queued retry work | Async reconnect/resume; stale revisions suppressed; close terminates streams | Shared fixture output matches TypeScript and Go; Python 3.14 tests, wheel/sdist build, and metadata audit passed locally |
| Go | 1.24–1.26 | Context-aware operations; `Close` interrupts queued retry work | Context cancellation, reconnect/resume, stale suppression, newest-only backpressure | Shared fixture output matches TypeScript and Python; Go 1.26 race and vet gates passed locally |
| Dart | 3.10–3.12 | Async client; close signal interrupts queued retry work | One broadcast socket, pause cancellation, bounded reconnect/resume, stale suppression | Shared fixture runner and behavioral tests are implemented; Dart was unavailable locally, so CI is the first runtime gate |

All clients use the exact REST prefix `/v1/sessions`, observation suffix `/observations`, reset suffix `/reset`, and WebSocket suffix `/stream`. Query aliases are `protocolVersion`, `requestId`, and `lastSnapshotRevision`.

Reads and stream resume may be retried. Observation submission may be replayed after ambiguous transport loss only as the same encoded command with the same `observationId`. Create, reset, and delete are not automatically replayed after ambiguous transport failure. Explicit close prevents new work and stops reconnecting streams.

HTTP responses and WebSocket messages use a configurable 1 MiB default ceiling, aligned with the server’s default request body limit. Required fields remain strict. Unknown additive fields survive only through explicit extension storage; known fields override colliding extension keys during serialization.

The behavior suites cover byte-identical submit replay, observation-ID reuse after reset, stale and delayed revision suppression, reconnect resume aliases, close during queued retry work, the uniform response/message ceiling, and the rule that reset/delete are not replayed after ambiguous transport failure. The fixture comparator separately rejects duplicate languages, missing or duplicate fixtures, protocol-version mismatches, changed decoded fields, and inconsistent error codes.

After the TypeScript packages are built, `scripts/smoke-python-actual-server.py` performs create, get, submit, reset, same-ID resubmit, and delete through the Python SDK against the real `@atqan/qaraa-server` implementation.

## Integration examples

| Example | Boundary | Verified behavior |
| --- | --- | --- |
| FastAPI | One reusable async client in application lifespan | Dependency reuse, session-create forwarding, bidirectional disconnect cancellation, close-once ownership |
| Go service | Snapshot JSON and SSE facade over the Go SDK | Request-context propagation, resume alias, active-stream shutdown before HTTP shutdown |
| Flutter | Minimal remote reading status page | Pause cancels without destroying the reusable client; resume fetches current state before reconnect; stale events remain hidden |

The FastAPI and Go examples passed their local focused gates. The Flutter example is implemented and statically reviewed only because Flutter 3.44.4/Dart 3.12.2 were unavailable in the local environment; its CI job runs `flutter analyze`, `flutter test`, and a release web build.

Run normalized fixture comparison with:

```bash
node scripts/generate-js-conformance-result.mjs /tmp/typescript.json
PYTHONPATH=sdk/python/src python3 -m qaraa.conformance conformance/v1 /tmp/python.json
(cd sdk/go && go run ./cmd/conformance ../../conformance/v1 /tmp/go.json)
node scripts/compare-conformance-results.mjs /tmp/typescript.json /tmp/python.json /tmp/go.json
```

The Dart runner is `dart run sdk/dart/tool/conformance.dart conformance/v1 /tmp/dart.json` when Dart is installed. No package is published by these commands. The Go module path remains intentionally local until a public Git remote is confirmed.

`node scripts/audit-native-packages.mjs` scans SDK and example sources, inspects built Python archives when present, asks Go for each module’s package file list, and runs a Dart publish dry-run when Dart is installed. `--release` intentionally fails while the Go module uses the private placeholder path.
