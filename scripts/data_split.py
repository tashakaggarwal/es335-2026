"""CLI wrapper around ipl_winprob.features.split_by_season (chronological season splitter)."""

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from ipl_winprob.features import split_by_season  # noqa: E402


def main() -> None:
    data_dir = ROOT / "data"
    df = pd.read_csv(data_dir / "features" / "features_all.csv", dtype={"match_id": str})
    train_df, val_df, test_df = split_by_season(df, train_end=2023, val_season=2024, test_start=2025)

    split_dir = data_dir / "split"
    split_dir.mkdir(parents=True, exist_ok=True)
    train_df.to_csv(split_dir / "train.csv", index=False)
    val_df.to_csv(split_dir / "validation.csv", index=False)
    test_df.to_csv(split_dir / "test.csv", index=False)

    print("Training set:", train_df.shape)
    print("Validation set:", val_df.shape)
    print("Testing set:", test_df.shape)


if __name__ == "__main__":
    main()
