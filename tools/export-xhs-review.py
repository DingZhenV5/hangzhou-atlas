#!/usr/bin/env python3
"""Export reviewable Xiaohongshu candidate CSVs without temporary URL tokens."""

from __future__ import annotations

import csv
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "generated"
DEST_DIR = ROOT / "research" / "xhs" / "2026-09-30"
FILES = (
    "xhs-batch-2026-09-30.csv",
    "xhs-routes-review.csv",
    "xhs-places-review.csv",
)
URL_PATTERN = re.compile(r"https?://[^\s,;|]+", re.IGNORECASE)


def strip_temporary_query(match: re.Match[str]) -> str:
    raw = match.group(0).rstrip(")]}")
    suffix = match.group(0)[len(raw) :]
    parts = urlsplit(raw)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", "")) + suffix


def clean(value: str | None) -> str:
    return URL_PATTERN.sub(strip_temporary_query, value or "")


def main() -> None:
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    for filename in FILES:
        source = SOURCE_DIR / filename
        destination = DEST_DIR / filename
        with source.open("r", encoding="utf-8-sig", newline="") as src:
            reader = csv.DictReader(src)
            if not reader.fieldnames:
                raise SystemExit(f"CSV has no header: {source}")
            rows = [
                {key: clean(value) for key, value in row.items()}
                for row in reader
            ]
        with destination.open("w", encoding="utf-8-sig", newline="") as dst:
            writer = csv.DictWriter(dst, fieldnames=reader.fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{destination.relative_to(ROOT)}: {len(rows)} rows")


if __name__ == "__main__":
    main()
