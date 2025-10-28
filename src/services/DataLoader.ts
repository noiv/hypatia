/**
 * DataLoader - Loads weather data files (fp16 binary format)
 */

export interface WeatherData {
  temperature: Float32Array;
  wind_u: Float32Array;
  wind_v: Float32Array;
  metadata: {
    date: string;
    cycle: string;
    forecast: string;
  };
}

export class DataLoader {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Load a single timestep
   * @param date YYYYMMDD format
   * @param cycle 00z, 06z, 12z, or 18z
   * @param forecast 0h, 6h, 12h, etc.
   */
  async loadTimestep(date: string, cycle: string, forecast: string): Promise<WeatherData> {
    const temp = await this.loadParameter(date, cycle, forecast, 'temp2m');
    const wind_u = await this.loadParameter(date, cycle, forecast, 'wind10m_u');
    const wind_v = await this.loadParameter(date, cycle, forecast, 'wind10m_v');

    return {
      temperature: temp,
      wind_u,
      wind_v,
      metadata: {
        date,
        cycle,
        forecast
      }
    };
  }

  /**
   * Load a single parameter file
   */
  private async loadParameter(
    date: string,
    cycle: string,
    forecast: string,
    param: string
  ): Promise<Float32Array> {
    const url = `${this.basePath}/${date}_${cycle}_${forecast}_${param}.bin`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${param}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();

    // Convert to Float32Array (browser handles fp16 → fp32 conversion)
    // File is 1440 × 721 = 1,038,240 values
    // fp16 = 2 bytes per value = 2,076,480 bytes
    const expectedSize = 1440 * 721 * 2;
    if (buffer.byteLength !== expectedSize) {
      throw new Error(
        `Invalid file size for ${param}: expected ${expectedSize} bytes, got ${buffer.byteLength}`
      );
    }

    // Create Float16Array view, then convert to Float32Array
    const uint16View = new Uint16Array(buffer);
    const float32 = new Float32Array(uint16View.length);

    // Decode fp16 → fp32 (WebGL will handle this automatically for textures)
    // For now, we store as-is and let DataTexture handle conversion
    for (let i = 0; i < uint16View.length; i++) {
      float32[i] = this.fp16ToFp32(uint16View[i]!);
    }

    return float32;
  }

  /**
   * Convert fp16 (stored as uint16) to fp32
   */
  private fp16ToFp32(h: number): number {
    const sign = (h & 0x8000) >> 15;
    const exponent = (h & 0x7C00) >> 10;
    const fraction = h & 0x03FF;

    if (exponent === 0) {
      // Denormalized
      return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
    } else if (exponent === 31) {
      // Infinity or NaN
      return fraction === 0 ? (sign ? -Infinity : Infinity) : NaN;
    } else {
      // Normalized
      return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
    }
  }
}
