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
│   ├── main.ts              # Entry point
│   ├── app.ts               # Main Mithril component
│   ├── components/          # UI components
│   │   ├── TimeSlider.ts
│   │   └── Controls.ts
│   ├── services/            # Data loading
│   │   └── DataLoader.ts
│   ├── visualization/       # Three.js scene
│   │   ├── Scene.ts
│   │   ├── Earth.ts
│   │   └── Sun.ts
│   └── utils/               # Utilities
│       └── time.ts
├── public/
│   ├── data/                # Weather data (.bin files)
│   ├── images/
│   │   └── rtopo2/          # Cube map textures
│   └── manifest.json        # PWA manifest
└── scripts/
    └── download_dev_data.py # Data download script
```

## Features (Milestone 1)

- ✅ 3D Earth with high-res cube map textures
- ✅ Sun position with accurate declination
- ✅ Time slider (full year range)
- ✅ Orbit controls (smooth with damping)
- ✅ Touch gestures (iPad support)
- ✅ Fullscreen mode
- ❌ Weather visualization (coming in next milestone)

## Controls

- **Mouse drag**: Rotate view
- **Mouse wheel**: Zoom in/out
- **Wheel on slider**: Scrub time
- **Two-finger pinch**: Zoom (iPad)
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
- ❌ No defensive default parameters
- ✅ Fail fast and explicit
- ✅ Let TypeScript catch errors
- ✅ Minimize `any` and type casting

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

## Attribution

Weather data: ECMWF IFS model
- License: CC-BY-4.0
- Required attribution: "Generated using Copernicus Climate Change Service information 2025"
- Data source: https://www.ecmwf.int/en/forecasts/datasets/open-data

## Next Steps

See `FIRST_MILESTONE.md` for current development goals.
