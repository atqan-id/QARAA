# QARAA cross-language conformance

Protocol fixture results use one normalized shape:

```json
{"language":"python","sdkVersion":"0.1.0","protocolVersion":1,"cases":[{"fixture":"valid/reading-snapshot.json","decoded":{},"roundTrip":{},"errorCode":null}]}
```

`decoded` and `roundTrip` contain wire names and JSON values, never native class names. The comparator rejects unknown, duplicate, missing, or semantically different rows. `expected-semantics.json` is the behavior contract shared by client test suites; it covers behavior that static fixtures cannot express.

After `pnpm build`, `serve-conformance-server.mjs` starts the actual TypeScript server on `127.0.0.1` with an OS-assigned port. `--max-sessions 1` and `--max-subscribers 1` make typed capacity errors deterministic; `--shutdown-after-ms N` provides a deterministic transport disconnect for reconnect tests.

Run `node scripts/compare-conformance-results.mjs result-python.json result-go.json result-dart.json` after each language emits a result.
