#!/usr/bin/env python3
"""
Generate global temperature maps for all timesteps.
This will show if there are real temperature variations over time.
"""

import numpy as np
from pathlib import Path
import matplotlib.pyplot as plt
from datetime import datetime

# Data parameters
DATA_DIR = Path("public/data/temp2m")
WIDTH = 1441  # With wrapping column
HEIGHT = 721

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
    print("Global Temperature Maps - All Timesteps")
    print("=" * 60)

    # Load all timesteps
    files = sorted(DATA_DIR.glob("*.bin"))

    if not files:
        print(f"\n❌ No data files found in {DATA_DIR}")
        return 1

    print(f"\n📊 Creating maps for {len(files)} timesteps...")

    # Calculate grid for subplots (4 columns)
    n_files = len(files)
    n_cols = 4
    n_rows = (n_files + n_cols - 1) // n_cols

    # Create large figure
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(20, n_rows * 4))
    axes = axes.flatten() if n_files > 1 else [axes]

    # Prepare longitude and latitude for plotting
    lons = np.linspace(-180, 180, WIDTH)
    lats = np.linspace(90, -90, HEIGHT)

    for idx, filepath in enumerate(files):
        # Parse time
        time = parse_filename(filepath.name)

        # Load data
        data = load_fp16_data(filepath)

        # Convert to Celsius
        temp_c = data - 273.15

        # Plot
        ax = axes[idx]

        # Use longitude from -180 to 180 (data is 0-360)
        im = ax.contourf(lons, lats, temp_c,
                        levels=np.linspace(-30, 40, 15),
                        cmap='RdYlBu_r',
                        extend='both')

        ax.set_title(f"{time.strftime('%Y-%m-%d %H:%M UTC')}",
                    fontsize=10, fontweight='bold')
        ax.set_xlabel('Longitude', fontsize=8)
        ax.set_ylabel('Latitude', fontsize=8)
        ax.grid(True, alpha=0.3, linewidth=0.5)
        ax.set_xlim(-180, 180)
        ax.set_ylim(-90, 90)

        # Stats
        print(f"   {filepath.name}: {temp_c.min():.1f}°C to {temp_c.max():.1f}°C (mean: {temp_c.mean():.1f}°C)")

    # Hide empty subplots
    for idx in range(n_files, len(axes)):
        axes[idx].axis('off')

    # Add colorbar
    fig.subplots_adjust(right=0.92, hspace=0.3, wspace=0.3)
    cbar_ax = fig.add_axes([0.94, 0.15, 0.02, 0.7])
    cbar = fig.colorbar(im, cax=cbar_ax)
    cbar.set_label('Temperature (°C)', fontsize=12)

    # Save
    output_file = Path("all_timesteps_global_temp.png")
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"\n✅ Saved to: {output_file.absolute()}")

    print("=" * 60)

    return 0

if __name__ == '__main__':
    import sys
    sys.exit(main())
