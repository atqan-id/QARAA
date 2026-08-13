# Flutter QARAA lifecycle example

Pass `QARAA_SERVER_URL` and an existing `QARAA_SESSION_ID` with `--dart-define`. The controller cancels its stream when the app pauses, fetches the current remote snapshot before resuming from that revision, ignores stale events, and closes owned resources once.

The Material page displays connection status, revision, active location, and a manual reconnect control. It deliberately contains no Mushaf rendering, audio capture, recognition, model loading, scoring, corpus data, or ATQAN application UI.
