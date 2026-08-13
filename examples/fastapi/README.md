# FastAPI QARAA proxy example

This example creates one `AsyncQaraaClient` for the application lifespan, injects it into a session-creation route, and cancels both sides of a WebSocket proxy when either side disconnects. Set `QARAA_SERVER_URL` to the separately running TypeScript QARAA server.

It forwards serialized snapshots without alignment, recognition, scoring, persistence, credentials, corpus data, or application UI.
