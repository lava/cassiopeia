"""Tests for the Bearable CSV import parser.

Tests the parsing logic independently using pure functions and
mocked database sessions.
"""

from cassiopeia.importers.bearable import _parse_column, _slugify


class TestSlugify:
    def test_simple(self) -> None:
        assert _slugify("Fatigue") == "fatigue"

    def test_spaces_and_special(self) -> None:
        assert _slugify("Brain Fog") == "brain_fog"

    def test_mixed_case(self) -> None:
        assert _slugify("Post-Exertional Malaise") == "post_exertional_malaise"


class TestParseColumn:
    def test_known_mood(self) -> None:
        result = _parse_column("Mood (average)")
        assert result is not None
        name, display, source, max_val, category = result
        assert name == "mood"
        assert source == "bearable"
        assert max_val == 10

    def test_known_energy(self) -> None:
        result = _parse_column("Energy (average)")
        assert result is not None
        assert result[0] == "energy"
        assert result[3] == 5

    def test_known_sleep_quality(self) -> None:
        result = _parse_column("Sleep quality")
        assert result is not None
        assert result[0] == "sleep_quality"
        assert result[3] == 5

    def test_known_tagesform(self) -> None:
        result = _parse_column("Tagesform")
        assert result is not None
        assert result[0] == "daily_form"
        assert result[3] == 100

    def test_known_daily_form(self) -> None:
        result = _parse_column("Daily form")
        assert result is not None
        assert result[0] == "daily_form"

    def test_symptom_column(self) -> None:
        result = _parse_column("Symptom: Fatigue")
        assert result is not None
        name, display, source, max_val, category = result
        assert name == "symptom_fatigue"
        assert display == "Symptom: Fatigue"
        assert source == "bearable"
        assert max_val == 10
        assert category == "symptoms"

    def test_symptom_multi_word(self) -> None:
        result = _parse_column("Symptom: Brain Fog")
        assert result is not None
        assert result[0] == "symptom_brain_fog"

    def test_factor_column(self) -> None:
        result = _parse_column("Factor: Exercise")
        assert result is not None
        name, display, source, max_val, category = result
        assert name == "factor_exercise"
        assert display == "Factor: Exercise"
        assert category == "factors"

    def test_unknown_column_returns_none(self) -> None:
        assert _parse_column("date") is None
        assert _parse_column("some_random_column") is None

    def test_normalization_math(self) -> None:
        """Verify the normalization formula produces correct values."""
        # mood: max 10, value 7 -> 0.7
        _, _, _, max_val, _ = _parse_column("Mood (average)")  # type: ignore[misc]
        raw = 7.0
        normalized = max(0.0, min(1.0, raw / max_val)) if max_val > 0 else 0.0
        assert normalized == 0.7

        # energy: max 5, value 3 -> 0.6
        _, _, _, max_val, _ = _parse_column("Energy (average)")  # type: ignore[misc]
        raw = 3.0
        normalized = max(0.0, min(1.0, raw / max_val)) if max_val > 0 else 0.0
        assert normalized == 0.6

        # daily_form: max 100, value 75 -> 0.75
        _, _, _, max_val, _ = _parse_column("Tagesform")  # type: ignore[misc]
        raw = 75.0
        normalized = max(0.0, min(1.0, raw / max_val)) if max_val > 0 else 0.0
        assert normalized == 0.75

    def test_normalization_clamping(self) -> None:
        """Values exceeding max should clamp to 1.0."""
        _, _, _, max_val, _ = _parse_column("Energy (average)")  # type: ignore[misc]
        raw = 10.0  # exceeds max of 5
        normalized = max(0.0, min(1.0, raw / max_val)) if max_val > 0 else 0.0
        assert normalized == 1.0


class TestCSVColumnDiscovery:
    """Test that a realistic set of CSV columns is handled correctly."""

    def test_all_column_types(self) -> None:
        columns = [
            "date",
            "Mood (average)",
            "Energy (average)",
            "Sleep quality",
            "Tagesform",
            "Symptom: Fatigue",
            "Symptom: Brain Fog",
            "Factor: Exercise",
            "Factor: Meditation",
            "notes",  # should be skipped
        ]

        mapped = {}
        skipped = []
        for col in columns:
            if col == "date":
                continue
            result = _parse_column(col)
            if result is not None:
                mapped[col] = result
            else:
                skipped.append(col)

        # 4 known + 2 symptoms + 2 factors = 8 mapped
        assert len(mapped) == 8
        # 'notes' should be the only skipped column
        assert skipped == ["notes"]

        # Verify unique metric names
        metric_names = [v[0] for v in mapped.values()]
        assert len(metric_names) == len(set(metric_names))
