# Wind Visualization Layer

## Overview
Wind visualization using particle flow lines that follow wind vector fields from ECMWF IFS 0.25° data.

## Data Source
- **U-component**: `/data/wind10m_u/*.bin` - East-West wind velocity at 10m above ground
- **V-component**: `/data/wind10m_v/*.bin` - North-South wind velocity at 10m above ground
- **Format**: Binary Float32Array, same structure as temp2m/pratesfc
- **Resolution**: 0.25° (1440x721 grid)

## Implementation Stages

### Stage 1: Seed Points (Current)
**Goal**: Validate UI/UX integration with visual debugging

- Generate 1000 uniformly distributed random points on sphere (Fibonacci lattice)
- Render as red sprite points for debugging
- Add URL parameter support: `?layers=wind`
- Add UI toggle button labeled "Wind"
- Points remain static (no data loading yet)

**Status**: In Progress

### Stage 2: Static Wind Lines
**Goal**: Render actual wind flow lines from real data

- Load U/V wind component data from binary files
- Create 3D texture samplers for wind vector field
- Trace wind vectors from each seed point:
  - Sample U/V at current lat/lon
  - Move in spherical coordinates (theta += u*factor, phi -= v*factor)
  - Store positions for fixed number of steps (e.g., 60 vertices per line)
- Render as multiline geometry:
  - Line width varies by wind speed
  - Color varies by wind speed (HSL gradient)
  - Custom geometry with previous/next vertices for thick lines

**Status**: Not Started

### Stage 3: Animated Flow
**Goal**: Create illusion of wind movement

- Implement shader-based animation
- Color gradient flows from tail to head along each line
- Use `lineIndex` uniform to control animation phase
- Animate in render loop (similar to legacy implementation)

**Status**: Not Started

### Stage 4: Temporal Interpolation
**Goal**: Smooth transitions as time changes

- Interpolate wind vector field between timestamps
- Recalculate line paths as time slider moves
- Lines always start from same seeds but follow interpolated vectors
- Smooth transitions between timesteps

**Status**: Not Started

## Technical Details

### Fibonacci Sphere Distribution
Ensures uniform distribution of seed points on sphere surface:
```
golden_ratio = (1 + sqrt(5)) / 2
for i in 0..n:
  y = 1 - (i / (n-1)) * 2
  radius = sqrt(1 - y*y)
  theta = 2 * PI * i / golden_ratio
  x = cos(theta) * radius
  z = sin(theta) * radius
```

### Wind Vector Tracing (Legacy Algorithm)
From `sim.worker.jetstream.js`:
1. Start at seed (lat, lon)
2. Sample U/V from 3D texture at (x, y, timestep)
3. Adjust U for latitude: `u /= cos(lat * DEGRAD)`
4. Update spherical coords: `theta += u * factor`, `phi -= v * factor`
5. Convert back to cartesian, extract new lat/lon
6. Repeat for N steps (60 vertices)
7. Store position, color (speed-based), width (speed-based)

### Multiline Geometry Structure
Each line vertex is doubled to create quad strips:
- **Attributes**: position, previous, next, side (+1/-1), width, color, lineIndex
- **Indexed**: Quad strip with triangle pairs
- **Shader**: Uses previous/next to calculate perpendicular offset for thickness

### Performance Considerations
- Legacy: 6 sectors × 512 lines = 3072 lines × 60 vertices = 184,320 vertices
- Current target: 1000 lines × 60 vertices = 60,000 vertices
- Use Web Workers for line generation (offload to background thread)
- Transfer geometry buffers using Transferable objects

## Configuration

### Constants
- `NUM_SEEDS`: 1000 (for Stage 1)
- `LINE_LENGTH`: 60 vertices per line
- `STEP_FACTOR`: ~0.0003 (controls step size in spherical coordinates)
- `ALTITUDE`: 10m above surface (wind10m data)

### Visual Parameters
- **Sprite size**: 0.01 Earth radii (for Stage 1 debugging)
- **Sprite color**: Red `#ff0000`
- **Line width range**: 0.5 - 2.0 (based on wind speed 0-50 m/s)
- **Color gradient**: HSL based on wind speed (hue varies by speed)

## Files

### Core Implementation
- `src/visualization/WindLayer.ts` - Main wind layer class
- `src/utils/sphereSeeds.ts` - Fibonacci sphere point distribution
- `src/services/Wind10mService.ts` - Wind data loading (Stage 2)
- `src/visualization/WIND.md` - This documentation

### Integration Points
- `src/visualization/Scene.ts` - Scene integration
- `src/app.ts` - UI state management
- `src/components/Controls.ts` - Toggle button
- `src/utils/urlState.ts` - URL parameter support

## References
- Legacy implementation: `/Users/noiv/Projects/hypatia.arctic.io/scripts/sim.models.wind.js`
- Worker implementation: `/Users/noiv/Projects/hypatia.arctic.io/scripts/sim.worker.jetstream.js`
- Visual reference: `/Users/noiv/Projects/hypatia.arctic.io/images/screenshots/hypatia.jetstream.gif`
