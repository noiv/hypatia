import * as THREE from 'three';

/**
 * Generate uniformly distributed points on a sphere using Fibonacci lattice
 *
 * This algorithm provides excellent uniform distribution without clustering
 * at the poles, which is common in naive latitude/longitude sampling.
 *
 * @param numPoints Number of points to generate
 * @param radius Radius of the sphere (default: 1.0)
 * @returns Array of Vector3 points on sphere surface
 */
export function generateFibonacciSphere(numPoints: number, radius: number = 1.0): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2; // ~1.618
  const angleIncrement = 2 * Math.PI / goldenRatio;

  for (let i = 0; i < numPoints; i++) {
    // Y coordinate: linear from top to bottom
    const y = 1 - (i / (numPoints - 1)) * 2; // Range: [1, -1]

    // Radius at this height (from sphere equation x² + y² + z² = r²)
    const radiusAtHeight = Math.sqrt(1 - y * y);

    // Angle around Y axis using golden ratio for uniform distribution
    const theta = angleIncrement * i;

    // Convert to Cartesian coordinates
    const x = Math.cos(theta) * radiusAtHeight;
    const z = Math.sin(theta) * radiusAtHeight;

    points.push(new THREE.Vector3(x * radius, y * radius, z * radius));
  }

  return points;
}

/**
 * Generate random points on sphere (naive uniform distribution)
 *
 * Note: This is less uniform than Fibonacci sphere - poles get more dense.
 * Only use for testing or when true randomness is required.
 *
 * @param numPoints Number of points to generate
 * @param radius Radius of the sphere (default: 1.0)
 * @returns Array of Vector3 points on sphere surface
 */
export function generateRandomSphere(numPoints: number, radius: number = 1.0): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  for (let i = 0; i < numPoints; i++) {
    // Use spherical coordinates with random angles
    const theta = Math.random() * 2 * Math.PI; // 0 to 2π
    const phi = Math.acos(2 * Math.random() - 1); // 0 to π (uniform on sphere)

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);  // Y is UP in Three.js
    const z = radius * Math.sin(phi) * Math.sin(theta);

    points.push(new THREE.Vector3(x, y, z));
  }

  return points;
}
