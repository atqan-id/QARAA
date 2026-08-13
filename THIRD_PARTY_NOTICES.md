# Third-party notices

QARAA package tarballs do not bundle third-party JavaScript implementations. Installing packages resolves the direct runtime dependencies below under their own licenses, together with those projects’ transitive dependencies and notices.

| Dependency | Used by | Version in this repository | License | Purpose |
| --- | --- | --- | --- | --- |
| `ajv` | `@atqan/qaraa-protocol` | 8.20.0 | MIT | JSON Schema validation |
| `fastify` | `@atqan/qaraa-server` | 5.11.3 | MIT | HTTP server and request lifecycle |
| `@fastify/websocket` | `@atqan/qaraa-server` | 11.3.0 | MIT | Fastify WebSocket routes |
| `pydantic` | Python SDK | 2.13.4 compatible | MIT | Immutable protocol model validation |
| `httpx` | Python SDK | 0.28.1 compatible | BSD-3-Clause | Injectable HTTP transport |
| `websockets` | Python SDK | 16.1.1 compatible | BSD-3-Clause | Async WebSocket transport |
| `fastapi` | FastAPI example | 0.139.2 compatible | MIT | Application lifespan, dependency injection, and proxy routes |
| `github.com/coder/websocket` | Go SDK | 1.8.15 | ISC | Context-aware WebSocket transport |
| `http` | Dart SDK | 1.6.0 compatible | BSD-3-Clause | Injectable HTTP transport |
| `web_socket_channel` | Dart SDK | 3.0.3 compatible | BSD-3-Clause | Platform-neutral WebSocket channel |

The QARAA packages depend on one another under Apache-2.0. Development and benchmark dependencies are recorded in `pnpm-lock.yaml` but are not runtime dependencies of the public packages.

QARAA distributes no recognition model, model weight, tokenizer tied to a model, private credential or endpoint, or Quran dataset in this phase. Consumers supply and license their own corpus, recognizer, token mapping, and related assets. The optional Sherpa-ONNX normalizer does not include or depend on the Sherpa runtime.

This inventory is informational and does not replace the license files distributed by each dependency.
