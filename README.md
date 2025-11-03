# Hypatia - Weather Visualization

Interactive 3D weather visualization with minute-accurate time interpolation.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Download Weather Data

```bash
# Install Python dependencies
pip3 install requests pygrib numpy

# Download ECMWF data (creates ~240MB in public/data/)
npm run download-data
```

### 3. Copy Cube Map Images

```bash
# Copy rtopo2 cube maps from old project
cp -r /Users/noiv/Projects/hypatia.arctic.io/images/rtopo2/* public/images/rtopo2/
```

### 4. Start Dev Server

```bash
npm run dev
```

Visit: `http://localhost:8080`

Or from iPad on same network: `http://your-mac-name.local:8080`

## Project Structure

```
code/
├── src/
│   ├── main.ts                    # Entry point
│   ├── app.ts                     # Main Mithril component
│   ├── components/                # UI components
│   │   ├── TimeSlider.ts          # Time scrubbing
│   │   ├── BlendSlider.ts         # Timestep blending
│   │   ├── Controls.ts            # Layer toggles & fullscreen
│   │   └── BootstrapModal.ts      # Reference modal
│   ├── services/                  # Core services
│   │   ├── DataService.ts         # Weather data coordination
│   │   ├── DataLoader.ts          # Binary data loading
│   │   ├── TimeService.ts         # Time management
│   │   ├── LayerStateService.ts   # Layer visibility state
│   │   ├── ECMWFService.ts        # ECMWF data fetching
│   │   ├── ECMWFDiscoveryService.ts  # Available data discovery
│   │   ├── GeolocationService.ts  # User location
│   │   └── UserOptionsService.ts  # User preferences
│   ├── layers/                    # Weather data services
│   │   ├── temp2m.data-service.ts      # Temperature data
│   │   ├── precipitation.data-service.ts  # Precipitation data
│   │   └── wind10m.data-service.ts     # Wind data
│   ├── visualization/             # Three.js rendering
│   │   ├── scene.ts               # Scene setup
│   │   ├── ILayer.ts              # Layer interface
│   │   ├── LayerFactory.ts        # Layer creation
│   │   ├── earth.render-service.ts       # Earth basemap
│   │   ├── sun.render-service.ts         # Sun position
│   │   ├── graticule.render-service.ts   # Lat/lon grid
│   │   ├── temp2m.render-service.ts      # Temperature viz
│   │   ├── precipitation.render-service.ts  # Precipitation viz
│   │   └── wind10m.render-service.ts     # Wind viz (WebGPU)
│   └── utils/                     # Utilities
│       └── time.ts
├── public/
│   ├── data/                      # Weather data (.bin files)
│   ├── images/
│   │   └── rtopo2/                # Cube map textures
│   └── manifest.json              # PWA manifest
└── scripts/
    └── download_dev_data.py       # Data download script
```

## Features

**3D Visualization:**
- High-res Earth cube map textures (4096×4096 per face)
- Accurate sun position with declination
- Smooth orbit controls with damping
- Touch gestures (iPad optimized)
- Fullscreen mode

**Weather Layers:**
- Temperature (2m above surface)
- Precipitation
- Wind (10m above surface) - WebGPU compute shader with 16,384 animated streamlines
- Graticule (lat/lon grid)

**Time Controls:**
- Full year range slider
- Minute-accurate interpolation between timesteps
- Blend slider for smooth transitions
- Mouse wheel scrubbing

**Data Architecture:**
- Direct ECMWF data access (no backend required)
- Partial downloads via byte-range requests (92.5% bandwidth savings)
- Custom FP16 binary format decoder
- Layer-based architecture with separation between data loading and rendering

## Controls

- **Mouse drag**: Rotate view
- **Mouse wheel**: Zoom in/out
- **Wheel on slider**: Scrub time
- **Two-finger pinch**: Zoom (iPad)
- **Layer toggles**: Show/hide visualization layers
- **Blend slider**: Control timestep interpolation
- **Button**: Toggle fullscreen

## Data Format

Weather data stored as fp16 binary:
- Format: `.bin` files (raw binary, no headers)
- Precision: 16-bit floating point
- Grid: 1440 × 721 points (0.25° resolution)
- Size: ~2 MB per parameter per timestep

File naming: `{date}_{cycle}_{forecast}_{param}.bin`
Example: `20251027_00z_0h_temp2m.bin`

## Development

### TypeScript Config

Using **strict mode** with:
- No unused locals/parameters
- No implicit returns
- No unchecked indexed access
- Exact optional properties

### Code Quality Rules

**From CLAUDE.md:**
- No defensive default parameters
- Fail fast and explicit
- Let TypeScript catch errors
- Minimize `any` and type casting

### Browser Testing

Use Playwright skill for automated testing:

```bash
node /Users/noiv/Projects/skill-playwright-minimal/skills/playwright-skill/browser-client.js navigate "http://localhost:8080"
node /Users/noiv/Projects/skill-playwright-minimal/skills/playwright-skill/browser-client.js console
```

## Cube Map Images

Expected structure:
```
public/images/rtopo2/
├── px.jpg  # Right (+X)
├── nx.jpg  # Left (-X)
├── py.jpg  # Top (+Y)
├── ny.jpg  # Bottom (-Y)
├── pz.jpg  # Front (+Z)
└── nz.jpg  # Back (-Z)
```

Each face: 4096 × 4096 pixels

## Architecture

**Layer System:**
- `ILayer` interface defines layer contract (update, visibility, render distance)
- `LayerFactory` creates layers polymorphically
- Separation: `layers/` (data loading) vs `visualization/` (rendering)
- TimeSeriesLayer base class for weather data layers

**WebGPU Wind Visualization:**
- Compute shader traces 16,384 wind streamlines
- ~3.4ms per frame on M4 chip
- Snake animation via color channel encoding
- LineSegments2 for high-quality line rendering

**Data Services:**
- `DataService` coordinates all weather data
- ECMWF direct S3 access with CORS support
- Byte-range partial downloads (8.4MB vs 117MB per file)
- FP16 decoder for efficient binary format

## Attribution

Weather data: ECMWF IFS model
- License: CC-BY-4.0
- Required attribution: "Generated using Copernicus Climate Change Service information 2025"
- Data source: https://www.ecmwf.int/en/forecasts/datasets/open-data
