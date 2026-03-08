import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from cassiopeia.config import settings
from cassiopeia.routers.auth import router as auth_router
from cassiopeia.routers.sync import router as sync_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield


app = FastAPI(title="Cassiopeia", lifespan=lifespan)

app.include_router(auth_router)
app.include_router(sync_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie="cassiopeia_session",
    same_site="lax",
    https_only=False,
)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/proxy/oura")
async def proxy_oura(request: Request) -> dict:
    """Stateless proxy for Oura API calls (works around CORS)."""
    body = await request.json()
    token = body.get("token", "")
    endpoint = body.get("endpoint", "")
    params = body.get("params", {})

    if not token or not endpoint:
        return {"error": "Missing token or endpoint"}

    url = f"https://api.ouraring.com/v2/usercollection/{endpoint}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params=params,
        )
        resp.raise_for_status()
        return resp.json()  # type: ignore[no-any-return]


# Serve built frontend static files (must be last so it doesn't shadow API routes)
_static_dir = Path(__file__).resolve().parent.parent.parent / "static"
if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
