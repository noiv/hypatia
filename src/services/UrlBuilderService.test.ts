/**
 * UrlBuilderService Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UrlBuilderService } from './UrlBuilderService'
import { ConfigService } from './ConfigService'
import { mockHypatiaConfig, mockDataManifest } from '../__tests__/mocks/mockConfigs'

describe('UrlBuilderService', () => {
  let service: UrlBuilderService
  let configService: ConfigService

  beforeEach(async () => {
    // Mock fetch for config loading
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url.toString()

      if (urlString.includes('hypatia.config.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockHypatiaConfig),
        } as Response)
      }

      if (urlString.includes('manifest.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDataManifest),
        } as Response)
      }

      // Return ok for other configs (not used in these tests)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response)
    })

    configService = new ConfigService()
    await configService.loadHypatiaConfig()
    await configService.loadDataManifest()

    service = new UrlBuilderService(configService)
  })

  describe('Local URL Building', () => {
    it('should build local URL correctly', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251109',
        timestep: 12,
      })

      expect(url).toBe('http://localhost/data/temp2m/20251109_12z.bin')
    })

    it('should format cycle with leading zeros', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251109',
        timestep: 6,
      })

      expect(url).toContain('06z')
    })

    it('should handle different parameters', () => {
      const tempUrl = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251109',
        timestep: 0,
      })

      const windUrl = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'wind10u',
        date: '20251109',
        timestep: 0,
      })

      expect(tempUrl).toContain('/temp2m/')
      expect(windUrl).toContain('/wind10u/')
    })

    it('should handle midnight (00z)', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251109',
        timestep: 0,
      })

      expect(url).toContain('00z')
    })

    it('should handle late hours (18z)', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251109',
        timestep: 18,
      })

      expect(url).toContain('18z')
    })
  })

  describe('Date Range Validation', () => {
    it('should return URL for date within range', () => {
      // Mock manifest has range: 20251101_00z-20251115_18z
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251105',
        timestep: 12,
      })

      expect(url).not.toBeNull()
      expect(url).toContain('20251105')
    })

    it('should return null for date before range', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251001', // Before 20251101
        timestep: 12,
      })

      expect(url).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should return null for date after range', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251120', // After 20251115
        timestep: 12,
      })

      expect(url).toBeNull()

      consoleSpy.mockRestore()
    })

    it('should handle exact start date', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251101',
        timestep: 0,
      })

      expect(url).not.toBeNull()
    })

    it('should handle exact end date', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251115',
        timestep: 18,
      })

      expect(url).not.toBeNull()
    })

    it('should handle parameter with no dataset info', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'geopotential', // Not in mock manifest
        date: '20251109',
        timestep: 12,
      })

      // Should return URL anyway (for development)
      expect(url).not.toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('Provider Support', () => {
    it('should handle local provider', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251109',
        timestep: 12,
      })

      expect(url).toBeTruthy()
    })

    it('should return null for ECMWF provider (not implemented)', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const url = service.buildUrl({
        provider: 'ecmwf',
        model: 'ifs',
        param: 'temp',
        date: '20251109',
        timestep: 12,
      })

      expect(url).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should return null for Copernicus provider (not implemented)', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const url = service.buildUrl({
        provider: 'copernicus',
        model: 'era5',
        param: 'temp',
        date: '20251109',
        timestep: 12,
      })

      expect(url).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('Bulk URL Building', () => {
    it('should build multiple URLs', () => {
      const urls = service.buildUrls(
        {
          provider: 'local',
          model: 'ifs',
          param: 'temp',
        },
        ['20251105', '20251105', '20251105'],
        [0, 6, 12]
      )

      expect(urls.length).toBe(3)
      expect(urls[0]).toContain('00z')
      expect(urls[1]).toContain('06z')
      expect(urls[2]).toContain('12z')
    })

    it('should handle mix of valid and invalid dates', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const urls = service.buildUrls(
        {
          provider: 'local',
          model: 'ifs',
          param: 'temp',
        },
        ['20251105', '20251001', '20251105'], // Middle one is out of range
        [0, 6, 12]
      )

      expect(urls.length).toBe(3)
      expect(urls[0]).not.toBeNull()
      expect(urls[1]).toBeNull() // Out of range
      expect(urls[2]).not.toBeNull()

      consoleSpy.mockRestore()
    })

    it('should throw if dates and timesteps length mismatch', () => {
      expect(() => {
        service.buildUrls(
          {
            provider: 'local',
            model: 'ifs',
            param: 'temp',
          },
          ['20251105', '20251106'],
          [0, 6, 12] // Different length
        )
      }).toThrow('same length')
    })
  })

  describe('Dataset Queries', () => {
    it('should get available range', () => {
      const range = service.getAvailableRange('temp')

      expect(range).not.toBeNull()
      expect(range?.startTime.toISOString()).toBe('2025-11-01T00:00:00.000Z')
      expect(range?.endTime.toISOString()).toBe('2025-11-15T18:00:00.000Z')
    })

    it('should return null for non-existent parameter', () => {
      const range = service.getAvailableRange('geopotential')
      expect(range).toBeNull()
    })

    it('should check if dataset exists', () => {
      expect(service.hasDataset('temp')).toBe(true)
      expect(service.hasDataset('wind')).toBe(true)
      expect(service.hasDataset('geopotential')).toBe(false)
    })

    it('should get dataset step', () => {
      const step = service.getDatasetStep('temp')
      expect(step).toBe('6h')
    })

    it('should return null for non-existent dataset step', () => {
      const step = service.getDatasetStep('geopotential')
      expect(step).toBeNull()
    })

    it('should get dataset count', () => {
      const count = service.getDatasetCount('temp')
      expect(count).toBe(60)
    })

    it('should return 0 for non-existent dataset count', () => {
      const count = service.getDatasetCount('geopotential')
      expect(count).toBe(0)
    })

    it('should get missing timesteps', () => {
      const missing = service.getMissingTimesteps('wind')
      expect(missing).toEqual(['20251105_06z'])
    })

    it('should return empty array for parameter with no missing timesteps', () => {
      const missing = service.getMissingTimesteps('temp')
      expect(missing).toEqual([])
    })

    it('should return empty array for non-existent parameter', () => {
      const missing = service.getMissingTimesteps('geopotential')
      expect(missing).toEqual([])
    })
  })

  describe('Edge Cases', () => {
    it('should handle end of year date', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20251231',
        timestep: 23,
      })

      // Out of range per mock manifest, but should still build URL
      expect(url).toBeNull() // Out of manifest range
    })

    it('should handle leap year date', () => {
      const url = service.buildUrl({
        provider: 'local',
        model: 'ifs',
        param: 'temp',
        date: '20240229', // Leap year
        timestep: 12,
      })

      // Out of range, but date format is valid
      expect(url).toBeNull() // Out of manifest range
    })

    it('should handle all 24 hours of the day', () => {
      for (let hour = 0; hour < 24; hour++) {
        const url = service.buildUrl({
          provider: 'local',
          model: 'ifs',
          param: 'temp',
          date: '20251105',
          timestep: hour,
        })

        expect(url).toBeTruthy()
        expect(url).toContain(`${hour.toString().padStart(2, '0')}z`)
      }
    })
  })
})
