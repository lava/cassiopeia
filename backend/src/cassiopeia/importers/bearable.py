"""Bearable CSV import parser.

Parses Bearable health tracker CSV exports and upserts metric data
into the database.
"""

import io
import logging
import re

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from cassiopeia.models import DailyMetric, MetricDefinition, RawImport
from cassiopeia.schemas import ImportResult

logger = logging.getLogger(__name__)

# Known column -> (metric_name, display_name, source, original_max, category)
KNOWN_COLUMNS: dict[str, tuple[str, str, str, float, str | None]] = {
    "Mood (average)": ("mood", "Stimmung", "bearable", 10, "mood"),
    "Energy (average)": ("energy", "Energie", "bearable", 5, "vitals"),
    "Sleep quality": ("sleep_quality", "Schlafqualität", "bearable", 5, "sleep"),
    "Tagesform": ("daily_form", "Tagesform", "bearable", 100, "vitals"),
    "Daily form": ("daily_form", "Tagesform", "bearable", 100, "vitals"),
}

_SYMPTOM_RE = re.compile(r"^Symptom:\s*(.+)$")
_FACTOR_RE = re.compile(r"^Factor:\s*(.+)$")


def _slugify(text: str) -> str:
    """Convert text to a slug suitable for metric names."""
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def _parse_column(
    col: str,
) -> tuple[str, str, str, float, str | None] | None:
    """Map a CSV column name to metric definition fields.

    Returns (name, display_name, source, original_max, category) or None
    if the column should be skipped.
    """
    if col in KNOWN_COLUMNS:
        return KNOWN_COLUMNS[col]

    m = _SYMPTOM_RE.match(col)
    if m:
        label = m.group(1).strip()
        slug = f"symptom_{_slugify(label)}"
        return (slug, f"Symptom: {label}", "bearable", 10, "symptoms")

    m = _FACTOR_RE.match(col)
    if m:
        label = m.group(1).strip()
        slug = f"factor_{_slugify(label)}"
        return (slug, f"Factor: {label}", "bearable", 10, "factors")

    return None


async def _get_or_create_metric(
    session: AsyncSession,
    name: str,
    display_name: str,
    source: str,
    original_max: float,
    category: str | None,
    cache: dict[str, MetricDefinition],
) -> MetricDefinition:
    """Look up a MetricDefinition by name, creating it if needed."""
    if name in cache:
        return cache[name]

    result = await session.execute(
        select(MetricDefinition).where(MetricDefinition.name == name)
    )
    metric_def = result.scalar_one_or_none()

    if metric_def is None:
        metric_def = MetricDefinition(
            name=name,
            display_name=display_name,
            source=source,
            original_min=0,
            original_max=original_max,
            category=category,
            is_default=False,
        )
        session.add(metric_def)
        await session.flush()  # populate metric_def.id

    cache[name] = metric_def
    return metric_def


async def import_bearable_csv(
    session: AsyncSession,
    csv_content: str,
    user_sub: str,
    filename: str | None = None,
) -> ImportResult:
    """Parse a Bearable CSV export and upsert metrics into the database.

    Args:
        session: Active async database session.
        csv_content: Raw CSV text content.
        filename: Optional filename for the raw import record.

    Returns:
        ImportResult with counts of imported, skipped, and errors.
    """
    df = pd.read_csv(io.StringIO(csv_content))

    if "date" not in df.columns:
        return ImportResult(imported=0, skipped=0, errors=["CSV missing 'date' column"])

    # Store raw import
    raw_import = RawImport(
        source="bearable",
        filename=filename,
        data={"rows": len(df), "columns": list(df.columns), "raw_csv": csv_content},
    )
    session.add(raw_import)

    # Determine which columns map to metrics
    column_mappings: dict[str, tuple[str, str, str, float, str | None]] = {}
    for col in df.columns:
        if col == "date":
            continue
        mapping = _parse_column(col)
        if mapping is not None:
            column_mappings[col] = mapping

    # Ensure all metric definitions exist
    metric_cache: dict[str, MetricDefinition] = {}
    for col, (name, display_name, source, original_max, category) in column_mappings.items():
        await _get_or_create_metric(
            session, name, display_name, source, original_max, category, metric_cache
        )

    imported = 0
    skipped = 0
    errors: list[str] = []

    for _, row in df.iterrows():
        date_str = row["date"]
        try:
            date_val = pd.to_datetime(date_str).date()
        except (ValueError, TypeError):
            errors.append(f"Invalid date: {date_str}")
            continue

        for col, (name, _, _, original_max, _) in column_mappings.items():
            raw_value = row[col]
            if pd.isna(raw_value):
                skipped += 1
                continue

            try:
                raw_float = float(raw_value)
            except (ValueError, TypeError):
                skipped += 1
                continue

            metric_def = metric_cache[name]
            normalized = max(0.0, min(1.0, raw_float / original_max)) if original_max > 0 else 0.0

            stmt = pg_insert(DailyMetric).values(
                user_sub=user_sub,
                date=date_val,
                metric_id=metric_def.id,
                raw_value=raw_float,
                normalized=normalized,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_daily_metrics_user_date_metric",
                set_={"raw_value": stmt.excluded.raw_value, "normalized": stmt.excluded.normalized},
            )
            await session.execute(stmt)
            imported += 1

    await session.commit()

    return ImportResult(imported=imported, skipped=skipped, errors=errors)
