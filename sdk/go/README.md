# QARAA Go client

Protocol-v1 REST and WebSocket client for the remote TypeScript QARAA server. `SubmitObservation` replays only a byte-identical command carrying the same `observationId`; reset and delete are never replayed after ambiguous transport failure. Streams suppress stale revisions, resume from the latest accepted revision, and keep only the newest pending snapshot. HTTP and WebSocket messages share a configurable, server-aligned 1 MiB default limit.

The temporary module path `qaraa.local/sdk/go` must be replaced only after the public repository remote is confirmed. This package contains no alignment, model, corpus, audio, or UI implementation.
