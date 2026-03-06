"""Import routes for CSV and API data sources."""

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from cassiopeia.db import get_db
from cassiopeia.importers.bearable import import_bearable_csv
from cassiopeia.schemas import ImportResult

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/bearable", response_model=ImportResult)
async def upload_bearable_csv(
    file: UploadFile,
    session: AsyncSession = Depends(get_db),
) -> ImportResult:
    """Upload a Bearable CSV export and import metrics."""
    content = await file.read()
    csv_text = content.decode("utf-8")
    return await import_bearable_csv(session, csv_text, filename=file.filename)
