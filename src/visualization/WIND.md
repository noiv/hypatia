# Wind Visualization Layer

## Overview
Wind visualization using animated flow lines that follow wind vector fields from ECMWF IFS 0.25° data.

## Current Implementation: "Snake Attack"

### Completed Features (Stages 1-3)
✅ **Stage 1**: Seed points (16,384 uniformly distributed)
✅ **Stage 2**: Static wind lines with Line2/LineMaterial
✅ **Stage 3**: Animated "snake" effect with traveling opacity gradient

### Visual Characteristics
- **16,384 flow lines** traced from random seed points (Fibonacci sphere distribution)
- **32 segments per line** with doubled step factor (STEP_FACTOR = 0.00015)
- **10-segment animated snakes** traveling along each line at 20 segments/second
- **Opacity gradient**: 0% at tail → 100% at head (linear interpolation)
- **Randomized starting positions** per line for natural, asynchronous appearance
- **Dynamic line width**: 2px at surface, 0.02px at max altitude (logarithmic scaling)
- **4-segment taper** at line endpoints for smooth visual termination

### Animation Details
- **Cycle length**: 32 + 10 = 42 segments
- **Animation speed**: 20 segments/second
- **Loop duration**: ~2.1 seconds per complete cycle
- **Frame rate**: Smooth 60fps with delta-time based animation
- **Shader-based**: Custom GLSL fragment shader with per-frame uniform updates

## Data Source
- **U-component**: `/data/wind10m_u/*.bin` - East-West wind velocity at 10m above ground
- **V-component**: `/data/wind10m_v/*.bin` - North-South wind velocity at 10m above ground
- **Format**: Binary fp16 (Float16), 1441×721 grid with wrapping column
- **Resolution**: 0.25° ECMWF IFS forecast data
- **Temporal**: 6-hour intervals from current run

## Technical Implementation

### Wind Vector Tracing Algorithm
```typescript
// From WindLayer.ts:traceLine()
1. Start at seed point (cartesian coordinates)
2. Convert to lat/lon using coordinate transformation
3. Sample U/V wind components at current position (bilinear interpolation)
4. Adjust U for latitude convergence: u_adjusted = u / cos(lat)
5. Update spherical coordinates:
   - theta += u_adjusted * STEP_FACTOR
   - phi -= v * STEP_FACTOR
6. Clamp phi to valid range [0.01, π-0.01]
7. Convert back to cartesian
8. Repeat for LINE_STEPS (32) vertices
```

### Coordinate System Alignment
Wind layer matches rain layer's coordinate transformation:
- 90° west rotation
- Horizontal mirror
- Ensures wind vectors align with surface features

### Line2 Rendering
Uses THREE.js LineSegments2 for modern, performant line rendering:
- **Geometry**: LineSegmentsGeometry with position and color attributes
- **Material**: LineMaterial with custom shader modification via onBeforeCompile
- **Vertex colors**: RGB channels store (segmentIndex, randomOffset, taperFactor)
- **Resolution-aware**: Updates on window resize for consistent line width

### Custom Shader Animation
```glsl
// Fragment shader (injected via onBeforeCompile)
uniform float animationPhase;  // Current animation position (0 to cycleLength)
uniform float snakeLength;     // Length of snake (10 segments)
uniform float lineSteps;       // Total line segments (32)

// Extract per-segment data from vertex colors
float segmentIndex = vColor.r * (lineSteps - 1.0);
float randomOffset = vColor.g * cycleLength;
float taperFactor = vColor.b;

// Calculate snake head position with random offset
float snakeHead = mod(animationPhase + randomOffset, cycleLength);

// Calculate distance from this segment to snake head
float distanceFromHead = segmentIndex - snakeHead;

// Apply opacity gradient (0 at tail, 1 at head)
if (distanceFromHead >= -snakeLength && distanceFromHead <= 0.0) {
    float positionInSnake = (distanceFromHead + snakeLength) / snakeLength;
    segmentOpacity = positionInSnake;
}

// Apply opacity and taper
gl_FragColor = vec4(vec3(1.0), alpha * segmentOpacity * taperFactor);
```

### Performance Optimizations
- **Shared uniform references**: Material uniforms linked to shader uniforms
- **Delta-time animation**: Frame-rate independent via deltaTime calculation
- **Stats.js integration**: Real-time FPS monitoring (top-right corner)
- **Efficient updates**: Only animationPhase uniform updated per frame
- **No geometry regeneration**: Lines traced once, animation via shader only

## Configuration

### Constants (WindLayer.ts)
```typescript
LINE_STEPS = 32           // Number of vertices per flow line
STEP_FACTOR = 0.00015     // Step size in spherical coords (doubled for longer lines)
LINE_WIDTH = 2.0          // Base line width in pixels
TAPER_SEGMENTS = 4        // Number of segments to taper at end
SNAKE_LENGTH = 10         // Length of animated snake in segments
```

### Animation Parameters
```typescript
animationSpeed = 20.0     // Segments per second (in updateAnimation)
numSeeds = 16384          // Number of flow lines (constructor parameter)
```

### Dynamic Line Width
```typescript
// From updateLineWidth() - logarithmic scaling
minDistance = 1.157       // Camera at surface (1M meters altitude)
maxDistance = 10.0        // Maximum zoom out
minWidth = 2.0           // Line width at surface
maxWidth = 0.02          // Line width at max altitude

// Logarithmic interpolation for natural feel
lineWidth = minWidth + (maxWidth - minWidth) * log_t
```

## Future: Stage 4 - Temporal Interpolation

### Goals
- Interpolate wind vector field between 6-hour timesteps
- Recalculate line paths as time slider moves
- Smooth transitions (lines morph to follow new vectors)
- Lines always start from same seeds but follow interpolated field

### Implementation Approach
1. Load adjacent timesteps (current and next)
2. Create dual U/V texture pairs
3. Interpolate in shader: `wind = mix(wind_t0, wind_t1, blend)`
4. Trigger line regeneration when blend crosses threshold
5. Consider using Web Workers for line tracing (offload from main thread)

## Files

### Core Implementation
- `src/visualization/WindLayer.ts` - Main wind layer with Line2 rendering and animation
- `src/utils/sphereSeeds.ts` - Fibonacci sphere seed point generation
- `src/services/Wind10mService.ts` - Wind data loading and fp16 decoding
- `src/visualization/Scene.ts` - Integration with render loop and delta-time
- `src/lib/stats.min.js` - FPS monitoring (loaded via script tag)

### Integration Points
- `src/app.ts` - Layer lifecycle and UI state management
- `src/components/Controls.ts` - Wind toggle button
- `src/utils/urlState.ts` - URL parameter support (?layers=wind)
- `index.html` - Stats.js script tag

## Performance Metrics
- **Geometry**: 16,384 lines × 31 segments = 507,904 line segments
- **Vertices**: ~1M vertices (2 per segment)
- **Frame rate**: Consistent 60fps on modern hardware
- **Shader overhead**: Minimal (only uniform updates per frame)
- **Memory**: ~12MB for geometry + wind data textures

## References
- **Commit**: "Snake Attack" (2c27555)
- **Legacy**: `/Users/noiv/Projects/hypatia.arctic.io/scripts/sim.models.wind.js`
- **Worker**: `/Users/noiv/Projects/hypatia.arctic.io/scripts/sim.worker.jetstream.js`
- **Line2 docs**: https://threejs.org/examples/#webgl_lines_fat
- **Stats.js**: https://github.com/mrdoob/stats.js/
