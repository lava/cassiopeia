from pydantic import BaseModel, ConfigDict


class MetricDefinitionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    display_name: str
    source: str
    original_min: float
    original_max: float
    category: str | None
    is_default: bool


class DailyMetricDataPoint(BaseModel):
    date: str
    value: float


class MetricsDataResponse(BaseModel):
    dates: list[str]
    series: dict[str, list[float | None]]


class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[str]
