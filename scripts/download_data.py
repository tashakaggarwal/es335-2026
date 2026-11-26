"""Download and extract the Cricsheet IPL ball-by-ball JSON archive into data/raw/."""

import argparse
import io
import urllib.request
import zipfile
from pathlib import Path

CRICSHEET_IPL_URL = "https://cricsheet.org/downloads/ipl_json.zip"


def download_ipl_data(out_dir: Path, url: str = CRICSHEET_IPL_URL, force: bool = False) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = list(out_dir.glob("*.json"))
    if existing and not force:
        print(f"Found {len(existing)} existing JSON files in {out_dir.resolve()} (use --force to re-download).")
        return len(existing)

    print(f"Downloading Cricsheet IPL archive from {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "ipl-winprob-downloader/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw_bytes = resp.read()
    print(f"Downloaded {len(raw_bytes) / (1024 * 1024):.1f} MB; extracting to {out_dir.resolve()} ...")

    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
        zf.extractall(out_dir)

    count = len(list(out_dir.glob("*.json")))
    print(f"Extracted {count} IPL match JSON files to {out_dir.resolve()}.")
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Cricsheet IPL ball-by-ball JSON archive.")
    parser.add_argument("--out", type=Path, default=Path("data/raw"), help="Output directory for raw JSON files.")
    parser.add_argument("--url", type=str, default=CRICSHEET_IPL_URL, help="Archive URL.")
    parser.add_argument("--force", action="store_true", help="Re-download even if JSON files already exist.")
    args = parser.parse_args()
    download_ipl_data(args.out, url=args.url, force=args.force)


if __name__ == "__main__":
    main()
