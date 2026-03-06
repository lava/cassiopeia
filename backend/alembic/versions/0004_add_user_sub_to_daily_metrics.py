"""add user_sub to daily_metrics

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-07

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add user_sub column as nullable first so existing rows don't break
    op.add_column("daily_metrics", sa.Column("user_sub", sa.String(), nullable=True))

    # Backfill existing rows: assign to the first user found, or a placeholder
    conn = op.get_bind()
    result = conn.execute(sa.text("SELECT sub FROM users ORDER BY id LIMIT 1"))
    row = result.fetchone()
    default_sub = row[0] if row else "unknown"
    conn.execute(
        sa.text("UPDATE daily_metrics SET user_sub = :sub WHERE user_sub IS NULL"),
        {"sub": default_sub},
    )

    # Now make it NOT NULL
    op.alter_column("daily_metrics", "user_sub", nullable=False)

    # Drop old unique constraint and indexes, create new ones
    op.drop_constraint("daily_metrics_date_metric_id_key", "daily_metrics", type_="unique")
    op.drop_index("idx_daily_metrics_date", table_name="daily_metrics")
    op.drop_index("idx_daily_metrics_metric_date", table_name="daily_metrics")

    op.create_unique_constraint(
        "uq_daily_metrics_user_date_metric",
        "daily_metrics",
        ["user_sub", "date", "metric_id"],
    )
    op.create_index(
        "idx_daily_metrics_user_date", "daily_metrics", ["user_sub", "date"]
    )
    op.create_index(
        "idx_daily_metrics_user_metric_date",
        "daily_metrics",
        ["user_sub", "metric_id", "date"],
    )


def downgrade() -> None:
    op.drop_index("idx_daily_metrics_user_metric_date", table_name="daily_metrics")
    op.drop_index("idx_daily_metrics_user_date", table_name="daily_metrics")
    op.drop_constraint(
        "uq_daily_metrics_user_date_metric", "daily_metrics", type_="unique"
    )

    op.create_unique_constraint(
        "daily_metrics_date_metric_id_key", "daily_metrics", ["date", "metric_id"]
    )
    op.create_index("idx_daily_metrics_date", "daily_metrics", ["date"])
    op.create_index(
        "idx_daily_metrics_metric_date", "daily_metrics", ["metric_id", "date"]
    )

    op.drop_column("daily_metrics", "user_sub")
