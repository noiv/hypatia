/**
 * URL Builder Service
 *
 * Centralized service for building data file URLs.
 * Supports multiple providers (local HTTP, ECMWF, Copernicus) and models (IFS, AIFS, ERA5).
 * Validates parameters and returns null for out-of-range dates.
 */

import type { ConfigService } from './ConfigService'

export type DataProvider = 'local' | 'ecmwf' | 'copernicus'
export type DataModel = 'ifs' | 'aifs' | 'era5'
export type DataParam =
  | 'temp'
  | 'wind10u'
  | 'wind10v'
  | 'rain'
  | 'pressure'
  | 'geopotential'

export interface UrlParams {
  provider: DataProvider
  model: DataModel
  param: DataParam
  date: string // YYYYMMDD format
  timestep: number // hour (0-23)
  alt?: number // pressure level (optional, for 3D data)
}

export class UrlBuilderService {
  constructor(private config: ConfigService) {}

  /**
   * Build URL for data file
   *
   * @param params - URL parameters
   * @returns URL string, or null if parameters are invalid or out of range
   */
  buildUrl(params: UrlParams): string | null {
    // Validate date is within available range
    if (!this.isDateInRange(params.param, params.date, params.timestep)) {
      return null
    }

    // Delegate to provider-specific builder
    switch (params.provider) {
      case 'local':
        return this.buildLocalUrl(params)
      case 'ecmwf':
        return this.buildEcmwfUrl(params)
      case 'copernicus':
        return this.buildCopernicusUrl(params)
      default:
        console.warn(`[UrlBuilderService] Unknown provider: ${params.provider}`)
        return null
    }
  }

  /**
   * Build URL for local HTTP server
   *
   * Format: {baseUrl}/{param}/{YYYYMMDD}_{HHz}.bin
   * Example: http://localhost/data/temp2m/20251109_12z.bin
   */
  private buildLocalUrl(params: UrlParams): string {
    const baseUrl = this.config.getDataBaseUrl()
    const cycle = this.formatCycle(params.timestep)
    const filename = `${params.date}_${cycle}.bin`

    return `${baseUrl}/${params.param}/${filename}`
  }

  /**
   * Build URL for ECMWF API
   *
   * Note: This is a placeholder for future ECMWF API integration.
   * ECMWF uses grib2 format and requires authentication.
   *
   * @returns URL string or null if not implemented
   */
  private buildEcmwfUrl(_params: UrlParams): string | null {
    // TODO: Implement ECMWF API URL building
    // Will need:
    // - API endpoint configuration
    // - Authentication token
    // - GRIB2 parameter mapping
    // - Request format (REST API, OData, etc.)

    console.warn('[UrlBuilderService] ECMWF provider not yet implemented')
    return null
  }

  /**
   * Build URL for Copernicus Marine Service
   *
   * Note: This is a placeholder for future Copernicus integration.
   * Copernicus uses netCDF format and has different data organization.
   *
   * @returns URL string or null if not implemented
   */
  private buildCopernicusUrl(_params: UrlParams): string | null {
    // TODO: Implement Copernicus URL building
    // Will need:
    // - Copernicus API endpoint
    // - Authentication credentials
    // - NetCDF dataset IDs
    // - Parameter mapping to Copernicus variables

    console.warn('[UrlBuilderService] Copernicus provider not yet implemented')
    return null
  }

  /**
   * Check if date and timestep are within available data range
   *
   * @param param - Parameter name
   * @param date - Date string (YYYYMMDD)
   * @param timestep - Hour (0-23)
   * @returns true if data is available, false otherwise
   */
  private isDateInRange(param: DataParam, date: string, timestep: number): boolean {
    const datasetInfo = this.config.getDatasetInfo(param)

    // If no dataset info, assume data is available (for testing/development)
    if (!datasetInfo) {
      console.warn(`[UrlBuilderService] No dataset info for ${param}, assuming data is available`)
      return true
    }

    // Parse date range from manifest
    const range = this.config.getDatasetRange(param)
    if (!range) {
      console.warn(`[UrlBuilderService] Could not parse date range for ${param}`)
      return false
    }

    // Build Date object for requested timestamp
    const year = parseInt(date.slice(0, 4))
    const month = parseInt(date.slice(4, 6)) - 1 // 0-indexed
    const day = parseInt(date.slice(6, 8))
    const requestedTime = new Date(Date.UTC(year, month, day, timestep, 0, 0, 0))

    // Check if within range
    const isInRange =
      requestedTime >= range.startTime && requestedTime <= range.endTime

    if (!isInRange) {
      console.debug(
        `[UrlBuilderService] Date ${date}_${this.formatCycle(timestep)} for ${param} is outside available range`,
        {
          requested: requestedTime.toISOString(),
          available: `${range.startTime.toISOString()} to ${range.endTime.toISOString()}`,
        }
      )
    }

    return isInRange
  }

  /**
   * Format hour as cycle string (00z, 06z, 12z, 18z)
   *
   * @param hour - Hour (0-23)
   * @returns Cycle string (e.g., "12z")
   */
  private formatCycle(hour: number): string {
    return `${hour.toString().padStart(2, '0')}z`
  }

  /**
   * Build URLs for a time range
   *
   * Convenience method for building multiple URLs at once.
   *
   * @param params - Base parameters (provider, model, param, alt)
   * @param dates - Array of date strings (YYYYMMDD)
   * @param timesteps - Array of hours (0-23), same length as dates
   * @returns Array of URLs (null entries for out-of-range dates)
   */
  buildUrls(
    baseParams: Omit<UrlParams, 'date' | 'timestep'>,
    dates: string[],
    timesteps: number[]
  ): (string | null)[] {
    if (dates.length !== timesteps.length) {
      throw new Error('dates and timesteps arrays must have same length')
    }

    return dates.map((date, i) => {
      const timestep = timesteps[i]!
      return this.buildUrl({
        ...baseParams,
        date,
        timestep,
      })
    })
  }

  /**
   * Get available date range for a parameter
   *
   * @param param - Parameter name
   * @returns Date range or null if not available
   */
  getAvailableRange(param: DataParam): { startTime: Date; endTime: Date } | null {
    return this.config.getDatasetRange(param)
  }

  /**
   * Check if a parameter has data available
   *
   * @param param - Parameter name
   * @returns true if dataset info exists
   */
  hasDataset(param: DataParam): boolean {
    return this.config.getDatasetInfo(param) !== undefined
  }

  /**
   * Get dataset step interval (e.g., "6h" for 6-hourly data)
   *
   * @param param - Parameter name
   * @returns Step interval string or null if not available
   */
  getDatasetStep(param: DataParam): string | null {
    const datasetInfo = this.config.getDatasetInfo(param)
    return datasetInfo?.step ?? null
  }

  /**
   * Get total number of timesteps available for a parameter
   *
   * @param param - Parameter name
   * @returns Count or 0 if not available
   */
  getDatasetCount(param: DataParam): number {
    const datasetInfo = this.config.getDatasetInfo(param)
    return datasetInfo?.count ?? 0
  }

  /**
   * Get list of missing timesteps for a parameter
   *
   * @param param - Parameter name
   * @returns Array of missing timestamp strings (e.g., ["20251105_06z"])
   */
  getMissingTimesteps(param: DataParam): string[] {
    const datasetInfo = this.config.getDatasetInfo(param)
    return datasetInfo?.missing ?? []
  }
}
