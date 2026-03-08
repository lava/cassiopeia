"""Turso database provisioning and sync credentials."""

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request

from cassiopeia.config import settings
from cassiopeia.db import execute

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sync", tags=["sync"])

TURSO_API = "https://api.turso.tech"

# Schema to create in each per-user Turso database
USER_DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS metric_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL,
  original_min REAL NOT NULL DEFAULT 0,
  original_max REAL NOT NULL,
  category TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  metric_id INTEGER NOT NULL REFERENCES metric_definitions(id),
  raw_value REAL NOT NULL,
  normalized REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, metric_id)
);

CREATE TABLE IF NOT EXISTS raw_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  filename TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS raw_import_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES raw_imports(id),
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT UNIQUE NOT NULL,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def _get_user_sub(request: Request) -> str:
    user = request.session.get("user")
    if not user or not user.get("sub"):
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return user["sub"]


def _turso_configured() -> bool:
    return bool(settings.turso_org and settings.turso_api_token)


def _db_name_for_user(user_sub: str) -> str:
    """Generate a Turso database name from a user sub."""
    safe = user_sub.replace("|", "-").replace(":", "-").lower()
    # Turso DB names: lowercase alphanumeric + hyphens, max 64 chars
    safe = "".join(c if c.isalnum() or c == "-" else "-" for c in safe)
    return f"user-{safe}"[:64]


@router.post("/provision")
async def provision_database(request: Request) -> dict[str, Any]:
    """Create a per-user Turso database."""
    if not _turso_configured():
        raise HTTPException(status_code=501, detail="Turso sync is not configured.")

    user_sub = _get_user_sub(request)

    # Check if already provisioned
    rows = await execute(
        "SELECT db_url FROM turso_databases WHERE user_sub = ?", [user_sub]
    )
    if rows:
        return {"provisioned": True, "db_url": rows[0]["db_url"]}

    db_name = _db_name_for_user(user_sub)

    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {settings.turso_api_token}"},
        timeout=30,
    ) as client:
        # Create database
        resp = await client.post(
            f"{TURSO_API}/v1/organizations/{settings.turso_org}/databases",
            json={
                "name": db_name,
                "group": settings.turso_group or "default",
            },
        )
        if resp.status_code == 409:
            # Already exists, just look up the URL
            pass
        elif not resp.is_success:
            logger.error("Turso create DB failed: %s %s", resp.status_code, resp.text)
            raise HTTPException(status_code=502, detail="Failed to create sync database.")

        db_url = f"libsql://{db_name}-{settings.turso_org}.turso.io"

        # Create auth token for the database
        token_resp = await client.post(
            f"{TURSO_API}/v1/organizations/{settings.turso_org}/databases/{db_name}/auth/tokens",
        )
        if not token_resp.is_success:
            logger.error("Turso token creation failed: %s", token_resp.text)
            raise HTTPException(status_code=502, detail="Failed to create sync credentials.")

        jwt = token_resp.json().get("jwt", "")

    # Initialize schema via libsql HTTP API
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            for statement in USER_DB_SCHEMA.strip().split(";"):
                stmt = statement.strip()
                if not stmt:
                    continue
                await client.post(
                    f"https://{db_name}-{settings.turso_org}.turso.io/v2/pipeline",
                    headers={"Authorization": f"Bearer {jwt}"},
                    json={
                        "requests": [
                            {"type": "execute", "stmt": {"sql": stmt}},
                            {"type": "close"},
                        ]
                    },
                )
    except Exception as e:
        logger.warning("Schema init may have failed: %s", e)

    # Store mapping in admin DB
    await execute(
        "INSERT INTO turso_databases (user_sub, db_url) VALUES (?, ?)",
        [user_sub, db_url],
    )

    return {"provisioned": True, "db_url": db_url}


@router.get("/credentials")
async def get_credentials(request: Request) -> dict[str, str]:
    """Get Turso connection credentials for the current user."""
    if not _turso_configured():
        raise HTTPException(status_code=501, detail="Turso sync is not configured.")

    user_sub = _get_user_sub(request)

    rows = await execute(
        "SELECT db_url FROM turso_databases WHERE user_sub = ?", [user_sub]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No sync database provisioned.")

    db_url = rows[0]["db_url"]
    db_name = _db_name_for_user(user_sub)

    # Generate a fresh short-lived token
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {settings.turso_api_token}"},
        timeout=15,
    ) as client:
        resp = await client.post(
            f"{TURSO_API}/v1/organizations/{settings.turso_org}/databases/{db_name}/auth/tokens",
            json={"expiration": "6h"},
        )
        if not resp.is_success:
            raise HTTPException(status_code=502, detail="Failed to generate sync credentials.")

        jwt = resp.json().get("jwt", "")

    return {"url": db_url, "token": jwt}
