"""Metrics API routes for definitions and time-series data."""

import datetime
from enum import Enum
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cassiopeia.db import get_db
from cassiopeia.models import DailyMetric, MetricDefinition
from cassiopeia.schemas import MetricDefinitionSchema, MetricsDataResponse

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


class Granularity(str, Enum):
    day = "day"
    week = "week"
    month = "month"


def _period_start(date: datetime.date, granularity: Granularity) -> datetime.date:
    """Return the first day of the period containing the given date."""
    if granularity == Granularity.week:
        # Monday of the ISO week
        return date - datetime.timedelta(days=date.weekday())
    elif granularity == Granularity.month:
        return date.replace(day=1)
    return date


def _aggregate_to_periods(
    rows: list[tuple[datetime.date, str, float]],
    granularity: Granularity,
) -> MetricsDataResponse:
    """Aggregate rows (date, metric_name, normalized) into a MetricsDataResponse.

    For day granularity, data is returned as-is.
    For week/month, values are averaged per period per metric.
    """
    # Group values by (period_start, metric_name)
    from collections import defaultdict

    period_values: dict[datetime.date, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    all_metrics: set[str] = set()

    for date, metric_name, normalized in rows:
        period = _period_start(date, granularity)
        period_values[period][metric_name].append(normalized)
        all_metrics.add(metric_name)

    # Build sorted date list (union of all periods)
    sorted_dates = sorted(period_values.keys())
    date_strings = [d.isoformat() for d in sorted_dates]

    # Build series with null for missing data
    series: dict[str, list[float | None]] = {}
    for metric_name in sorted(all_metrics):
        values: list[float | None] = []
        for date in sorted_dates:
            metric_vals = period_values[date].get(metric_name)
            if metric_vals:
                avg = sum(metric_vals) / len(metric_vals)
                values.append(round(avg, 4))
            else:
                values.append(None)
        series[metric_name] = values

    return MetricsDataResponse(dates=date_strings, series=series)


@router.get("", response_model=list[MetricDefinitionSchema])
async def list_metrics(
    session: AsyncSession = Depends(get_db),
) -> list[MetricDefinitionSchema]:
    """Return all metric definitions."""
    result = await session.execute(select(MetricDefinition))
    definitions = result.scalars().all()
    return [MetricDefinitionSchema.model_validate(d) for d in definitions]


@router.get("/data", response_model=MetricsDataResponse)
async def get_metrics_data(
    metrics: Annotated[str, Query(description="Comma-separated metric names")],
    from_date: Annotated[datetime.date, Query(alias="from", description="Start date")],
    to_date: Annotated[datetime.date, Query(alias="to", description="End date")],
    granularity: Annotated[Granularity, Query()] = Granularity.day,
    session: AsyncSession = Depends(get_db),
) -> MetricsDataResponse:
    """Return time-series data for the requested metrics and date range."""
    metric_names = [m.strip() for m in metrics.split(",") if m.strip()]

    stmt = (
        select(DailyMetric.date, MetricDefinition.name, DailyMetric.normalized)
        .join(MetricDefinition, DailyMetric.metric_id == MetricDefinition.id)
        .where(
            MetricDefinition.name.in_(metric_names),
            DailyMetric.date >= from_date,
            DailyMetric.date <= to_date,
        )
        .order_by(DailyMetric.date)
    )

    result = await session.execute(stmt)
    rows: list[tuple[datetime.date, str, float]] = [
        (row[0], row[1], row[2]) for row in result.all()
    ]

    return _aggregate_to_periods(rows, granularity)
