/**
 * Factory functions for creating mock objects in tests
 */

import { vi } from 'vitest'
import type * as THREE from 'three'

/**
 * Create a mock THREE.WebGLRenderer
 */
export function createMockRenderer(): THREE.WebGLRenderer {
  return {
    domElement: document.createElement('canvas'),
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    getContext: vi.fn().mockReturnValue({
      getParameter: vi.fn(),
      getExtension: vi.fn(),
      texSubImage3D: vi.fn(),
    }),
    properties: {
      get: vi.fn().mockReturnValue({}),
    },
  } as unknown as THREE.WebGLRenderer
}

/**
 * Create a mock THREE.Scene
 */
export function createMockScene(): THREE.Scene {
  return {
    add: vi.fn(),
    remove: vi.fn(),
    children: [],
  } as unknown as THREE.Scene
}

/**
 * Create a mock THREE.Data3DTexture
 */
export function createMockTexture3D(): THREE.Data3DTexture {
  const THREE = require('three')
  return {
    needsUpdate: false,
    format: THREE.RedFormat,
    type: THREE.HalfFloatType,
    image: {
      data: new Uint16Array(256 * 256 * 60),
      width: 256,
      height: 256,
      depth: 60,
    },
  } as unknown as THREE.Data3DTexture
}

/**
 * Create mock ArrayBuffer from string (for testing downloads)
 */
export function createMockArrayBuffer(size: number = 1024): ArrayBuffer {
  return new ArrayBuffer(size)
}

/**
 * Create mock fetch response
 */
export function createMockFetchResponse(
  data: ArrayBuffer,
  ok: boolean = true,
  status: number = 200
): Response {
  return {
    ok,
    status,
    arrayBuffer: vi.fn().mockResolvedValue(data),
    headers: new Headers({
      'content-length': data.byteLength.toString(),
    }),
  } as unknown as Response
}

/**
 * Create mock TimeStep array
 */
export function createMockTimeSteps(count: number = 60): Array<{ time: Date; url: string }> {
  const steps = []
  const baseTime = new Date('2025-11-18T00:00:00Z')

  for (let i = 0; i < count; i++) {
    const time = new Date(baseTime.getTime() + i * 6 * 60 * 60 * 1000) // 6 hour intervals
    steps.push({
      time,
      url: `http://localhost/data/temp2m_${time.toISOString()}.bin`,
    })
  }

  return steps
}

/**
 * Create mock HypatiaConfig
 */
export function createMockHypatiaConfig() {
  return {
    data: {
      maxRangeDays: 15,
      baseUrl: 'http://localhost/data',
    },
    dataCache: {
      maxConcurrentDownloads: 4,
    },
    datasets: {
      temp2m: {
        name: 'Temperature at 2m',
        param: 'temp',
        startTime: '2025-11-01T00:00:00Z',
        endTime: '2025-11-20T00:00:00Z',
      },
    },
  }
}
