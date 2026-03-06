"""Tests for the metrics API aggregation logic.

Tests the pure aggregation functions without requiring a database.
"""

import datetime

from cassiopeia.routers.metrics import Granularity, _aggregate_to_periods, _period_start


class TestPeriodStart:
    def test_day_returns_same_date(self) -> None:
        d = datetime.date(2026, 3, 4)  # Wednesday
        assert _period_start(d, Granularity.day) == d

    def test_week_returns_monday(self) -> None:
        # 2026-03-04 is a Wednesday
        d = datetime.date(2026, 3, 4)
        assert _period_start(d, Granularity.week) == datetime.date(2026, 3, 2)

    def test_week_monday_stays_monday(self) -> None:
        d = datetime.date(2026, 3, 2)  # Monday
        assert _period_start(d, Granularity.week) == datetime.date(2026, 3, 2)

    def test_week_sunday(self) -> None:
        d = datetime.date(2026, 3, 8)  # Sunday
        assert _period_start(d, Granularity.week) == datetime.date(2026, 3, 2)

    def test_month_returns_first(self) -> None:
        d = datetime.date(2026, 3, 15)
        assert _period_start(d, Granularity.month) == datetime.date(2026, 3, 1)

    def test_month_first_stays(self) -> None:
        d = datetime.date(2026, 3, 1)
        assert _period_start(d, Granularity.month) == datetime.date(2026, 3, 1)


class TestAggregateToPeriodsDay:
    def test_empty_rows(self) -> None:
        result = _aggregate_to_periods([], Granularity.day)
        assert result.dates == []
        assert result.series == {}

    def test_single_metric_single_day(self) -> None:
        rows = [(datetime.date(2026, 1, 1), "steps", 0.5)]
        result = _aggregate_to_periods(rows, Granularity.day)
        assert result.dates == ["2026-01-01"]
        assert result.series == {"steps": [0.5]}

    def test_multiple_metrics_multiple_days(self) -> None:
        rows = [
            (datetime.date(2026, 1, 1), "steps", 0.5),
            (datetime.date(2026, 1, 1), "mood", 0.8),
            (datetime.date(2026, 1, 2), "steps", 0.7),
            # mood has no data on Jan 2
            (datetime.date(2026, 1, 3), "mood", 0.6),
            # steps has no data on Jan 3
        ]
        result = _aggregate_to_periods(rows, Granularity.day)
        assert result.dates == ["2026-01-01", "2026-01-02", "2026-01-03"]
        assert result.series["steps"] == [0.5, 0.7, None]
        assert result.series["mood"] == [0.8, None, 0.6]

    def test_dates_are_sorted(self) -> None:
        rows = [
            (datetime.date(2026, 1, 3), "steps", 0.3),
            (datetime.date(2026, 1, 1), "steps", 0.1),
            (datetime.date(2026, 1, 2), "steps", 0.2),
        ]
        result = _aggregate_to_periods(rows, Granularity.day)
        assert result.dates == ["2026-01-01", "2026-01-02", "2026-01-03"]
        assert result.series["steps"] == [0.1, 0.2, 0.3]


class TestAggregateToPeriodsWeek:
    def test_weekly_averaging(self) -> None:
        # Two days in the same week (week of 2026-01-05, Mon)
        rows = [
            (datetime.date(2026, 1, 5), "steps", 0.4),  # Monday
            (datetime.date(2026, 1, 7), "steps", 0.6),  # Wednesday
        ]
        result = _aggregate_to_periods(rows, Granularity.week)
        assert result.dates == ["2026-01-05"]
        assert result.series["steps"] == [0.5]

    def test_two_weeks(self) -> None:
        rows = [
            (datetime.date(2026, 1, 5), "steps", 0.4),   # Week of Jan 5
            (datetime.date(2026, 1, 12), "steps", 0.8),  # Week of Jan 12
        ]
        result = _aggregate_to_periods(rows, Granularity.week)
        assert result.dates == ["2026-01-05", "2026-01-12"]
        assert result.series["steps"] == [0.4, 0.8]

    def test_multiple_metrics_with_gaps(self) -> None:
        rows = [
            (datetime.date(2026, 1, 5), "steps", 0.4),
            (datetime.date(2026, 1, 5), "mood", 0.9),
            (datetime.date(2026, 1, 12), "steps", 0.8),
            # mood has no data in week of Jan 12
        ]
        result = _aggregate_to_periods(rows, Granularity.week)
        assert result.dates == ["2026-01-05", "2026-01-12"]
        assert result.series["steps"] == [0.4, 0.8]
        assert result.series["mood"] == [0.9, None]


class TestAggregateToPeriodsMonth:
    def test_monthly_averaging(self) -> None:
        rows = [
            (datetime.date(2026, 1, 1), "steps", 0.2),
            (datetime.date(2026, 1, 15), "steps", 0.4),
            (datetime.date(2026, 1, 30), "steps", 0.6),
        ]
        result = _aggregate_to_periods(rows, Granularity.month)
        assert result.dates == ["2026-01-01"]
        assert result.series["steps"] == [0.4]

    def test_two_months(self) -> None:
        rows = [
            (datetime.date(2026, 1, 10), "steps", 0.3),
            (datetime.date(2026, 2, 10), "steps", 0.7),
        ]
        result = _aggregate_to_periods(rows, Granularity.month)
        assert result.dates == ["2026-01-01", "2026-02-01"]
        assert result.series["steps"] == [0.3, 0.7]

    def test_multiple_metrics_across_months(self) -> None:
        rows = [
            (datetime.date(2026, 1, 5), "steps", 0.4),
            (datetime.date(2026, 1, 5), "mood", 0.8),
            (datetime.date(2026, 2, 5), "mood", 0.6),
            # steps missing in Feb
        ]
        result = _aggregate_to_periods(rows, Granularity.month)
        assert result.dates == ["2026-01-01", "2026-02-01"]
        assert result.series["steps"] == [0.4, None]
        assert result.series["mood"] == [0.8, 0.6]


class TestRoundingPrecision:
    def test_averages_are_rounded_to_4_decimals(self) -> None:
        rows = [
            (datetime.date(2026, 1, 1), "steps", 0.1),
            (datetime.date(2026, 1, 2), "steps", 0.2),
            (datetime.date(2026, 1, 3), "steps", 0.3),
        ]
        result = _aggregate_to_periods(rows, Granularity.week)
        # All three days are in the same week (week of Dec 29 2025 or Jan 1?)
        # 2026-01-01 is Thursday, so week starts Dec 29
        # 2026-01-02 is Friday (same week), 2026-01-03 is Saturday (same week)
        assert len(result.dates) == 1
        assert result.series["steps"] == [0.2]
