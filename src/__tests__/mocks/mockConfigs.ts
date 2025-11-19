/**
 * Mock configuration data for testing
 */

import type { HypatiaConfig, ParamsConfig, LayersConfig, DataManifest } from '../../config/types'
import type { UserOptions } from '../../services/ConfigService'

export const mockHypatiaConfig: HypatiaConfig = {
  app: {
    name: 'Hypatia',
    version: '1.0.0',
    description: 'Weather visualization',
  },
  data: {
    maxRangeDays: 15,
    dataBaseUrl: 'http://localhost/data',
    updateIntervalMs: 300000,
    defaultResolution: 'high',
  },
  visualization: {
    defaultCenter: [0, 0],
    defaultZoom: 3,
    maxZoom: 10,
    minZoom: 1,
    defaultAltitude: 1000,
    defaultLayers: ['earth', 'temp2m'],
  },
  camera: {
    minDistance: 100,
    maxDistance: 5000,
    defaultDistance: 2000,
    dampingFactor: 0.05,
    rotateSpeed: 1.0,
    zoomSpeed: 1.0,
    invertZoom: false,
    rotationFriction: 0.95,
    rotationSensitivity: 0.5,
    minVelocity: 0.001,
    maxVelocity: 0.1,
    doubleTapZoomFactor: 2.0,
    doubleTapAnimationMs: 300,
    doubleTapThresholdMs: 300,
    doubleTapDistanceThreshold: 50,
    gestureTimeoutMs: 100,
    timeScrubMinutesPerPixel: 10,
  },
  performance: {
    workerCount: 4,
    preloadCritical: true,
  },
  bootstrap: {
    autoContinue: false,
  },
  dataCache: {
    maxConcurrentDownloads: 4,
    cacheStrategy: 'spiral-out',
    downloadMode: 'on-demand',
  },
  features: {
    enableGeolocation: true,
  },
  ui: {
    backgroundColor: '#000000',
  },
  build: {
    version: '1.0.0',
    hash: 'abc123',
    timestamp: '2025-11-18T12:00:00Z',
  },
}

export const mockParamsConfig: ParamsConfig = {
  version: '1.0',
  source: 'ECMWF',
  updated: '2025-11-18',
  parameters: {
    '2t': {
      name: 'Temperature at 2m',
      description: 'Air temperature at 2 meters above surface',
      units: 'K',
      category: 'temperature',
      level: 'surface',
    },
    '10u': {
      name: 'U-component of wind at 10m',
      description: 'Eastward wind component at 10m',
      units: 'm/s',
      category: 'wind',
      level: 'surface',
    },
  },
}

export const mockLayersConfig: LayersConfig = {
  version: '1.0',
  layers: [
    {
      id: 'temp2m',
      urlKey: 'temp',
      label: {
        short: 'Temperature',
        long: 'Temperature at 2m',
      },
      description: 'Air temperature at 2 meters above surface',
      ecmwfParams: ['2t'],
      visualization: {
        colormap: 'turbo',
        range: { min: 233, max: 313 },
        opacity: 0.8,
      },
      ui: {
        icon: 'thermometer',
        group: 'atmosphere',
        order: 1,
        defaultEnabled: true,
      },
    },
    {
      id: 'wind10m',
      urlKey: 'wind',
      label: {
        short: 'Wind',
        long: 'Wind at 10m',
      },
      description: 'Wind velocity at 10 meters',
      ecmwfParams: ['10u', '10v'],
      visualization: {
        colormap: 'viridis',
        range: { min: 0, max: 30 },
        opacity: 0.7,
        vectors: true,
      },
      ui: {
        icon: 'wind',
        group: 'atmosphere',
        order: 2,
        defaultEnabled: false,
      },
    },
  ],
  groups: {
    atmosphere: {
      name: 'Atmosphere',
      description: 'Atmospheric variables',
      order: 1,
    },
  },
}

export const mockDataManifest: DataManifest = {
  generated: '2025-11-18T12:00:00Z',
  datasets: {
    temp2m: {
      range: '20251101_00z-20251115_18z',
      step: '6h',
      count: 60,
      missing: [],
      size_bytes: 1048576,
    },
    wind10m: {
      range: '20251101_00z-20251115_18z',
      step: '6h',
      count: 60,
      missing: ['20251105_06z'],
      size_bytes: 2097152,
    },
  },
}

export const mockUserOptions: UserOptions = {
  timeServer: {
    enabled: false,
    comment: 'Use time server for accurate time',
  },
  atmosphere: {
    enabled: true,
    comment: 'Enable atmospheric effects',
  },
}
