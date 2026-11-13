from pathlib import Path
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

df = pd.read_csv(DATA_DIR / "features" / "features_all.csv")

df["season"] = pd.to_numeric(df["season"], errors="coerce")

train_df = df[(df["season"] >= 2008) & (df["season"] <= 2023)].copy()
val_df = df[df["season"] == 2024].copy()
test_df = df[(df["season"] >= 2025) & (df["season"] <= 2026)].copy()

split_dir = DATA_DIR / "split"
split_dir.mkdir(parents=True, exist_ok=True)
train_df.to_csv(split_dir / "train.csv", index=False)
val_df.to_csv(split_dir / "validation.csv", index=False)
test_df.to_csv(split_dir / "test.csv", index=False)

print("Training set:", train_df.shape)
print("Validation set:", val_df.shape)
print("Testing set:", test_df.shape)