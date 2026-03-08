"""Admin database client using Turso HTTP pipeline API."""

import logging
from typing import Any

import httpx

from cassiopeia.config import settings

logger = logging.getLogger(__name__)

ADMIN_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        sub TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        picture TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS turso_databases (
        user_sub TEXT PRIMARY KEY,
        db_url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )""",
]


def _http_url() -> str:
    return settings.turso_admin_db_url.replace("libsql://", "https://")


def _auth_header() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.turso_admin_db_token}"}


async def execute(
    sql: str, args: list[Any] | None = None
) -> list[dict[str, Any]]:
    """Execute a SQL statement against the admin Turso database."""
    stmt: dict[str, Any] = {"sql": sql}
    if args:
        stmt["args"] = [
            {"type": "null", "value": None}
            if a is None
            else {"type": "text", "value": str(a)}
            for a in args
        ]

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{_http_url()}/v2/pipeline",
            headers=_auth_header(),
            json={
                "requests": [
                    {"type": "execute", "stmt": stmt},
                    {"type": "close"},
                ]
            },
        )
        resp.raise_for_status()

    data = resp.json()
    result_wrapper = data["results"][0]
    if result_wrapper.get("type") == "error":
        error = result_wrapper.get("error", {})
        raise RuntimeError(f"Turso query error: {error.get('message', error)}")

    result = result_wrapper["response"]["result"]
    cols = [c["name"] for c in result["cols"]]
    return [
        {col: cell.get("value") for col, cell in zip(cols, row)}
        for row in result.get("rows", [])
    ]


async def init_schema() -> None:
    """Create admin tables if they don't exist."""
    if not settings.turso_admin_db_url:
        logger.warning("TURSO_ADMIN_DB_URL not set, skipping schema init")
        return
    for stmt in ADMIN_SCHEMA:
        await execute(stmt)
    logger.info("Admin database schema initialized")
