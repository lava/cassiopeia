"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "metric_definitions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("original_min", sa.Float(), nullable=False),
        sa.Column("original_max", sa.Float(), nullable=False),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "daily_metrics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("metric_id", sa.Integer(), nullable=False),
        sa.Column("raw_value", sa.Float(), nullable=False),
        sa.Column("normalized", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["metric_id"], ["metric_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("date", "metric_id"),
    )
    op.create_index("idx_daily_metrics_date", "daily_metrics", ["date"])
    op.create_index(
        "idx_daily_metrics_metric_date", "daily_metrics", ["metric_id", "date"]
    )

    op.create_table(
        "raw_imports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("raw_imports")
    op.drop_index("idx_daily_metrics_metric_date", table_name="daily_metrics")
    op.drop_index("idx_daily_metrics_date", table_name="daily_metrics")
    op.drop_table("daily_metrics")
    op.drop_table("metric_definitions")
