/**
 * ConfigService Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConfigService } from './ConfigService'
import {
  mockHypatiaConfig,
  mockParamsConfig,
  mockLayersConfig,
  mockDataManifest,
  mockUserOptions,
} from '../__tests__/mocks/mockConfigs'

describe('ConfigService', () => {
  let service: ConfigService

  beforeEach(() => {
    service = new ConfigService()

    // Mock fetch to return config files
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('hypatia.config.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockHypatiaConfig),
        } as Response)
      }

      if (urlString.includes('params-config.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockParamsConfig),
        } as Response)
      }

      if (urlString.includes('layer-config.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockLayersConfig),
        } as Response)
      }

      if (urlString.includes('manifest.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDataManifest),
        } as Response)
      }

      if (urlString.includes('user.options.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockUserOptions),
        } as Response)
      }

      return Promise.resolve({
        ok: false,
        statusText: 'Not Found',
      } as Response)
    })
  })

  describe('Configuration Loading', () => {
    it('should load hypatia config', async () => {
      const config = await service.loadHypatiaConfig()

      expect(config).toEqual(mockHypatiaConfig)
      expect(config.app.name).toBe('Hypatia')
      expect(config.data.maxRangeDays).toBe(15)
    })

    it('should cache hypatia config after first load', async () => {
      await service.loadHypatiaConfig()
      await service.loadHypatiaConfig()

      // fetch should only be called once
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should load params config', async () => {
      const config = await service.loadParamsConfig()

      expect(config).toEqual(mockParamsConfig)
      expect(config.parameters['2t']).toBeDefined()
    })

    it('should load layers config', async () => {
      const config = await service.loadLayersConfig()

      expect(config).toEqual(mockLayersConfig)
      expect(config.layers.length).toBe(2)
    })

    it('should load data manifest', async () => {
      // Need to load hypatia config first for dataBaseUrl
      await service.loadHypatiaConfig()

      const manifest = await service.loadDataManifest()

      expect(manifest).toEqual(mockDataManifest)
      expect(manifest.datasets.temp2m).toBeDefined()
    })

    it('should load user options', async () => {
      const options = await service.loadUserOptions()

      expect(options).toEqual(mockUserOptions)
      expect(options.timeServer.enabled).toBe(false)
    })

    it('should load all configs in parallel', async () => {
      await service.loadAll()

      expect(service.isReady()).toBe(true)
      expect(global.fetch).toHaveBeenCalledTimes(5) // All 5 config files
    })

    it('should throw error if fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      })

      await expect(service.loadHypatiaConfig()).rejects.toThrow(
        'Failed to load hypatia.config.json'
      )
    })

    it('should use defaults if user options fails', async () => {
      global.fetch = vi.fn((url: string | URL | Request) => {
        const urlString = typeof url === 'string' ? url : url.toString()

        if (urlString.includes('user.options.json')) {
          return Promise.resolve({
            ok: false,
            statusText: 'Not Found',
          } as Response)
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response)
      })

      const options = await service.loadUserOptions()

      expect(options.timeServer.enabled).toBe(false)
      expect(options.atmosphere.enabled).toBe(false)
    })
  })

  describe('Configuration Access', () => {
    beforeEach(async () => {
      await service.loadAll()
    })

    it('should get hypatia config', () => {
      const config = service.getHypatiaConfig()
      expect(config).toEqual(mockHypatiaConfig)
    })

    it('should throw if hypatia config not loaded', () => {
      const newService = new ConfigService()
      expect(() => newService.getHypatiaConfig()).toThrow('not loaded')
    })

    it('should get params config', () => {
      const config = service.getParamsConfig()
      expect(config).toEqual(mockParamsConfig)
    })

    it('should get layers config', () => {
      const config = service.getLayersConfig()
      expect(config).toEqual(mockLayersConfig)
    })

    it('should get data manifest', () => {
      const manifest = service.getDataManifest()
      expect(manifest).toEqual(mockDataManifest)
    })

    it('should get user options', () => {
      const options = service.getUserOptions()
      expect(options).toEqual(mockUserOptions)
    })

    it('should update user option', () => {
      service.setUserOption('timeServer.enabled', true)

      const options = service.getUserOptions()
      expect(options.timeServer.enabled).toBe(true)
    })

    it('should update nested user option', () => {
      service.setUserOption('atmosphere.enabled', false)

      const options = service.getUserOptions()
      expect(options.atmosphere.enabled).toBe(false)
    })
  })

  describe('Layer Queries', () => {
    beforeEach(async () => {
      await service.loadAll()
    })

    it('should get all layers sorted', () => {
      const layers = service.getLayers()

      expect(layers.length).toBe(2)
      expect(layers[0]?.id).toBe('temp')
      expect(layers[1]?.id).toBe('wind')
    })

    it('should get layer by ID', () => {
      const layer = service.getLayerById('temp')

      expect(layer).toBeDefined()
      expect(layer?.label.short).toBe('Temperature')
    })

    it('should return undefined for non-existent layer ID', () => {
      const layer = service.getLayerById('nonexistent')
      expect(layer).toBeUndefined()
    })

    it('should get layer by URL key', () => {
      const layer = service.getLayerByUrlKey('temp')

      expect(layer).toBeDefined()
      expect(layer?.id).toBe('temp')
    })

    it('should convert layer ID to URL key', () => {
      const urlKey = service.layerIdToUrlKey('temp')
      expect(urlKey).toBe('temp')
    })

    it('should convert URL key to layer ID', () => {
      const layerId = service.urlKeyToLayerId('temp')
      expect(layerId).toBe('temp')
    })

    it('should return ID as-is if no layer found', () => {
      const urlKey = service.layerIdToUrlKey('nonexistent')
      expect(urlKey).toBe('nonexistent')
    })

    it('should get default layers', () => {
      const defaultLayers = service.getDefaultLayers()

      expect(defaultLayers.length).toBe(1)
      expect(defaultLayers[0]?.id).toBe('temp')
    })
  })

  describe('Parameter Queries', () => {
    beforeEach(async () => {
      await service.loadAll()
    })

    it('should get parameter info', () => {
      const paramInfo = service.getParamInfo('2t')

      expect(paramInfo).toBeDefined()
      expect(paramInfo?.name).toBe('Temperature at 2m')
      expect(paramInfo?.units).toBe('K')
    })
  })

  describe('Dataset Queries', () => {
    beforeEach(async () => {
      await service.loadAll()
    })

    it('should get dataset info', () => {
      const datasetInfo = service.getDatasetInfo('temp')

      expect(datasetInfo).toBeDefined()
      expect(datasetInfo?.count).toBe(60)
      expect(datasetInfo?.step).toBe('6h')
    })

    it('should return undefined for non-existent dataset', () => {
      const datasetInfo = service.getDatasetInfo('nonexistent')
      expect(datasetInfo).toBeUndefined()
    })

    it('should get data base URL', () => {
      const baseUrl = service.getDataBaseUrl()
      expect(baseUrl).toBe('http://localhost/data')
    })

    it('should get dataset range', () => {
      const range = service.getDatasetRange('temp')

      expect(range).not.toBeNull()
      expect(range?.startTime.toISOString()).toBe('2025-11-01T00:00:00.000Z')
      expect(range?.endTime.toISOString()).toBe('2025-11-15T18:00:00.000Z')
    })

    it('should return null for non-existent dataset range', () => {
      const range = service.getDatasetRange('nonexistent')
      expect(range).toBeNull()
    })

    it('should parse timestamp correctly', () => {
      const range = service.getDatasetRange('temp')

      expect(range).not.toBeNull()
      expect(range?.startTime).toBeInstanceOf(Date)
      expect(range?.endTime).toBeInstanceOf(Date)
    })
  })

  describe('Status Checks', () => {
    it('should return false if not all configs loaded', () => {
      expect(service.isReady()).toBe(false)
    })

    it('should return true when all configs loaded', async () => {
      await service.loadAll()
      expect(service.isReady()).toBe(true)
    })

    it('should return false if only some configs loaded', async () => {
      await service.loadHypatiaConfig()
      await service.loadParamsConfig()

      expect(service.isReady()).toBe(false)
    })
  })
})
