#!/usr/bin/env python3
"""
Download ECMWF weather data and convert to fp16 format.

Creates 120 files:
  - 2 parameters (temp2m, wind10m)
  - 15 days (today ± 7 days)
  - 4 cycles per day (00z, 06z, 12z, 18z)

Output: public/data/{date}_{cycle}_{forecast}_{param}.bin
Format: fp16 binary, 1440 × 721 grid
"""

import requests
import json
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
import tempfile
import sys

try:
    import pygrib
except ImportError:
    print("ERROR: pygrib not installed. Install with: pip install pygrib")
    sys.exit(1)

BASE_URL = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com"
DATA_DIR = Path("public/data")
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Parameters to download
PARAMS = {
    'temp2m': {'ecmwf_code': '2t', 'levtype': 'sfc'},
    'wind10m_u': {'ecmwf_code': '10u', 'levtype': 'sfc'},
    'wind10m_v': {'ecmwf_code': '10v', 'levtype': 'sfc'}
}

def fetch_index(date: str, cycle: str, forecast: str) -> list:
    """Fetch index file from ECMWF S3"""
    path = f"{date}/{cycle}/ifs/0p25/oper/{date}000000-{forecast}-oper-fc.index"
    url = f"{BASE_URL}/{path}"

    print(f"  Fetching index: {cycle} +{forecast}")
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()

    return [json.loads(line) for line in resp.text.strip().split('\n')]

def download_parameter(date: str, cycle: str, forecast: str, param_info: dict) -> bytes:
    """Download single parameter via Range request"""
    path = f"{date}/{cycle}/ifs/0p25/oper/{date}000000-{forecast}-oper-fc.grib2"
    url = f"{BASE_URL}/{path}"

    start = param_info['_offset']
    end = start + param_info['_length'] - 1

    headers = {'Range': f'bytes={start}-{end}'}
    resp = requests.get(url, headers=headers, timeout=60)
    resp.raise_for_status()

    return resp.content

def parse_grib2(data: bytes) -> np.ndarray:
    """Parse GRIB2 message and extract values"""
    # Save to temp file (pygrib needs a file)
    with tempfile.NamedTemporaryFile(suffix='.grib2', delete=False) as f:
        f.write(data)
        temp_path = f.name

    try:
        grbs = pygrib.open(temp_path)
        grb = grbs[1]  # First (only) message
        values = grb.values
        grbs.close()
    finally:
        Path(temp_path).unlink()

    return values

def download_timestep(date: str, cycle: str, forecast: str):
    """Download all parameters for one timestep"""
    print(f"\nDownloading {date} {cycle} +{forecast}")

    # Get index
    try:
        index = fetch_index(date, cycle, forecast)
    except Exception as e:
        print(f"  ERROR: Failed to fetch index: {e}")
        return False

    # Download each parameter
    for param_name, param_config in PARAMS.items():
        ecmwf_code = param_config['ecmwf_code']
        levtype = param_config['levtype']

        # Find parameter in index
        entry = next((e for e in index
                     if e['param'] == ecmwf_code and e['levtype'] == levtype), None)

        if not entry:
            print(f"  WARNING: {param_name} ({ecmwf_code}) not found in index")
            continue

        size_mb = entry['_length'] / 1024 / 1024
        print(f"  {param_name}: {size_mb:.2f} MB", end=' ... ')

        try:
            # Download
            grib_data = download_parameter(date, cycle, forecast, entry)

            # Parse
            values = parse_grib2(grib_data)

            # Verify shape
            if values.shape != (721, 1440):
                print(f"ERROR: Wrong shape {values.shape}, expected (721, 1440)")
                continue

            # Convert to fp16
            fp16_data = values.astype(np.float16)

            # Save as binary
            output_file = DATA_DIR / f"{date}_{cycle}_{forecast}_{param_name}.bin"
            fp16_data.tofile(output_file)

            output_size = output_file.stat().st_size / 1024 / 1024
            print(f"OK ({output_size:.2f} MB)")

        except Exception as e:
            print(f"ERROR: {e}")

    return True

def generate_date_list(days_before: int, days_after: int) -> list:
    """Generate list of dates (today ± N days)"""
    today = datetime.utcnow().date()
    dates = []

    for offset in range(-days_before, days_after + 1):
        date = today + timedelta(days=offset)
        dates.append(date.strftime('%Y%m%d'))

    return dates

def main():
    print("=" * 60)
    print("ECMWF Data Downloader")
    print("=" * 60)

    # Generate date list (15 days: today ± 7)
    dates = generate_date_list(days_before=7, days_after=7)
    cycles = ['00z', '06z', '12z', '18z']
    forecasts = ['0h']  # For milestone, just analysis (0h forecast)

    total = len(dates) * len(cycles) * len(forecasts)
    success = 0

    print(f"\nWill download {total} timesteps")
    print(f"Parameters: {', '.join(PARAMS.keys())}")
    print(f"Output: {DATA_DIR.absolute()}")
    print()

    # Download all timesteps
    for date in dates:
        for cycle in cycles:
            for forecast in forecasts:
                if download_timestep(date, cycle, forecast):
                    success += 1

    print()
    print("=" * 60)
    print(f"Downloaded {success}/{total} timesteps successfully")
    print(f"Output directory: {DATA_DIR.absolute()}")

    # List generated files
    files = sorted(DATA_DIR.glob("*.bin"))
    total_size = sum(f.stat().st_size for f in files)
    print(f"Total files: {len(files)}")
    print(f"Total size: {total_size / 1024 / 1024:.1f} MB")
    print("=" * 60)

if __name__ == '__main__':
    main()
