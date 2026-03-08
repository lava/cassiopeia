"""Encrypted backup blob storage endpoints."""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import Response

from cassiopeia.db import execute
from cassiopeia.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sync/backup", tags=["backup"])

MAX_BACKUP_SIZE = 50 * 1024 * 1024  # 50 MB


def _get_user_sub(request: Request) -> str:
    user = request.session.get("user")
    if not user or not user.get("sub"):
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return user["sub"]


@router.post("")
async def upload_backup(request: Request, file: UploadFile) -> dict[str, Any]:
    """Upload an encrypted backup blob."""
    user_sub = _get_user_sub(request)

    rows = await execute(
        "SELECT user_sub FROM encrypted_backups WHERE user_sub = ?", [user_sub]
    )
    if not rows:
        raise HTTPException(
            status_code=403,
            detail="Encrypted backup is not provisioned for this user.",
        )

    data = await file.read()
    if len(data) > MAX_BACKUP_SIZE:
        raise HTTPException(status_code=413, detail="Backup exceeds 50 MB limit.")

    storage = get_storage()
    storage.write(user_sub, data)

    sha = hashlib.sha256(data).hexdigest()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    await execute(
        """UPDATE encrypted_backups
           SET sha256 = ?, size = ?, updated_at = ?
           WHERE user_sub = ?""",
        [sha, len(data), now, user_sub],
    )

    return {"sha256": sha, "size": len(data), "updated_at": now}


@router.get("")
async def download_backup(request: Request) -> Response:
    """Download the encrypted backup blob."""
    user_sub = _get_user_sub(request)

    storage = get_storage()
    data = storage.read(user_sub)
    if data is None:
        raise HTTPException(status_code=404, detail="No backup found.")

    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": "attachment; filename=backup.enc"},
    )


@router.get("/info")
async def backup_info(request: Request) -> dict[str, Any]:
    """Get backup metadata."""
    user_sub = _get_user_sub(request)

    rows = await execute(
        "SELECT sha256, size, updated_at FROM encrypted_backups WHERE user_sub = ?",
        [user_sub],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No backup provisioned.")

    row = rows[0]
    return {
        "sha256": row["sha256"],
        "size": int(row["size"]),
        "updated_at": row["updated_at"],
    }


@router.delete("")
async def delete_backup(request: Request) -> dict[str, str]:
    """Delete the encrypted backup."""
    user_sub = _get_user_sub(request)

    storage = get_storage()
    storage.delete(user_sub)

    await execute("DELETE FROM encrypted_backups WHERE user_sub = ?", [user_sub])

    return {"status": "deleted"}
