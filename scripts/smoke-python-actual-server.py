#!/usr/bin/env python3
"""Exercise the Python SDK against the actual built TypeScript server."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from qaraa import QaraaClient, RecitationObservation


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    server = subprocess.Popen(
        ["node", "scripts/serve-conformance-server.mjs"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert server.stdout is not None
        ready = json.loads(server.stdout.readline())
        if not ready.get("ready"):
            raise RuntimeError(f"conformance server did not start: {ready!r}")
        observation = RecitationObservation.model_validate(
            json.loads(
                (root / "conformance/v1/valid/partial-observation.json").read_text()
            )
        )
        with QaraaClient(ready["address"]) as client:
            created = client.create_session("minimal-quran")
            session_id = created.session_id
            assert client.get_snapshot(session_id).revision == created.snapshot.revision
            first = client.submit_observation(session_id, observation)
            assert first.observation_id == observation.observation_id
            client.reset_session(session_id)
            reused = client.submit_observation(session_id, observation)
            assert reused.observation_id == observation.observation_id
            client.delete_session(session_id)
        print("Actual TypeScript server lifecycle passed (Python SDK)")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        if server.returncode not in (-15, 0):
            assert server.stderr is not None
            print(server.stderr.read(), file=sys.stderr)


if __name__ == "__main__":
    main()
