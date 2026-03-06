import logging
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from cassiopeia.db import async_session_maker
from cassiopeia.routers.import_ import router as import_router
from cassiopeia.seed import seed_default_metrics

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Run Alembic migrations on startup
    logger.info("Running database migrations...")
    subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=Path(__file__).resolve().parent.parent.parent,
        check=True,
    )
    logger.info("Migrations complete.")

    # Seed default metrics
    async with async_session_maker() as session:
        await seed_default_metrics(session)
    logger.info("Default metrics seeded.")

    yield


app = FastAPI(title="Cassiopeia", lifespan=lifespan)

app.include_router(import_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


# Serve built frontend static files (must be last so it doesn't shadow API routes)
_static_dir = Path(__file__).resolve().parent.parent.parent / "static"
if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
