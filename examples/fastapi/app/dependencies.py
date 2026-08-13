"""Application-scoped QARAA client dependency."""
# Licensed under the Apache License, Version 2.0.
from fastapi import Request
from qaraa import AsyncQaraaClient


def qaraa_client(request: Request) -> AsyncQaraaClient:
    """Return the single client owned by the application lifespan."""
    return request.app.state.qaraa_client
