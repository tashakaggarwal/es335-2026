"""CLI wrapper around ipl_winprob.parse (kept for backward compatibility)."""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from ipl_winprob.parse import parse_directory  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse Cricsheet IPL JSON files into chase state tables.")
    ap.add_argument("json_dir", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/parsed/overs.csv"))
    ap.add_argument("--include-balls", action="store_true", help="Also write ball-by-ball legal delivery states.")
    args = ap.parse_args()

    overs_df, first_df, log_df, balls_df = parse_directory(args.json_dir, include_balls=args.include_balls)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    overs_df.to_csv(args.out, index=False)
    log_df.to_csv(args.out.parent / "match_log.csv", index=False)
    first_df.to_csv(args.out.parent / "first_innings_states.csv", index=False)
    if args.include_balls:
        balls_df.to_csv(args.out.parent / "balls.csv", index=False)

    print(log_df["status"].value_counts().to_string())
    print(f"\n{overs_df['match_id'].nunique()} matches, {len(overs_df)} over rows -> {args.out}")
    print(f"{first_df['match_id'].nunique()} first innings, {len(first_df)} states -> {args.out.parent / 'first_innings_states.csv'}")
    if args.include_balls:
        print(f"{balls_df['match_id'].nunique()} matches, {len(balls_df)} ball rows -> {args.out.parent / 'balls.csv'}")


if __name__ == "__main__":
    main()
