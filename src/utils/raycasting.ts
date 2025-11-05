/**
 * Raycasting utilities for 3D mouse interaction
 */

import * as THREE from 'three';

/**
 * Convert mouse pixel coordinates to normalized device coordinates
 * @param clientX - Mouse X in pixels
 * @param clientY - Mouse Y in pixels
 * @param canvas - Canvas element
 * @returns Normalized device coordinates (-1 to +1)
 */
export function mouseToNDC(clientX: number, clientY: number, canvas: HTMLCanvasElement): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
}

/**
 * Check if mouse intersects a 3D object
 * @param mouse - Normalized device coordinates
 * @param camera - Three.js camera
 * @param object - Object to test intersection with
 * @param raycaster - Raycaster instance (reusable for performance)
 * @returns Intersection result or null
 */
export function raycastObject(
  mouse: THREE.Vector2,
  camera: THREE.Camera,
  object: THREE.Object3D,
  raycaster: THREE.Raycaster
): THREE.Intersection | undefined {
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(object, false);
  return intersects[0];
}

/**
 * Convert 3D cartesian point to lat/lon coordinates
 * Assumes point is on unit sphere centered at origin
 * @param point - 3D point in cartesian coordinates
 * @returns {lat, lon} in degrees
 */
export function cartesianToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  const lat = Math.asin(point.y) * (180 / Math.PI);
  const lon = Math.atan2(point.z, point.x) * (180 / Math.PI);
  return { lat, lon };
}
