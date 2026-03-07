"""Garmin CSV import parser.

Parses CSV exports from GarminDB (https://github.com/tcgoetz/GarminDB)
daily summary data and upserts metric data into the database.

Supports column names matching GarminDB's DailySummary table fields.
"""

import io
import logging

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from cassiopeia.models import DailyMetric, MetricDefinition, RawImport
from cassiopeia.schemas import ImportResult

logger = logging.getLogger(__name__)

# GarminDB column name -> (metric_name, display_name, source, original_min, original_max, category)
COLUMN_MAP: dict[str, tuple[str, str, str, float, float, str | None]] = {
    # Steps
    "steps": ("steps", "Schritte", "garmin", 0, 10000, "vitals"),
    # Heart rate
    "rhr": ("resting_hr", "Ruhepuls", "garmin", 30, 100, "vitals"),
    "hr_min": ("hr_min", "Puls Min", "garmin", 30, 120, "vitals"),
    "hr_max": ("hr_max", "Puls Max", "garmin", 60, 200, "vitals"),
    # Body battery
    "bb_max": ("body_battery", "Body Battery", "garmin", 0, 100, "vitals"),
    "bb_min": ("bb_min", "Body Battery Min", "garmin", 0, 100, "vitals"),
    # Stress
    "stress_avg": ("stress", "Stress", "garmin", 0, 100, "vitals"),
    # Sleep
    "total_sleep": ("garmin_total_sleep", "Schlaf Gesamt", "garmin", 0, 600, "sleep"),
    "deep_sleep": ("garmin_deep_sleep", "Tiefschlaf", "garmin", 0, 300, "sleep"),
    "light_sleep": ("garmin_light_sleep", "Leichtschlaf", "garmin", 0, 400, "sleep"),
    "rem_sleep": ("garmin_rem_sleep", "REM-Schlaf", "garmin", 0, 200, "sleep"),
    "score": ("garmin_sleep_score", "Schlafwert (Garmin)", "garmin", 0, 100, "sleep"),
    # SpO2
    "spo2_avg": ("spo2", "SpO2", "garmin", 80, 100, "vitals"),
    # Respiration
    "rr_waking_avg": ("respiration", "Atemfrequenz", "garmin", 8, 30, "vitals"),
    # Calories
    "calories_active": ("calories_active", "Aktive Kalorien", "garmin", 0, 2000, "vitals"),
    # Floors
    "floors_up": ("floors_up", "Stockwerke", "garmin", 0, 30, "vitals"),
    # Distance
    "distance": ("distance", "Distanz", "garmin", 0, 15000, "vitals"),
}

# Alternative column names users might have (e.g. from manual exports or renamed columns)
COLUMN_ALIASES: dict[str, str] = {
    "resting_heart_rate": "rhr",
    "resting_hr": "rhr",
    "body_battery": "bb_max",
    "body_battery_max": "bb_max",
    "body_battery_min": "bb_min",
    "stress": "stress_avg",
    "avg_stress": "stress_avg",
    "sleep_score": "score",
    "spo2": "spo2_avg",
    "avg_spo2": "spo2_avg",
    "respiration_rate": "rr_waking_avg",
}

# Date column detection: GarminDB uses "day", but users might have "date"
DATE_COLUMN_NAMES = ["day", "date", "calendarDate"]


def _find_date_column(columns: list[str]) -> str | None:
    for name in DATE_COLUMN_NAMES:
        if name in columns:
            return name
    return None


def _resolve_column(col: str) -> str:
    """Resolve column aliases to canonical GarminDB names."""
    return COLUMN_ALIASES.get(col, col)


def _parse_sleep_time(value: object) -> float | None:
    """Parse sleep duration values which may be HH:MM:SS strings or minutes."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if ":" in s:
        parts = s.split(":")
        try:
            hours = int(parts[0])
            minutes = int(parts[1])
            return hours * 60.0 + minutes
        except (ValueError, IndexError):
            return None
    try:
        return float(s)
    except ValueError:
        return None


SLEEP_COLUMNS = {"total_sleep", "deep_sleep", "light_sleep", "rem_sleep"}


async def _get_or_create_metric(
    session: AsyncSession,
    name: str,
    display_name: str,
    source: str,
    original_min: float,
    original_max: float,
    category: str | None,
    cache: dict[str, MetricDefinition],
) -> MetricDefinition:
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
            original_min=original_min,
            original_max=original_max,
            category=category,
            is_default=False,
        )
        session.add(metric_def)
        await session.flush()

    cache[name] = metric_def
    return metric_def


async def import_garmin_csv(
    session: AsyncSession,
    csv_content: str,
    user_sub: str,
    filename: str | None = None,
) -> ImportResult:
    """Parse a GarminDB daily summary CSV export and upsert metrics.

    Args:
        session: Active async database session.
        csv_content: Raw CSV text content.
        filename: Optional filename for the raw import record.

    Returns:
        ImportResult with counts of imported, skipped, and errors.
    """
    df = pd.read_csv(io.StringIO(csv_content))

    date_col = _find_date_column(list(df.columns))
    if date_col is None:
        return ImportResult(
            imported=0,
            skipped=0,
            errors=[f"CSV missing date column (expected one of: {', '.join(DATE_COLUMN_NAMES)})"],
        )

    raw_import = RawImport(
        source="garmin",
        filename=filename,
        data={"rows": len(df), "columns": list(df.columns), "raw_csv": csv_content},
    )
    session.add(raw_import)

    # Map CSV columns to metric definitions
    column_mappings: dict[str, tuple[str, str, str, float, float, str | None]] = {}
    for col in df.columns:
        if col == date_col:
            continue
        canonical = _resolve_column(col)
        if canonical in COLUMN_MAP:
            column_mappings[col] = COLUMN_MAP[canonical]

    if not column_mappings:
        return ImportResult(
            imported=0,
            skipped=0,
            errors=["No recognized Garmin metric columns found in CSV"],
        )

    metric_cache: dict[str, MetricDefinition] = {}
    for _col, (name, display_name, source, orig_min, orig_max, category) in column_mappings.items():
        await _get_or_create_metric(
            session, name, display_name, source, orig_min, orig_max, category, metric_cache
        )

    imported = 0
    skipped = 0
    errors: list[str] = []

    for _, row in df.iterrows():
        date_str = row[date_col]
        try:
            date_val = pd.to_datetime(date_str).date()
        except (ValueError, TypeError):
            errors.append(f"Invalid date: {date_str}")
            continue

        for col, (name, _, _, orig_min, orig_max, _) in column_mappings.items():
            canonical = _resolve_column(col)

            # Sleep columns may be in HH:MM:SS format
            if canonical in SLEEP_COLUMNS:
                raw_float_or_none = _parse_sleep_time(row[col])
                if raw_float_or_none is None:
                    skipped += 1
                    continue
                raw_float = raw_float_or_none
            else:
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
            range_size = orig_max - orig_min
            normalized = (
                max(0.0, min(1.0, (raw_float - orig_min) / range_size))
                if range_size > 0
                else 0.0
            )

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
