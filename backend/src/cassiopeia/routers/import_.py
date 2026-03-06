"""Import routes for CSV and API data sources."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from cassiopeia.db import get_db
from cassiopeia.importers.bearable import import_bearable_csv
from cassiopeia.importers.garmin import import_garmin_csv
from cassiopeia.importers.oura import sync_oura
from cassiopeia.models import UserToken
from cassiopeia.schemas import ImportResult

router = APIRouter(prefix="/api/import", tags=["import"])


def _get_user_sub(request: Request) -> str:
    user = request.session.get("user")
    if not user or not user.get("sub"):
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return user["sub"]


@router.post("/bearable", response_model=ImportResult)
async def upload_bearable_csv(
    file: UploadFile,
    session: AsyncSession = Depends(get_db),
) -> ImportResult:
    """Upload a Bearable CSV export and import metrics."""
    content = await file.read()
    csv_text = content.decode("utf-8")
    return await import_bearable_csv(session, csv_text, filename=file.filename)


@router.post("/garmin", response_model=ImportResult)
async def upload_garmin_csv(
    file: UploadFile,
    session: AsyncSession = Depends(get_db),
) -> ImportResult:
    """Upload a GarminDB daily summary CSV export and import metrics."""
    content = await file.read()
    csv_text = content.decode("utf-8")
    return await import_garmin_csv(session, csv_text, filename=file.filename)


# --- Oura token management ---


@router.get("/oura/token")
async def oura_token_status(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """Check whether the current user has an Oura token configured."""
    user_sub = _get_user_sub(request)
    result = await session.execute(
        select(UserToken.id).where(
            UserToken.user_sub == user_sub, UserToken.service == "oura"
        )
    )
    return {"configured": result.scalar_one_or_none() is not None}


@router.put("/oura/token")
async def save_oura_token(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """Save or update the Oura personal access token for the current user."""
    user_sub = _get_user_sub(request)
    body = await request.json()
    token = body.get("token", "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token darf nicht leer sein.")

    stmt = pg_insert(UserToken).values(
        user_sub=user_sub, service="oura", token=token
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_sub", "service"],
        set_={"token": stmt.excluded.token},
    )
    await session.execute(stmt)
    await session.commit()
    return {"configured": True}


@router.delete("/oura/token")
async def delete_oura_token(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """Remove the Oura token for the current user."""
    user_sub = _get_user_sub(request)
    await session.execute(
        delete(UserToken).where(
            UserToken.user_sub == user_sub, UserToken.service == "oura"
        )
    )
    await session.commit()
    return {"configured": False}


# --- Oura sync ---


@router.post("/oura/sync", response_model=ImportResult)
async def oura_sync(
    request: Request,
    session: AsyncSession = Depends(get_db),
    start: date | None = Query(None, alias="from"),
    end: date | None = Query(None, alias="to"),
) -> ImportResult:
    """Sync data from the Oura Ring API using the current user's token."""
    user_sub = _get_user_sub(request)

    result = await session.execute(
        select(UserToken.token).where(
            UserToken.user_sub == user_sub, UserToken.service == "oura"
        )
    )
    access_token = result.scalar_one_or_none()
    if not access_token:
        raise HTTPException(
            status_code=400,
            detail="Kein Oura-Token hinterlegt. Bitte zuerst unter Einstellungen konfigurieren.",
        )

    if end is None:
        end = date.today()
    if start is None:
        start = end - timedelta(days=30)

    return await sync_oura(session, access_token, start, end)
