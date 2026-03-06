"""Oura Ring API v2 integration.

Fetches daily sleep, readiness, and activity data from the Oura API
and upserts metric values into the database.
"""

import logging
from collections.abc import Callable
from datetime import date

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from cassiopeia.models import DailyMetric, MetricDefinition, RawImport
from cassiopeia.schemas import ImportResult

logger = logging.getLogger(__name__)

OURA_BASE = "https://api.ouraring.com/v2/usercollection"

# (metric_name, display_name, original_max, category)
OURA_METRICS: dict[str, tuple[str, str, float, str]] = {
    "sleep_score": ("sleep_score", "Schlafwert", 100, "sleep"),
    "readiness_score": ("readiness_score", "Bereitschaft", 100, "vitals"),
    "hrv_balance": ("hrv_balance", "HRV Balance", 100, "vitals"),
    "resting_heart_rate": ("resting_heart_rate", "Ruhepuls", 120, "vitals"),
    "activity_score": ("activity_score", "Aktivitätswert", 100, "vitals"),
}


async def _ensure_metrics(
    session: AsyncSession,
    cache: dict[str, MetricDefinition],
) -> None:
    """Ensure all Oura metric definitions exist in the database."""
    for name, (_, display_name, original_max, category) in OURA_METRICS.items():
        if name in cache:
            continue
        result = await session.execute(
            select(MetricDefinition).where(MetricDefinition.name == name)
        )
        metric_def = result.scalar_one_or_none()
        if metric_def is None:
            metric_def = MetricDefinition(
                name=name,
                display_name=display_name,
                source="oura",
                original_min=0,
                original_max=original_max,
                category=category,
                is_default=(name == "sleep_score"),
            )
            session.add(metric_def)
            await session.flush()
        cache[name] = metric_def


async def _upsert_metric(
    session: AsyncSession,
    metric_def: MetricDefinition,
    day: date,
    raw_value: float,
) -> None:
    """Upsert a single daily metric value."""
    original_max = metric_def.original_max
    normalized = max(0.0, min(1.0, raw_value / original_max)) if original_max > 0 else 0.0
    stmt = pg_insert(DailyMetric).values(
        date=day,
        metric_id=metric_def.id,
        raw_value=raw_value,
        normalized=normalized,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["date", "metric_id"],
        set_={"raw_value": stmt.excluded.raw_value, "normalized": stmt.excluded.normalized},
    )
    await session.execute(stmt)


async def _fetch_oura(
    client: httpx.AsyncClient,
    endpoint: str,
    start_date: date,
    end_date: date,
) -> list[dict]:
    """Fetch paginated data from an Oura API v2 endpoint."""
    items: list[dict] = []
    url: str | None = f"{OURA_BASE}/{endpoint}"
    params: dict[str, str] | None = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }

    while url:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        body = resp.json()
        items.extend(body.get("data", []))
        url = body.get("next_token")
        if url:
            # next_token is a full URL, no params needed
            params = None

    return items


def _extract_metrics_from_sleep(record: dict) -> dict[str, float | None]:
    """Extract metric values from a daily_sleep record."""
    return {
        "sleep_score": record.get("score"),
    }


def _extract_metrics_from_readiness(record: dict) -> dict[str, float | None]:
    """Extract metric values from a daily_readiness record."""
    contributors = record.get("contributors", {})
    return {
        "readiness_score": record.get("score"),
        "hrv_balance": contributors.get("hrv_balance"),
        "resting_heart_rate": contributors.get("resting_heart_rate"),
    }


def _extract_metrics_from_activity(record: dict) -> dict[str, float | None]:
    """Extract metric values from a daily_activity record."""
    return {
        "activity_score": record.get("score"),
    }


async def sync_oura(
    session: AsyncSession,
    access_token: str,
    start_date: date,
    end_date: date,
) -> ImportResult:
    """Fetch data from Oura API and upsert into the database.

    Args:
        session: Active async database session.
        access_token: Oura personal access token.
        start_date: Start of the date range to sync.
        end_date: End of the date range to sync.

    Returns:
        ImportResult with counts of imported, skipped, and errors.
    """
    metric_cache: dict[str, MetricDefinition] = {}
    await _ensure_metrics(session, metric_cache)

    imported = 0
    skipped = 0
    errors: list[str] = []

    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient(headers=headers, timeout=30) as client:
        # Fetch all three data types in sequence
        Extractor = Callable[[dict], dict[str, float | None]]
        extractors: list[tuple[str, Extractor]] = [
            ("daily_sleep", _extract_metrics_from_sleep),
            ("daily_readiness", _extract_metrics_from_readiness),
            ("daily_activity", _extract_metrics_from_activity),
        ]

        all_raw_data: dict[str, list[dict]] = {}

        for endpoint, extractor in extractors:
            try:
                records = await _fetch_oura(client, endpoint, start_date, end_date)
            except httpx.HTTPStatusError as e:
                errors.append(f"Oura API error for {endpoint}: {e.response.status_code}")
                continue
            except httpx.RequestError as e:
                errors.append(f"Oura API request failed for {endpoint}: {e}")
                continue

            all_raw_data[endpoint] = records

            for record in records:
                day_str = record.get("day")
                if not day_str:
                    skipped += 1
                    continue

                try:
                    day = date.fromisoformat(day_str)
                except ValueError:
                    errors.append(f"Invalid date in {endpoint}: {day_str}")
                    continue

                metrics = extractor(record)
                for metric_name, value in metrics.items():
                    if value is None:
                        skipped += 1
                        continue
                    metric_def = metric_cache.get(metric_name)
                    if metric_def is None:
                        skipped += 1
                        continue
                    await _upsert_metric(session, metric_def, day, float(value))
                    imported += 1

    # Store raw import record
    raw_import = RawImport(
        source="oura",
        data={
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "record_counts": {k: len(v) for k, v in all_raw_data.items()},
        },
    )
    session.add(raw_import)

    await session.commit()

    return ImportResult(imported=imported, skipped=skipped, errors=errors)
