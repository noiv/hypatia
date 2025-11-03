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

import { PRESSURE_CONFIG } from '../config/pressure.config';

// Grid dimensions from config
const GRID_WIDTH = PRESSURE_CONFIG.grid.width;
const GRID_HEIGHT = PRESSURE_CONFIG.grid.height;
const EARTH_RADIUS = PRESSURE_CONFIG.earth.radius;

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
 * Process single grid cell with marching squares (optimized - corner values precomputed)
 */
function processCellEdgesOptimized(
  x: number,
  y: number,
  v00: number,
  v10: number,
  v11: number,
  v01: number,
  isoValue: number,
  vertices: number[]
): void {
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

// Debug flags
const DEBUG_CONTOURS = false;  // Detailed grid stats and per-isobar segment counts
const DEBUG_TIMING = false;    // Performance timing logs

/**
 * Generate contours for all isobar levels (optimized for batch processing)
 */
function generateContours(
  pressureGrid: Float32Array,
  isobarLevels: number[]
): Float32Array {
  const vertices: number[] = [];

  // Debug: Sample some pressure values (optimized - no array copy)
  if (DEBUG_CONTOURS) {
    console.log('[ContourWorker] Pressure grid stats:');
    console.log('  Grid size:', pressureGrid.length, `(expected ${GRID_WIDTH * GRID_HEIGHT})`);
    console.log('  Sample values:', pressureGrid.slice(0, 10));

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pressureGrid.length; i++) {
      const v = pressureGrid[i];
      if (v !== undefined && !isNaN(v) && v > 0) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    console.log('  Min:', min);
    console.log('  Max:', max);
  }

  // Batch process: iterate grid once, test all isobar levels per cell
  const segmentCounts = DEBUG_CONTOURS ? new Map<number, number>() : null;
  if (segmentCounts) {
    isobarLevels.forEach(level => segmentCounts.set(level, 0));
  }

  // Process each grid cell once
  // Stop at GRID_WIDTH - 1 to avoid processing the wrapping column boundary
  for (let y = 0; y < GRID_HEIGHT - 1; y++) {
    for (let x = 0; x < GRID_WIDTH - 1; x++) {
      // Get 4 corner values once
      const v00 = getPressure(pressureGrid, x, y);
      const v10 = getPressure(pressureGrid, x + 1, y);
      const v11 = getPressure(pressureGrid, x + 1, y + 1);
      const v01 = getPressure(pressureGrid, x, y + 1);

      // Skip if any corner is at pole
      if (y === 0 || y >= GRID_HEIGHT - 1) {
        continue;
      }

      // Find min/max pressure in this cell
      const cellMin = Math.min(v00, v10, v11, v01);
      const cellMax = Math.max(v00, v10, v11, v01);

      // Test all isobar levels that could intersect this cell
      for (const isoValue of isobarLevels) {
        // Skip if isobar can't intersect this cell
        if (isoValue < cellMin || isoValue > cellMax) {
          continue;
        }

        const startCount = vertices.length;
        processCellEdgesOptimized(x, y, v00, v10, v11, v01, isoValue, vertices);

        if (segmentCounts) {
          const segmentsAdded = (vertices.length - startCount) / 6;
          if (segmentsAdded > 0) {
            segmentCounts.set(isoValue, (segmentCounts.get(isoValue) || 0) + segmentsAdded);
          }
        }
      }
    }
  }

  // Log segment counts per isobar
  if (DEBUG_CONTOURS && segmentCounts) {
    isobarLevels.forEach(isoValue => {
      const count = segmentCounts.get(isoValue) || 0;
      if (count > 0) {
        console.log(`  Isobar ${isoValue} Pa: ${count} segments`);
      }
    });
  }

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
    const value = fp16Data[i];
    float32Data[i] = value !== undefined ? decodeFP16(value) : 0;
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
    const t1 = performance.now();
    const [pressureA, pressureB] = await Promise.all([
      getPressureGrid(stepA, timeSteps),
      getPressureGrid(stepA + 1, timeSteps)
    ]);
    const t2 = performance.now();

    // Interpolate pressure field
    const interpolatedPressure = interpolatePressureField(pressureA, pressureB, blend);
    const t3 = performance.now();

    // Generate contour vertices
    const vertices = generateContours(interpolatedPressure, isobarLevels);
    const t4 = performance.now();

    // Performance timing (behind DEBUG_TIMING flag)
    if (DEBUG_TIMING) {
      const totalTime = (t4 - t1).toFixed(1);
      const segments = vertices.length / 6;
      console.log(`Contour.ontime: ${isobarLevels.length} lvls, ${segments} segs, ${totalTime}ms`);

      // Detailed timing breakdown (behind DEBUG_CONTOURS flag)
      if (DEBUG_CONTOURS) {
        console.log(`  Data loading: ${(t2 - t1).toFixed(2)}ms`);
        console.log(`  Interpolation: ${(t3 - t2).toFixed(2)}ms`);
        console.log(`  Marching squares: ${(t4 - t3).toFixed(2)}ms`);
      }
    }

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
