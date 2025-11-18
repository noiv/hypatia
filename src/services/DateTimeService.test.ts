/**
 * DateTimeService Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DateTimeService } from './DateTimeService'
import type { TimeStep } from '../config/types'

describe('DateTimeService', () => {
  let service: DateTimeService

  beforeEach(() => {
    service = new DateTimeService()
  })

  describe('Data Window Calculations', () => {
    it('should calculate data window correctly', () => {
      const currentTime = new Date('2025-11-09T12:00:00Z')
      const maxRangeDays = 15

      const { startTime, endTime } = service.calculateDataWindow(currentTime, maxRangeDays)

      // Start should be 7 days back (floor(15/2)) at 00:00 UTC
      expect(startTime.toISOString()).toBe('2025-11-02T00:00:00.000Z')

      // End should be 15 days after start
      expect(endTime.toISOString()).toBe('2025-11-17T00:00:00.000Z')
    })

    it('should handle odd number of days', () => {
      const currentTime = new Date('2025-11-09T12:00:00Z')
      const maxRangeDays = 14

      const { startTime, endTime } = service.calculateDataWindow(currentTime, maxRangeDays)

      // floor(14/2) = 7 days back
      expect(startTime.toISOString()).toBe('2025-11-02T00:00:00.000Z')
      expect(endTime.toISOString()).toBe('2025-11-16T00:00:00.000Z')
    })

    it('should check if time is within data window', () => {
      const currentTime = new Date('2025-11-09T12:00:00Z')
      const maxRangeDays = 15

      // Time within window
      const withinTime = new Date('2025-11-05T12:00:00Z')
      expect(service.isWithinDataWindow(withinTime, currentTime, maxRangeDays)).toBe(true)

      // Time before window
      const beforeTime = new Date('2025-11-01T12:00:00Z')
      expect(service.isWithinDataWindow(beforeTime, currentTime, maxRangeDays)).toBe(false)

      // Time after window
      const afterTime = new Date('2025-11-18T12:00:00Z')
      expect(service.isWithinDataWindow(afterTime, currentTime, maxRangeDays)).toBe(false)

      // Exact start time (inclusive)
      const startTime = new Date('2025-11-02T00:00:00Z')
      expect(service.isWithinDataWindow(startTime, currentTime, maxRangeDays)).toBe(true)

      // Exact end time (exclusive)
      const endTime = new Date('2025-11-17T00:00:00Z')
      expect(service.isWithinDataWindow(endTime, currentTime, maxRangeDays)).toBe(false)
    })

    it('should clamp time to data window', () => {
      const currentTime = new Date('2025-11-09T12:00:00Z')
      const maxRangeDays = 15

      // Time before window - clamp to start
      const beforeTime = new Date('2025-11-01T12:00:00Z')
      const clampedBefore = service.clampToDataWindow(beforeTime, currentTime, maxRangeDays)
      expect(clampedBefore.toISOString()).toBe('2025-11-02T00:00:00.000Z')

      // Time after window - clamp to end
      const afterTime = new Date('2025-11-18T12:00:00Z')
      const clampedAfter = service.clampToDataWindow(afterTime, currentTime, maxRangeDays)
      expect(clampedAfter.toISOString()).toBe('2025-11-17T00:00:00.000Z')

      // Time within window - no change
      const withinTime = new Date('2025-11-05T12:00:00Z')
      const clampedWithin = service.clampToDataWindow(withinTime, currentTime, maxRangeDays)
      expect(clampedWithin.toISOString()).toBe('2025-11-05T12:00:00.000Z')
    })
  })

  describe('TimeStep Parsing', () => {
    it('should parse timestep correctly', () => {
      const step: TimeStep = {
        date: '20251109',
        cycle: '12z',
        filePath: '/data/temp2m/20251109_12z.bin',
      }

      const parsed = service.parseTimeStep(step)

      expect(parsed.toISOString()).toBe('2025-11-09T12:00:00.000Z')
      expect(parsed.getUTCFullYear()).toBe(2025)
      expect(parsed.getUTCMonth()).toBe(10) // November (0-indexed)
      expect(parsed.getUTCDate()).toBe(9)
      expect(parsed.getUTCHours()).toBe(12)
    })

    it('should handle different cycles', () => {
      const cycles = ['00z', '06z', '12z', '18z']
      const expectedHours = [0, 6, 12, 18]

      cycles.forEach((cycle, i) => {
        const step: TimeStep = {
          date: '20251109',
          cycle,
          filePath: '/data/temp2m/20251109_' + cycle + '.bin',
        }

        const parsed = service.parseTimeStep(step)
        expect(parsed.getUTCHours()).toBe(expectedHours[i])
      })
    })
  })

  describe('TimeStep Generation', () => {
    it('should generate timesteps correctly', () => {
      const currentTime = new Date('2025-11-09T12:00:00Z')
      const maxRangeDays = 2 // Small range for testing
      const stepHours = 6
      const dataBaseUrl = 'http://localhost/data'
      const paramName = 'temp2m'

      const steps = service.generateTimeSteps(
        currentTime,
        maxRangeDays,
        stepHours,
        dataBaseUrl,
        paramName
      )

      // 2 days × 4 steps/day = 8 timesteps
      expect(steps.length).toBe(8)

      // First step should be at start of window (2025-11-08 00z)
      expect(steps[0]?.date).toBe('20251108')
      expect(steps[0]?.cycle).toBe('00z')
      expect(steps[0]?.filePath).toBe('http://localhost/data/temp2m/20251108_00z.bin')

      // Last step should be 18z the next day (not quite 2 full days)
      expect(steps[7]?.date).toBe('20251109')
      expect(steps[7]?.cycle).toBe('18z')
    })

    it('should generate correct number of timesteps', () => {
      const currentTime = new Date('2025-11-09T12:00:00Z')
      const maxRangeDays = 15
      const stepHours = 6

      const steps = service.generateTimeSteps(
        currentTime,
        maxRangeDays,
        stepHours,
        'http://localhost/data',
        'temp2m'
      )

      // 15 days × 4 steps/day = 60 timesteps
      expect(steps.length).toBe(60)
    })
  })

  describe('Time to Index Conversion', () => {
    const mockTimeSteps: TimeStep[] = [
      { date: '20251109', cycle: '00z', filePath: '/data/20251109_00z.bin' },
      { date: '20251109', cycle: '06z', filePath: '/data/20251109_06z.bin' },
      { date: '20251109', cycle: '12z', filePath: '/data/20251109_12z.bin' },
      { date: '20251109', cycle: '18z', filePath: '/data/20251109_18z.bin' },
    ]

    it('should return exact index when time matches timestep', () => {
      const time = new Date('2025-11-09T12:00:00Z')
      const index = service.timeToIndex(time, mockTimeSteps)

      expect(index).toBe(2) // Third timestep (index 2)
    })

    it('should interpolate between timesteps', () => {
      // 09:00 is halfway between 06z and 12z
      const time = new Date('2025-11-09T09:00:00Z')
      const index = service.timeToIndex(time, mockTimeSteps)

      expect(index).toBe(1.5) // Between index 1 and 2
    })

    it('should clamp to 0 if time is before first timestep', () => {
      const time = new Date('2025-11-08T22:00:00Z')
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const index = service.timeToIndex(time, mockTimeSteps)

      expect(index).toBe(0)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should clamp to length-1 if time is after last timestep', () => {
      const time = new Date('2025-11-09T22:00:00Z')
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const index = service.timeToIndex(time, mockTimeSteps)

      expect(index).toBe(3) // Last index
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should handle empty timesteps array', () => {
      const time = new Date('2025-11-09T12:00:00Z')
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const index = service.timeToIndex(time, [])

      expect(index).toBe(0)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('Index to Time Conversion', () => {
    const mockTimeSteps: TimeStep[] = [
      { date: '20251109', cycle: '00z', filePath: '/data/20251109_00z.bin' },
      { date: '20251109', cycle: '06z', filePath: '/data/20251109_06z.bin' },
      { date: '20251109', cycle: '12z', filePath: '/data/20251109_12z.bin' },
      { date: '20251109', cycle: '18z', filePath: '/data/20251109_18z.bin' },
    ]

    it('should return exact time for integer index', () => {
      const time = service.indexToTime(2, mockTimeSteps)
      expect(time.toISOString()).toBe('2025-11-09T12:00:00.000Z')
    })

    it('should interpolate for fractional index', () => {
      const time = service.indexToTime(1.5, mockTimeSteps)
      // Halfway between 06z and 12z = 09:00
      expect(time.toISOString()).toBe('2025-11-09T09:00:00.000Z')
    })

    it('should handle edge cases', () => {
      const firstTime = service.indexToTime(0, mockTimeSteps)
      expect(firstTime.toISOString()).toBe('2025-11-09T00:00:00.000Z')

      const lastTime = service.indexToTime(3, mockTimeSteps)
      expect(lastTime.toISOString()).toBe('2025-11-09T18:00:00.000Z')
    })
  })

  describe('Adjacent Indices', () => {
    const mockTimeSteps: TimeStep[] = [
      { date: '20251109', cycle: '00z', filePath: '/data/20251109_00z.bin' },
      { date: '20251109', cycle: '06z', filePath: '/data/20251109_06z.bin' },
      { date: '20251109', cycle: '12z', filePath: '/data/20251109_12z.bin' },
      { date: '20251109', cycle: '18z', filePath: '/data/20251109_18z.bin' },
    ]

    it('should return both floor and ceil indices for interpolation', () => {
      const time = new Date('2025-11-09T09:00:00Z')
      const indices = service.getAdjacentIndices(time, mockTimeSteps)

      expect(indices).toEqual([1, 2])
    })

    it('should return single index when exactly on timestep', () => {
      const time = new Date('2025-11-09T12:00:00Z')
      const indices = service.getAdjacentIndices(time, mockTimeSteps)

      expect(indices).toEqual([2])
    })
  })

  describe('Time Manipulation', () => {
    it('should add hours correctly', () => {
      const time = new Date('2025-11-09T12:00:00Z')
      const result = service.addHours(time, 6)

      expect(result.toISOString()).toBe('2025-11-09T18:00:00.000Z')
    })

    it('should handle negative hours', () => {
      const time = new Date('2025-11-09T12:00:00Z')
      const result = service.addHours(time, -6)

      expect(result.toISOString()).toBe('2025-11-09T06:00:00.000Z')
    })

    it('should add days correctly', () => {
      const time = new Date('2025-11-09T12:00:00Z')
      const result = service.addDays(time, 3)

      expect(result.toISOString()).toBe('2025-11-12T12:00:00.000Z')
    })

    it('should round to next hour', () => {
      const time = new Date('2025-11-09T12:34:56Z')
      const result = service.roundToHour(time, 1)

      expect(result.toISOString()).toBe('2025-11-09T13:00:00.000Z')
    })

    it('should round to previous hour', () => {
      const time = new Date('2025-11-09T12:34:56Z')
      const result = service.roundToHour(time, -1)

      expect(result.toISOString()).toBe('2025-11-09T12:00:00.000Z')
    })

    it('should jump to next hour when already on hour mark', () => {
      const time = new Date('2025-11-09T12:00:00Z')
      const result = service.roundToHour(time, 1)

      expect(result.toISOString()).toBe('2025-11-09T13:00:00.000Z')
    })

    it('should round to 10-minute marks', () => {
      const time = new Date('2025-11-09T12:34:56Z')

      const next = service.roundToTenMinutes(time, 1)
      expect(next.toISOString()).toBe('2025-11-09T12:40:00.000Z')

      const prev = service.roundToTenMinutes(time, -1)
      expect(prev.toISOString()).toBe('2025-11-09T12:30:00.000Z')
    })
  })

  describe('Formatting', () => {
    it('should format datetime for display', () => {
      const time = new Date('2025-11-09T12:34:56Z')
      const formatted = service.formatDateTime(time)

      // Format depends on locale, just check it's non-empty
      expect(formatted).toBeTruthy()
      expect(typeof formatted).toBe('string')
    })

    it('should format time for header', () => {
      const time = new Date('2025-11-09T12:34:56Z')
      const { local, utc } = service.formatTimeForHeader(time)

      expect(local).toBeTruthy()
      expect(utc).toContain('UTC')
      expect(utc).toContain('2025-11-09')
    })

    it('should get timezone info', () => {
      const { short, long } = service.getTimezoneInfo()

      expect(short).toBeTruthy()
      expect(long).toBeTruthy()
    })

    it('should get timestep info', () => {
      const time = new Date('2025-11-09T14:30:00Z')
      const info = service.getTimestepInfo(time)

      expect(info.date).toBe('20251109')
      expect(info.cycle).toBe('12z') // 14:00 belongs to 12z cycle
      expect(info.forecast).toBe('2h') // 2 hours into the cycle
    })
  })

  describe('Current Time Fetching', () => {
    it('should return local time when server disabled', async () => {
      const before = Date.now()
      const time = await service.getCurrentTime(false)
      const after = Date.now()

      expect(time.getTime()).toBeGreaterThanOrEqual(before)
      expect(time.getTime()).toBeLessThanOrEqual(after + 100) // Small buffer
    })

    it('should fallback to local time on server error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const time = await service.getCurrentTime(true)

      expect(time).toBeInstanceOf(Date)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})
