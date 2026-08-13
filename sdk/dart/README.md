# QARAA Dart client

Immutable protocol-v1 models plus injectable REST and WebSocket transports for the remote TypeScript QARAA server. `submitObservation` retries only a byte-identical command with the same `observationId`; reset and delete do not replay ambiguous requests. HTTP and WebSocket messages share a configurable 1 MiB default ceiling. The package contains no alignment, recognition, model, corpus, audio, Flutter UI, or platform-specific socket implementation.

Ordinary constructors and `fromJson` defensively copy collections and recursively freeze additive extension values. Named `.constant` constructors are for canonical compile-time values built exclusively from const collections; use the ordinary constructors for runtime inputs.
