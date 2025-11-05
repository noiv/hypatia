/**
 * Surface Pressure layer configuration
 * Data downsampled to 2° resolution for efficient contour rendering
 */

export interface SpConfig {
  /** Pressure range in hPa (hectopascals / millibars) */
  pressureRange: {
    min: number;
    max: number;
  };
  /** Isobar levels for contour lines (4 hPa spacing, standard meteorological practice) */
  isobarLevels: number[];
  /** Visual settings */
  visual: {
    lineColor: string;
    lineWidth: number;
    opacity: number;
    altitudeKm: number;
  };
  /** Grid configuration (2° downsampled resolution) */
  grid: {
    /** Longitude points (180 for 2° resolution: 360° / 2°) */
    width: number;
    /** Latitude points (91 for 2° resolution: 180° / 2° + 1 for poles) */
    height: number;
    /** Resolution in degrees */
    resolution: number;
  };
  /** Data path configuration */
  data: {
    /** Folder name in data directory */
    folder: string;
    /** Parameter code in ECMWF system */
    ecmwfParam: string;
  };
}

/**
 * Default surface pressure configuration
 */
export const SP_CONFIG: SpConfig = {
  pressureRange: {
    min: 940, // Extreme low (strong hurricanes)
    max: 1050, // Extreme high (strong anticyclones)
  },
  isobarLevels: [
    // Standard 4 hPa spacing
    940, 944, 948, 952, 956, 960, 964, 968, 972, 976,
    980, 984, 988, 992, 996,
    1000, 1004, 1008,
    1012, 1016, 1020, 1024, 1028, 1032, 1036, 1040, 1044, 1048,
  ],
  visual: {
    lineColor: '#333333', // Dark gray, traditional weather map style
    lineWidth: 1.5,
    opacity: 0.85,
    altitudeKm: 2.5, // Slightly above temperature layer
  },
  grid: {
    width: 180, // 360° / 2° = 180 points
    height: 91, // 180° / 2° + 1 = 91 points (includes both poles)
    resolution: 2.0, // 2° grid spacing
  },
  data: {
    folder: 'sp_2deg',
    ecmwfParam: 'sp', // Surface pressure parameter code
  },
};
