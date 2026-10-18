
import pandas as pd

df = pd.read_csv(r"C:\Users\LEGION\OneDrive\Documents\GitHub\es335-2026\data\processed\overs.csv")

df["season"] = pd.to_numeric(df["season"], errors="coerce")

train_df = df[(df["season"] >= 2008) & (df["season"] <= 2023)].copy()
val_df = df[df["season"] == 2024].copy()
test_df = df[(df["season"] >= 2025) & (df["season"] <= 2026)].copy()

train_df.to_csv(r"C:\Users\LEGION\OneDrive\Documents\GitHub\es335-2026\data\split/train.csv", index=False)
val_df.to_csv(r"C:\Users\LEGION\OneDrive\Documents\GitHub\es335-2026\data\split/validation.csv", index=False)
test_df.to_csv(r"C:\Users\LEGION\OneDrive\Documents\GitHub\es335-2026\data\split/test.csv", index=False)

print("Training set:", train_df.shape)
print("Validation set:", val_df.shape)
print("Testing set:", test_df.shape)