"""Minimal dependency-injected FastAPI proxy for QARAA protocol v1."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
from collections.abc import Callable
from contextlib import asynccontextmanager
import os

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ConfigDict, Field
from qaraa import AsyncQaraaClient, QuranLocation

from .dependencies import qaraa_client
from .proxy import proxy_snapshot_stream


class CreateSessionBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    corpus_id: str = Field(alias="corpusId", min_length=1)
    initial_location: QuranLocation | None = Field(None, alias="initialLocation")
    finding_mode: str | None = Field(None, alias="findingMode", pattern="^(off|substitutions)$")


def create_app(
    *,
    client_factory: Callable[[str], AsyncQaraaClient] = AsyncQaraaClient,
    server_url: str | None = None,
) -> FastAPI:
    resolved_url = server_url or os.environ.get("QARAA_SERVER_URL", "http://127.0.0.1:3000")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = client_factory(resolved_url)
        app.state.qaraa_client = client
        try:
            yield
        finally:
            await client.close()

    app = FastAPI(title="QARAA FastAPI proxy example", lifespan=lifespan)

    @app.post("/qaraa/sessions", status_code=status.HTTP_201_CREATED)
    async def create_session(
        body: CreateSessionBody,
        client: AsyncQaraaClient = Depends(qaraa_client),
    ):
        event = await client.create_session(
            body.corpus_id,
            initial_location=body.initial_location,
            finding_mode=body.finding_mode,
        )
        return event.model_dump(mode="json", by_alias=True, exclude_unset=True)

    @app.websocket("/qaraa/sessions/{session_id}/stream")
    async def stream_session(
        websocket: WebSocket,
        session_id: str,
        lastSnapshotRevision: int = 0,
    ) -> None:
        client = app.state.qaraa_client
        try:
            await proxy_snapshot_stream(websocket, client, session_id, lastSnapshotRevision)
        except WebSocketDisconnect:
            return

    return app


app = create_app()
