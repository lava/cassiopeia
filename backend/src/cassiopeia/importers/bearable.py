import re


def _slugify(text: str) -> str:
    """Convert text to snake_case."""
    # Lowercase, replace non-alphanumeric with underscores, collapse multiple underscores
    s = text.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def _parse_column(
    col: str,
) -> tuple[str, str, str, float, str | None] | None:
    """
    Parse a Bearable CSV column name into metric metadata.
    Returns (name, display_name, source, max_val, category) or None.
    """
    if col == "Mood (average)":
        return ("mood", col, "bearable", 10.0, None)
    if col == "Energy (average)":
        return ("energy", col, "bearable", 5.0, None)
    if col == "Sleep quality":
        return ("sleep_quality", col, "bearable", 5.0, None)
    if col in ("Tagesform", "Daily form"):
        return ("daily_form", "Daily form", "bearable", 100.0, None)

    if col.startswith("Symptom: "):
        name = col[len("Symptom: ") :]
        return (f"symptom_{_slugify(name)}", col, "bearable", 10.0, "symptoms")

    if col.startswith("Factor: "):
        name = col[len("Factor: ") :]
        return (f"factor_{_slugify(name)}", col, "bearable", 1.0, "factors")

    return None
