/**
 * Contour Worker - Marching Squares Algorithm
 *
 * Generates isobar contour lines from interpolated pressure fields
 * Maintains internal cache of loaded pressure grids
 * Uses Transferable ArrayBuffer for zero-copy data transfer
 */

interface WorkerMessage {
  stepA: number;
  blend: number;
  isobarLevels: number[];
  timestamp: number;
  timeSteps: Array<{ date: string; cycle: string; filePath: string }>;
  dataBaseUrl: string;
}

interface WorkerResponse {
  vertices: Float32Array;
  timestamp: number;
}

// Grid dimensions for 2° resolution (with wrapping column)
const GRID_WIDTH = 181;  // 180 + 1 wrapping column for dateline continuity
const GRID_HEIGHT = 91;

// Cache for loaded pressure grids (indexed by timestep)
const pressureCache = new Map<number, Float32Array>();

/**
 * Interpolate between two pressure fields
 */
function interpolatePressureField(
  pressureA: Float32Array,
  pressureB: Float32Array,
  blend: number
): Float32Array {
  const result = new Float32Array(pressureA.length);
  const invBlend = 1 - blend;

  for (let i = 0; i < pressureA.length; i++) {
    const valA = pressureA[i];
    const valB = pressureB[i];
    if (valA !== undefined && valB !== undefined) {
      result[i] = valA * invBlend + valB * blend;
    }
  }

  return result;
}

/**
 * Get pressure value at grid position
 */
function getPressure(grid: Float32Array, x: number, y: number): number {
  // Data includes wrapping column, so no need to wrap - just clamp
  const clampedX = Math.max(0, Math.min(GRID_WIDTH - 1, x));

  // Clamp latitude (y)
  if (y < 0 || y >= GRID_HEIGHT) {
    return 0; // Skip poles
  }

  const index = y * GRID_WIDTH + clampedX;
  const value = grid[index];
  return value !== undefined ? value : 0;
}

/**
 * Linear interpolation for edge crossing
 */
function interpolateEdge(
  v1: number,
  v2: number,
  isoValue: number
): number {
  if (Math.abs(v1 - v2) < 0.001) {
    return 0.5;
  }
  return (isoValue - v1) / (v2 - v1);
}

/**
 * Convert grid coordinates to lat/lon on sphere
 */
function gridToLatLon(x: number, y: number): [number, number] {
  // ECMWF data grid orientation (matching precipitation layer transformation):
  // The precipitation shader applies this transform (sphere → texture):
  //   u = 1.0 - ((lon + π/2) / 2π)
  //   u = 0.75 - lon/2π
  // Inverse transform (texture grid → sphere):
  //   lon = 2π(0.75 - u) = 1.5π - 2πu = 270° - 360°u

  // Convert grid position to normalized texture coordinate (0 to 1)
  // Grid has 181 points (0-180) covering 0-360°, so normalize by 180
  const u = x / 180;

  // Apply inverse of precipitation shader transformation
  let lon = 270 - 360 * u;  // Degrees

  // Normalize to -180° to +180° range
  while (lon < -180) lon += 360;
  while (lon > 180) lon -= 360;

  // Latitude remains the same (north pole at y=0, south pole at y=90)
  const lat = 90 - (y / (GRID_HEIGHT - 1)) * 180; // +90 to -90

  return [lat, lon];
}

/**
 * Convert lat/lon to 3D sphere coordinates (Earth radius = 1.0)
 */
function latLonToCartesian(lat: number, lon: number): [number, number, number] {
  const EARTH_RADIUS = 1.0;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  const x = EARTH_RADIUS * Math.cos(latRad) * Math.cos(lonRad);
  const y = EARTH_RADIUS * Math.sin(latRad);
  const z = EARTH_RADIUS * Math.cos(latRad) * Math.sin(lonRad);

  return [x, y, z];
}

/**
 * Marching squares lookup table
 * Returns edge indices for each cell configuration (4 bits = 16 cases)
 */
const MARCHING_SQUARES_EDGES: number[][] = [
  [],           // 0000
  [0, 3],       // 0001
  [0, 1],       // 0010
  [1, 3],       // 0011
  [1, 2],       // 0100
  [0, 1, 2, 3], // 0101 (ambiguous - use two segments)
  [0, 2],       // 0110
  [2, 3],       // 0111
  [2, 3],       // 1000
  [0, 2],       // 1001
  [0, 3, 1, 2], // 1010 (ambiguous - use two segments)
  [1, 2],       // 1011
  [1, 3],       // 1100
  [0, 1],       // 1101
  [0, 3],       // 1110
  []            // 1111
];

/**
 * Process single grid cell with marching squares
 */
function processCellEdges(
  grid: Float32Array,
  x: number,
  y: number,
  isoValue: number,
  vertices: number[]
): void {
  // Get 4 corner values
  const v00 = getPressure(grid, x, y);
  const v10 = getPressure(grid, x + 1, y);
  const v11 = getPressure(grid, x + 1, y + 1);
  const v01 = getPressure(grid, x, y + 1);

  // Skip if any corner is at pole
  if (y === 0 || y >= GRID_HEIGHT - 1) {
    return;
  }

  // Calculate cell configuration (4-bit value)
  let cellIndex = 0;
  if (v00 >= isoValue) cellIndex |= 1;
  if (v10 >= isoValue) cellIndex |= 2;
  if (v11 >= isoValue) cellIndex |= 4;
  if (v01 >= isoValue) cellIndex |= 8;

  const edges = MARCHING_SQUARES_EDGES[cellIndex];
  if (!edges || edges.length === 0) {
    return;
  }

  // Edge midpoints in grid space
  const edgePoints: Array<[number, number]> = [
    [x + interpolateEdge(v00, v10, isoValue), y],                    // Edge 0: bottom
    [x + 1, y + interpolateEdge(v10, v11, isoValue)],                // Edge 1: right
    [x + interpolateEdge(v01, v11, isoValue), y + 1],                // Edge 2: top
    [x, y + interpolateEdge(v00, v01, isoValue)]                     // Edge 3: left
  ];

  // Generate line segments
  for (let i = 0; i < edges.length; i += 2) {
    const edge1 = edges[i];
    const edge2 = edges[i + 1];

    if (edge1 === undefined || edge2 === undefined) continue;

    const point1 = edgePoints[edge1];
    const point2 = edgePoints[edge2];

    if (!point1 || !point2) continue;

    const [x1, y1] = point1;
    const [x2, y2] = point2;

    // Convert to lat/lon then to cartesian
    const [lat1, lon1] = gridToLatLon(x1, y1);
    const [lat2, lon2] = gridToLatLon(x2, y2);

    const [cx1, cy1, cz1] = latLonToCartesian(lat1, lon1);
    const [cx2, cy2, cz2] = latLonToCartesian(lat2, lon2);

    // Add line segment (two vertices)
    vertices.push(cx1, cy1, cz1);
    vertices.push(cx2, cy2, cz2);
  }
}

/**
 * Generate contours for all isobar levels
 */
function generateContours(
  pressureGrid: Float32Array,
  isobarLevels: number[]
): Float32Array {
  const vertices: number[] = [];

  // Debug: Sample some pressure values
  console.log('[ContourWorker] Pressure grid stats:');
  console.log('  Grid size:', pressureGrid.length, `(expected ${GRID_WIDTH * GRID_HEIGHT})`);
  console.log('  Sample values:', pressureGrid.slice(0, 10));
  console.log('  Min:', Math.min(...Array.from(pressureGrid).filter(v => !isNaN(v) && v > 0)));
  console.log('  Max:', Math.max(...Array.from(pressureGrid).filter(v => !isNaN(v) && v > 0)));

  // Process each isobar level
  for (const isoValue of isobarLevels) {
    const startCount = vertices.length;

    // Process each grid cell
    for (let y = 0; y < GRID_HEIGHT - 1; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        processCellEdges(pressureGrid, x, y, isoValue, vertices);
      }
    }

    const segmentsAdded = (vertices.length - startCount) / 6;
    if (segmentsAdded > 0) {
      console.log(`  Isobar ${isoValue} Pa: ${segmentsAdded} segments`);
    }
  }

  console.log(`[ContourWorker] Total vertices: ${vertices.length}, segments: ${vertices.length / 6}`);
  return new Float32Array(vertices);
}

/**
 * Decode FP16 to Float32
 */
function decodeFP16(binary: number): number {
  const sign = (binary & 0x8000) >> 15;
  let exponent = (binary & 0x7C00) >> 10;
  let fraction = binary & 0x03FF;

  if (exponent === 0) {
    if (fraction === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
  }

  if (exponent === 0x1F) {
    return fraction ? NaN : sign ? -Infinity : Infinity;
  }

  exponent -= 15;
  fraction /= 1024;
  return (sign ? -1 : 1) * Math.pow(2, exponent) * (1 + fraction);
}

/**
 * Load pressure data for a single timestep
 */
async function loadPressureData(filePath: string): Promise<Float32Array> {
  const response = await fetch(filePath);
  if (!response.ok) {
    throw new Error(`Failed to load ${filePath}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const expectedSize = GRID_WIDTH * GRID_HEIGHT * 2; // 2 bytes per fp16

  if (buffer.byteLength !== expectedSize) {
    throw new Error(
      `Invalid file size for ${filePath}: expected ${expectedSize} bytes, got ${buffer.byteLength}`
    );
  }

  // Decode fp16 to Float32
  const fp16Data = new Uint16Array(buffer);
  const float32Data = new Float32Array(fp16Data.length);

  for (let i = 0; i < fp16Data.length; i++) {
    const val = fp16Data[i];
    if (val !== undefined) {
      float32Data[i] = decodeFP16(val);
    }
  }

  return float32Data;
}

/**
 * Get pressure grid for timestep (from cache or load)
 */
async function getPressureGrid(
  stepIndex: number,
  timeSteps: Array<{ date: string; cycle: string; filePath: string }>
): Promise<Float32Array> {
  // Check cache first
  const cached = pressureCache.get(stepIndex);
  if (cached) {
    return cached;
  }

  // Load from network
  const step = timeSteps[stepIndex];
  if (!step) {
    throw new Error(`Invalid step index: ${stepIndex}`);
  }

  const data = await loadPressureData(step.filePath);

  // Cache for reuse
  pressureCache.set(stepIndex, data);

  return data;
}

/**
 * Worker message handler
 */
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { stepA, blend, isobarLevels, timestamp, timeSteps } = e.data;

  try {
    // Load adjacent timesteps (from cache or network)
    const [pressureA, pressureB] = await Promise.all([
      getPressureGrid(stepA, timeSteps),
      getPressureGrid(stepA + 1, timeSteps)
    ]);

    // Interpolate pressure field
    const interpolatedPressure = interpolatePressureField(pressureA, pressureB, blend);

    // Generate contour vertices
    const vertices = generateContours(interpolatedPressure, isobarLevels);

    // Send back via Transferable (zero-copy)
    const response: WorkerResponse = {
      vertices,
      timestamp
    };

    self.postMessage(response, { transfer: [vertices.buffer] });
  } catch (error) {
    console.error('ContourWorker error:', error);
    // Send empty response to prevent hanging
    const response: WorkerResponse = {
      vertices: new Float32Array(0),
      timestamp
    };
    self.postMessage(response);
  }
};

// Export empty object for TypeScript module
export {};
