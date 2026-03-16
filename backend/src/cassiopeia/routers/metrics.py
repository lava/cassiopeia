import datetime
from collections import defaultdict
from dataclasses import dataclass
from enum import Enum

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request

from cassiopeia.config import settings
from cassiopeia.db import execute as execute_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


def _get_user_sub(request: Request) -> str:
    user = request.session.get("user")
    if not user or not user.get("sub"):
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return user["sub"]


class Granularity(str, Enum):
    day = "day"
    week = "week"
    month = "month"


@dataclass
class AggregatedMetrics:
    dates: list[str]
    series: dict[str, list[float | None]]


def _period_start(d: datetime.date, granularity: Granularity) -> datetime.date:
    if granularity == Granularity.day:
        return d
    if granularity == Granularity.month:
        return d.replace(day=1)
    if granularity == Granularity.week:
        # ISO week start (Monday)
        return d - datetime.timedelta(days=d.weekday())
    return d


def _aggregate_to_periods(
    rows: list[tuple[datetime.date, str, float]], granularity: Granularity
) -> AggregatedMetrics:
    # period -> metric -> list of values
    period_values: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    all_metrics = set()

    for date, metric_name, value in rows:
        period = _period_start(date, granularity).isoformat()
        period_values[period][metric_name].append(value)
        all_metrics.add(metric_name)

    sorted_dates = sorted(period_values.keys())
    sorted_metrics = sorted(all_metrics)

    series: dict[str, list[float | None]] = {}
    for metric in sorted_metrics:
        series[metric] = []
        for period in sorted_dates:
            vals = period_values[period].get(metric)
            if vals:
                avg = sum(vals) / len(vals)
                series[metric].append(round(avg, 4))
            else:
                series[metric].append(None)

    return AggregatedMetrics(dates=sorted_dates, series=series)


@router.get("")
async def get_metrics(
    request: Request,
    metrics: str,  # comma-separated
    from_date: str,
    to_date: str,
    granularity: Granularity = Granularity.day,
) -> AggregatedMetrics:
    """Get aggregated metrics for the current user."""
    user_sub = _get_user_sub(request)

    # 1. Look up user's database URL
    rows = await execute_admin(
        "SELECT db_url FROM turso_databases WHERE user_sub = ?", [user_sub]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No sync database provisioned.")

    db_url = rows[0]["db_url"]
    db_name = db_url.split("//")[1].split("-")[0]  # Extract name from URL

    # 2. Get a short-lived token
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {settings.turso_api_token}"},
        timeout=15,
    ) as client:
        resp = await client.post(
            f"https://api.turso.tech/v1/organizations/{settings.turso_org}/databases/{db_name}/auth/tokens",
            json={"expiration": "1h"},
        )
        if not resp.is_success:
            raise HTTPException(
                status_code=502, detail="Failed to generate sync credentials."
            )
        jwt = resp.json().get("jwt", "")

    # 3. Query the user database
    metric_names = [m.strip() for m in metrics.split(",") if m.strip()]
    if not metric_names:
        return AggregatedMetrics(dates=[], series={})

    placeholders = ", ".join(["?"] * len(metric_names))
    sql = f"""
        SELECT dm.date, md.name as metric_name, dm.normalized
        FROM daily_metrics dm
        JOIN metric_definitions md ON dm.metric_id = md.id
        WHERE md.name IN ({placeholders})
          AND dm.date >= ? AND dm.date <= ?
        ORDER BY dm.date
    """
    args = metric_names + [from_date, to_date]

    # Use pipeline API for the user database
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://{db_name}-{settings.turso_org}.turso.io/v2/pipeline",
                headers={"Authorization": f"Bearer {jwt}"},
                json={
                    "requests": [
                        {
                            "type": "execute",
                            "stmt": {
                                "sql": sql,
                                "args": [
                                    {"type": "text", "value": str(a)} for a in args
                                ],
                            },
                        },
                        {"type": "close"},
                    ]
                },
            )
            resp.raise_for_status()
            data = resp.json()
            result = data["results"][0]["response"]["result"]
            rows_data = result.get("rows", [])

            # Convert to (date, name, value) tuples
            parsed_rows = []
            for r in rows_data:
                # date is at index 0, metric_name at index 1, normalized at index 2
                date_str = r[0]["value"]
                name = r[1]["value"]
                val = float(r[2]["value"])
                parsed_rows.append(
                    (datetime.date.fromisoformat(date_str), name, val)
                )

            return _aggregate_to_periods(parsed_rows, granularity)

    except Exception as e:
        logger.error("Failed to query user database: %s", e)
        raise HTTPException(status_code=502, detail="Failed to query sync database.")
