from datetime import datetime, timezone
from pathlib import Path
from typing import List


REPORTS_DIR = Path("reports")


def current_week_label(now: datetime = None) -> str:
    dt = now or datetime.now(timezone.utc)
    year, week, _ = dt.isocalendar()
    return f"{year}-W{week:02d}"


def list_reports() -> List[str]:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return sorted([p.name for p in REPORTS_DIR.glob("*.md")], reverse=True)


def generate_weekly_report(runs, snapshot_count: int, week_label: str) -> str:
    complete = [r for r in runs if r.get("status") == "complete"]
    failed = [r for r in runs if r.get("status") == "failed"]
    return (
        f"# Weekly Backtest Report ({week_label})\n\n"
        f"- Total snapshots: {snapshot_count}\n"
        f"- Runs (all): {len(runs)}\n"
        f"- Runs complete: {len(complete)}\n"
        f"- Runs failed: {len(failed)}\n"
    )


def save_report(content: str, week_label: str) -> str:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORTS_DIR / f"{week_label}.md"
    path.write_text(content)
    return str(path)

