# Go QARAA service example

This example propagates inbound request contexts to the remote TypeScript QARAA server. `GET /api/reading/{sessionID}` returns the serialized snapshot; `GET /api/reading/{sessionID}/events` emits snapshots as server-sent events and accepts `lastSnapshotRevision` for resume.

Set `QARAA_SERVER_URL` for the upstream server and optionally `QARAA_EXAMPLE_ADDR` for the local listener. Shutdown closes SDK streams before waiting up to five seconds for HTTP handlers. The example contains no tracker, alignment, recognition, corpus, persistence, authentication, or UI logic.
