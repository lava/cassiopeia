import datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from cassiopeia.db import Base


class MetricDefinition(Base):
    __tablename__ = "metric_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    original_min: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    original_max: Mapped[float] = mapped_column(Float, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    daily_metrics: Mapped[list["DailyMetric"]] = relationship(
        back_populates="metric_definition"
    )


class DailyMetric(Base):
    __tablename__ = "daily_metrics"
    __table_args__ = (
        UniqueConstraint("date", "metric_id"),
        Index("idx_daily_metrics_date", "date"),
        Index("idx_daily_metrics_metric_date", "metric_id", "date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    metric_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("metric_definitions.id"), nullable=False
    )
    raw_value: Mapped[float] = mapped_column(Float, nullable=False)
    normalized: Mapped[float] = mapped_column(Float, nullable=False)

    metric_definition: Mapped[MetricDefinition] = relationship(
        back_populates="daily_metrics"
    )


class UserToken(Base):
    __tablename__ = "user_tokens"
    __table_args__ = (UniqueConstraint("user_sub", "service"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_sub: Mapped[str] = mapped_column(String, nullable=False)
    service: Mapped[str] = mapped_column(String, nullable=False)
    token: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class RawImport(Base):
    __tablename__ = "raw_imports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    imported_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    filename: Mapped[str | None] = mapped_column(String, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # type: ignore[type-arg]
