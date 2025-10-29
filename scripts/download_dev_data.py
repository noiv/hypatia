#!/usr/bin/env python3
"""
Download ECMWF weather data using the official ecmwf-opendata client.

Downloads analysis data (0h forecast) for specified date range.
Automatically adds wrapping column for dateline continuity.

Output: public/data/{param}/{date}_{cycle}.bin
Format: fp16 binary, 1441 × 721 grid (includes wrapping column)

Usage:
  python download_dev_data.py           # Download ±1 days (default)
  python download_dev_data.py --delta 3 # Download ±3 days
  python download_dev_data.py --delta 0 # Download only today
"""

import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
import argparse
import sys
import urllib.request
import xml.etree.ElementTree as ET

try:
    from ecmwf.opendata import Client
except ImportError:
    print("ERROR: ecmwf-opendata not installed. Install with: pip install ecmwf-opendata")
    sys.exit(1)

DATA_DIR = Path("public/data")

# Parameters to download
PARAMS = {
    'temp2m': '2t',      # 2m temperature
    'wind10m_u': '10u',  # 10m U wind component
    'wind10m_v': '10v',  # 10m V wind component
    'pratesfc': 'tprate' # Total precipitation rate (kg/m²/s)
}

S3_BUCKET_URL = 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com'

def discover_latest_ecmwf_run():
    """
    Discover the latest available ECMWF run by querying S3 bucket.
    Also verifies that forecast data is available (not just analysis).
    Returns: (date, cycle) tuple or None
    """
    today = datetime.utcnow()

    # Try today first, then yesterday
    for days_back in range(2):
        check_date = today - timedelta(days=days_back)
        date_str = check_date.strftime('%Y%m%d')

        try:
            cycles = get_available_cycles(date_str)

            # Check cycles in reverse order (most recent first)
            for cycle in reversed(cycles):
                # Verify this run has forecast data available
                if check_forecast_available(date_str, cycle):
                    return (date_str, cycle)
                else:
                    print(f"  ⚠️  {date_str} {cycle} exists but forecasts not ready yet")
        except Exception as e:
            print(f"  ⚠️  Failed to check {date_str}: {e}")

    return None

def check_forecast_available(date_str: str, cycle: str) -> bool:
    """
    Check if a run has forecast data available (not just analysis).
    Tests if +36h forecast exists for temp2m.
    """
    # Determine stream type
    hour = int(cycle[:-1])
    stream = 'scda' if hour in [6, 18] else 'oper'

    # Try to check if +36h forecast exists
    url = f"https://data.ecmwf.int/forecasts/{date_str}/{cycle}/ifs/0p25/{stream}/{date_str}{hour:02d}0000-36h-{stream}-fc.index"

    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return response.status == 200
    except:
        return False

def get_available_cycles(date_str: str):
    """
    Query S3 bucket to get available cycles for a date.
    Returns: list of cycle strings like ['00z', '06z', '12z']
    """
    url = f"{S3_BUCKET_URL}/?prefix={date_str}/&delimiter=/&max-keys=10"

    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            xml_data = response.read().decode('utf-8')

        # Parse XML to extract cycles from CommonPrefixes
        # Format: <Prefix>20251029/00z/</Prefix>
        root = ET.fromstring(xml_data)

        cycles = []
        # XML namespace handling
        ns = {'s3': 'http://s3.amazonaws.com/doc/2006-03-01/'}

        for prefix_elem in root.findall('.//s3:CommonPrefixes/s3:Prefix', ns):
            prefix = prefix_elem.text
            # Extract cycle from format: "20251029/00z/"
            parts = prefix.strip('/').split('/')
            if len(parts) == 2 and parts[1].endswith('z'):
                cycles.append(parts[1])

        # Sort cycles chronologically
        return sorted(cycles)

    except Exception as e:
        raise Exception(f"S3 query failed: {e}")

def download_timestep(date: str, cycle: str):
    """Download all parameters for one timestep using ecmwf-opendata client"""
    print(f"\nDownloading {date} {cycle}")

    # Parse date and cycle
    year = int(date[:4])
    month = int(date[4:6])
    day = int(date[6:8])
    hour = int(cycle[:-1])  # Remove 'z' suffix

    # Create datetime for this timestep
    dt = datetime(year, month, day, hour, 0, 0)

    # Initialize client
    client = Client(source="ecmwf")

    # Download each parameter
    for param_name, param_code in PARAMS.items():
        print(f"  {param_name} ({param_code})", end=' ... ')

        try:
            # Create temporary file for download
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.grib2', delete=False) as tmp:
                temp_path = tmp.name

            # Request data from ECMWF OpenData
            # Downloads to file, then we load it
            client.retrieve(
                time=hour,
                date=dt.strftime('%Y-%m-%d'),
                step=0,  # Analysis (0h forecast)
                type="fc",  # Forecast type (includes analysis at step 0)
                param=[param_code],
                target=temp_path
            )

            # Load the GRIB file using xarray
            import xarray as xr
            ds = xr.open_dataset(temp_path, engine='cfgrib')

            # Extract the data array
            # The variable name might be different, so we get the first data variable
            data_vars = list(ds.data_vars.keys())
            if not data_vars:
                print("ERROR: No data variables in result")
                ds.close()
                Path(temp_path).unlink()
                continue

            data_array = ds[data_vars[0]]

            # Convert to numpy array
            values = data_array.values

            # Close dataset and clean up temp file
            ds.close()
            Path(temp_path).unlink()

            # Verify shape (should be 721 x 1440 for 0.25° resolution)
            if values.shape != (721, 1440):
                print(f"ERROR: Wrong shape {values.shape}, expected (721, 1440)")
                continue

            # Add wrapping column (copy first column to end)
            # This handles dateline continuity for texture sampling
            values_wrapped = np.hstack([values, values[:, 0:1]])

            # Convert to fp16 for efficient storage
            fp16_data = values_wrapped.astype(np.float16)

            # Create parameter subdirectory
            param_dir = DATA_DIR / param_name
            param_dir.mkdir(parents=True, exist_ok=True)

            # Save as binary with simplified name: {date}_{cycle}.bin
            output_file = param_dir / f"{date}_{cycle}.bin"
            fp16_data.tofile(output_file)

            output_size = output_file.stat().st_size / 1024 / 1024
            print(f"OK ({output_size:.1f} MB)")

        except Exception as e:
            print(f"ERROR: {e}")

    return True

def generate_date_list(days_before: int, days_after: int) -> list:
    """Generate list of dates (today ± N days)"""
    from datetime import timezone
    today = datetime.now(timezone.utc).date()
    dates = []

    for offset in range(-days_before, days_after + 1):
        date = today + timedelta(days=offset)
        dates.append(date.strftime('%Y%m%d'))

    return dates

def download_latest_forecasts(latest_run_date: str, latest_run_cycle: str, target_count: int):
    """
    Download forecast hours from the latest run to complete the dataset.
    Only downloads timesteps that don't already exist.
    """
    print(f"\n📈 Extending with forecasts from latest run: {latest_run_date} {latest_run_cycle}")

    # Parse latest run time
    year = int(latest_run_date[:4])
    month = int(latest_run_date[4:6])
    day = int(latest_run_date[6:8])
    hour = int(latest_run_cycle[:-1])

    from datetime import timezone
    run_time = datetime(year, month, day, hour, 0, 0, tzinfo=timezone.utc)

    # Check existing files to see what timesteps we have
    existing_times = set()
    temp2m_dir = DATA_DIR / 'temp2m'
    if temp2m_dir.exists():
        for f in temp2m_dir.glob('*.bin'):
            # Parse filename: {date}_{cycle}.bin
            parts = f.stem.split('_')
            if len(parts) == 2:
                file_date, file_cycle = parts
                file_year = int(file_date[:4])
                file_month = int(file_date[4:6])
                file_day = int(file_date[6:8])
                file_hour = int(file_cycle[:-1])
                file_time = datetime(file_year, file_month, file_day, file_hour, 0, 0, tzinfo=timezone.utc)
                existing_times.add(file_time)

    print(f"   Current timesteps: {len(existing_times)}")
    print(f"   Target timesteps: {target_count}")

    if len(existing_times) >= target_count:
        print(f"   ✅ Already have {len(existing_times)} timesteps, no forecast download needed")
        return

    needed = target_count - len(existing_times)
    print(f"   Need {needed} more timesteps from forecasts")

    # Download forecast hours (6h, 12h, 18h, 24h, etc.) until we have enough
    forecast_hour = 6
    downloaded = 0

    while downloaded < needed and forecast_hour <= 240:  # ECMWF forecasts up to 10 days
        forecast_time = run_time + timedelta(hours=forecast_hour)

        # Only download on 6-hour boundaries (00z, 06z, 12z, 18z)
        if forecast_time.hour % 6 != 0:
            forecast_hour += 6
            continue

        # Format as date_cycle for filename
        forecast_date = forecast_time.strftime('%Y%m%d')
        forecast_cycle = f"{forecast_time.hour:02d}z"

        # Check if ANY parameter is missing this timestep
        skip_download = True
        for param_name in PARAMS.keys():
            param_dir = DATA_DIR / param_name
            output_file = param_dir / f"{forecast_date}_{forecast_cycle}.bin"
            if not output_file.exists():
                skip_download = False
                break

        # Skip if all parameters already have this timestep
        if skip_download and forecast_time in existing_times:
            forecast_hour += 6
            continue

        print(f"\n   Downloading +{forecast_hour}h → {forecast_date} {forecast_cycle}")

        # Download this forecast hour
        if download_forecast_step(latest_run_date, latest_run_cycle, forecast_hour, forecast_date, forecast_cycle):
            downloaded += 1
            existing_times.add(forecast_time)

        forecast_hour += 6

    print(f"\n   ✅ Downloaded {downloaded} forecast timesteps")

def download_forecast_step(run_date: str, run_cycle: str, step: int, output_date: str, output_cycle: str):
    """Download a specific forecast step from a model run"""
    year = int(run_date[:4])
    month = int(run_date[4:6])
    day = int(run_date[6:8])
    hour = int(run_cycle[:-1])

    dt = datetime(year, month, day, hour, 0, 0)
    client = Client(source="ecmwf")

    for param_name, param_code in PARAMS.items():
        print(f"      {param_name} ({param_code})", end=' ... ')

        try:
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.grib2', delete=False) as tmp:
                temp_path = tmp.name

            client.retrieve(
                time=hour,
                date=dt.strftime('%Y-%m-%d'),
                step=step,
                type="fc",
                param=[param_code],
                target=temp_path
            )

            import xarray as xr
            ds = xr.open_dataset(temp_path, engine='cfgrib')
            data_vars = list(ds.data_vars.keys())

            if not data_vars:
                print("ERROR: No data variables")
                ds.close()
                Path(temp_path).unlink()
                continue

            values = ds[data_vars[0]].values
            ds.close()
            Path(temp_path).unlink()

            if values.shape != (721, 1440):
                print(f"ERROR: Wrong shape {values.shape}")
                continue

            values_wrapped = np.hstack([values, values[:, 0:1]])
            fp16_data = values_wrapped.astype(np.float16)

            param_dir = DATA_DIR / param_name
            param_dir.mkdir(parents=True, exist_ok=True)

            output_file = param_dir / f"{output_date}_{output_cycle}.bin"
            fp16_data.tofile(output_file)

            output_size = output_file.stat().st_size / 1024 / 1024
            print(f"OK ({output_size:.1f} MB)")

        except Exception as e:
            print(f"ERROR: {e}")
            return False

    return True

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(
        description='Download ECMWF weather data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s              Download ±1 days (default, 12 timesteps)
  %(prog)s --delta 3    Download ±3 days (28 timesteps)
  %(prog)s --delta 0    Download only today (4 timesteps)

Strategy:
  Downloads analysis data (step=0) for past cycles, then extends
  with forecast data from the latest available run to complete
  the target number of timesteps (delta * 2 + 1 days * 4 cycles/day).
        """
    )
    parser.add_argument(
        '--delta',
        type=int,
        default=1,
        metavar='N',
        help='Number of days before and after today (default: 1)'
    )
    args = parser.parse_args()

    print("=" * 60)
    print("ECMWF Data Downloader (using ecmwf-opendata)")
    print("=" * 60)

    # Calculate target timesteps: (delta * 2 + 1) days * 4 cycles per day
    target_timesteps = (args.delta * 2 + 1) * 4

    # Generate date list for analysis data (past runs)
    dates = generate_date_list(days_before=args.delta, days_after=0)  # Only past and today
    cycles = ['00z', '06z', '12z', '18z']

    total_analysis = len(dates) * len(cycles)
    success = 0

    print(f"\nTarget: {target_timesteps} timesteps (±{args.delta} days)")
    print(f"Strategy: Download {total_analysis} analysis timesteps, then extend with forecasts")
    print(f"Parameters: {', '.join(PARAMS.keys())}")
    print(f"Output: {DATA_DIR.absolute()}")
    print()

    # Download analysis timesteps (past data)
    print("📥 Downloading analysis data (step=0)...")
    for date in dates:
        for cycle in cycles:
            if download_timestep(date, cycle):
                success += 1

    print(f"\n✅ Downloaded {success}/{total_analysis} analysis timesteps")

    # Determine latest available run for forecast data
    # Query S3 bucket to find which runs actually exist on ECMWF
    print("\n🔍 Discovering latest ECMWF run...")
    latest_run = discover_latest_ecmwf_run()

    if not latest_run:
        print("❌ Could not discover latest ECMWF run, cannot extend with forecasts")
        return 1

    print(f"✅ Latest run found: {latest_run[0]} {latest_run[1]}")

    # Download forecast data to complete the target
    download_latest_forecasts(latest_run[0], latest_run[1], target_timesteps)

    print()
    print("=" * 60)
    print(f"Final Dataset Summary")
    print(f"Output directory: {DATA_DIR.absolute()}")

    # List generated files per parameter
    for param_name in PARAMS.keys():
        param_dir = DATA_DIR / param_name
        if param_dir.exists():
            files = sorted(param_dir.glob("*.bin"))
            if files:
                total_size = sum(f.stat().st_size for f in files)
                print(f"  {param_name}: {len(files)} files ({total_size / 1024 / 1024:.1f} MB)")

    print("=" * 60)

    return 0

if __name__ == '__main__':
    sys.exit(main())
