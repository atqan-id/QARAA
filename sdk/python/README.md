# QARAA Python client

Typed sync and async protocol-v1 clients for the remote TypeScript QARAA server. This package does not contain alignment, recognition, corpus data, models, or UI.

`submit_observation` retries ambiguous transport failures only by replaying the exact encoded command with the same `observationId`. Reads and stream resume are retryable; create, reset, and delete are not automatically replayed. HTTP and WebSocket messages default to the server-aligned 1 MiB ceiling.
