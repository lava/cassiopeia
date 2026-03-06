from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cassiopeia.models import MetricDefinition

DEFAULT_METRICS = [
    {
        "name": "steps",
        "display_name": "Schritte",
        "source": "garmin",
        "original_min": 0,
        "original_max": 10000,
        "is_default": True,
    },
    {
        "name": "sleep_score",
        "display_name": "Schlafwert",
        "source": "oura",
        "original_min": 0,
        "original_max": 100,
        "is_default": True,
    },
    {
        "name": "daily_form",
        "display_name": "Tagesform",
        "source": "bearable",
        "original_min": 0,
        "original_max": 100,
        "is_default": True,
    },
    {
        "name": "mood",
        "display_name": "Stimmung",
        "source": "bearable",
        "original_min": 0,
        "original_max": 10,
        "is_default": True,
    },
    {
        "name": "energy",
        "display_name": "Energie",
        "source": "bearable",
        "original_min": 0,
        "original_max": 5,
        "is_default": True,
    },
]


async def seed_default_metrics(session: AsyncSession) -> None:
    """Insert default metrics if they don't exist yet."""
    result = await session.execute(
        select(MetricDefinition.name).where(
            MetricDefinition.name.in_([m["name"] for m in DEFAULT_METRICS])
        )
    )
    existing_names = set(result.scalars().all())

    for metric_data in DEFAULT_METRICS:
        if metric_data["name"] not in existing_names:
            session.add(MetricDefinition(**metric_data))

    await session.commit()
