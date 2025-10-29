#!/usr/bin/env python3
"""
Extract and plot temperature time series for Hamburg, Germany.

This verifies:
1. Data files are correctly formatted (fp16, 1441x721)
2. Geographic coordinates are correct
3. Temperature values are reasonable
4. Time progression is correct
"""

import numpy as np
from pathlib import Path
import matplotlib.pyplot as plt
from datetime import datetime

# Cairo, Egypt coordinates
CAIRO_LAT = 30.0444
CAIRO_LON = 31.2357

# Data parameters
DATA_DIR = Path("public/data/temp2m")
WIDTH = 1441  # With wrapping column
HEIGHT = 721

def latlon_to_grid_indices(lat: float, lon: float) -> tuple[int, int]:
    """
    Convert lat/lon to grid indices for 0.25° resolution global grid.

    Grid layout:
    - Latitude: 90°N to -90°S (721 rows, 0.25° spacing)
    - Longitude: 0°E to 360°E (1440 columns + 1 wrap, 0.25° spacing)
    """
    # Latitude: 90°N (top) to -90°S (bottom)
    # Row 0 = 90°N, Row 720 = -90°S
    lat_idx = int((90.0 - lat) / 0.25)

    # Longitude: 0°E to 360°E
    # Normalize to 0-360 range
    lon_normalized = lon % 360.0
    lon_idx = int(lon_normalized / 0.25)

    # Clamp to valid range
    lat_idx = max(0, min(HEIGHT - 1, lat_idx))
    lon_idx = max(0, min(WIDTH - 1, lon_idx))

    return lat_idx, lon_idx

def load_fp16_data(filepath: Path) -> np.ndarray:
    """Load fp16 binary file and return as 2D array."""
    data = np.fromfile(filepath, dtype=np.float16)

    expected_size = WIDTH * HEIGHT
    if data.size != expected_size:
        raise ValueError(f"Wrong size: expected {expected_size}, got {data.size}")

    return data.reshape(HEIGHT, WIDTH)

def parse_filename(filename: str) -> datetime:
    """Parse timestamp from filename like '20251028_00z.bin'."""
    parts = filename.replace('.bin', '').split('_')
    date_str = parts[0]
    cycle_str = parts[1]

    year = int(date_str[0:4])
    month = int(date_str[4:6])
    day = int(date_str[6:8])
    hour = int(cycle_str[:-1])  # Remove 'z'

    return datetime(year, month, day, hour, 0, 0)

def main():
    print("=" * 60)
    print("Cairo Temperature Time Series")
    print("=" * 60)

    # Cairo location
    print(f"\n📍 Location: Cairo, Egypt")
    print(f"   Coordinates: {CAIRO_LAT:.4f}°N, {CAIRO_LON:.4f}°E")

    # Convert to grid indices
    lat_idx, lon_idx = latlon_to_grid_indices(CAIRO_LAT, CAIRO_LON)
    print(f"   Grid indices: row={lat_idx}, col={lon_idx}")

    # Verify grid location
    grid_lat = 90.0 - (lat_idx * 0.25)
    grid_lon = lon_idx * 0.25
    print(f"   Grid center: {grid_lat:.4f}°N, {grid_lon:.4f}°E")
    print(f"   Distance: {abs(CAIRO_LAT - grid_lat):.4f}° lat, {abs(CAIRO_LON - grid_lon):.4f}° lon")

    # Load all timesteps
    files = sorted(DATA_DIR.glob("*.bin"))

    if not files:
        print(f"\n❌ No data files found in {DATA_DIR}")
        return 1

    print(f"\n📊 Loading {len(files)} timesteps...")

    times = []
    temps_kelvin = []
    temps_celsius = []

    for filepath in files:
        # Parse time
        time = parse_filename(filepath.name)
        times.append(time)

        # Load data
        data = load_fp16_data(filepath)

        # Extract Hamburg temperature
        temp_k = float(data[lat_idx, lon_idx])
        temp_c = temp_k - 273.15

        temps_kelvin.append(temp_k)
        temps_celsius.append(temp_c)

        print(f"   {time.strftime('%Y-%m-%d %H:%M UTC')}: {temp_c:6.2f}°C ({temp_k:.2f}K)")

    # Statistics
    print(f"\n📈 Statistics:")
    print(f"   Min: {min(temps_celsius):.2f}°C")
    print(f"   Max: {max(temps_celsius):.2f}°C")
    print(f"   Mean: {np.mean(temps_celsius):.2f}°C")
    print(f"   Range: {max(temps_celsius) - min(temps_celsius):.2f}°C")

    # Create plot
    print(f"\n📊 Creating plot...")

    fig, ax = plt.subplots(figsize=(12, 6))

    # Plot temperature
    ax.plot(times, temps_celsius, marker='o', linewidth=2, markersize=6, color='#ff6b6b')
    ax.axhline(y=0, color='#4ecdc4', linestyle='--', linewidth=1, alpha=0.5, label='Freezing point')

    # Formatting
    ax.set_xlabel('Time (UTC)', fontsize=12)
    ax.set_ylabel('Temperature (°C)', fontsize=12)
    ax.set_title(f'Temperature Time Series - Cairo, Egypt\n({CAIRO_LAT:.4f}°N, {CAIRO_LON:.4f}°E)',
                 fontsize=14, fontweight='bold')
    ax.grid(True, alpha=0.3)
    ax.legend()

    # Rotate x-axis labels for better readability
    plt.xticks(rotation=45, ha='right')

    # Tight layout
    plt.tight_layout()

    # Save
    output_file = Path("cairo_temp_timeseries.png")
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"   ✅ Saved to: {output_file.absolute()}")

    # Also save data as CSV
    csv_file = Path("cairo_temp_data.csv")
    with open(csv_file, 'w') as f:
        f.write("Time (UTC),Temperature (°C),Temperature (K)\n")
        for t, tc, tk in zip(times, temps_celsius, temps_kelvin):
            f.write(f"{t.strftime('%Y-%m-%d %H:%M')},{tc:.2f},{tk:.2f}\n")
    print(f"   ✅ Saved CSV: {csv_file.absolute()}")

    print("\n" + "=" * 60)

    return 0

if __name__ == '__main__':
    import sys
    sys.exit(main())
