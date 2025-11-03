/**
 * Text Rendering Configuration
 *
 * Centralized settings for troika-three-text labels
 * Controls appearance, sizing, and keyboard shortcuts
 */

export const TEXT_CONFIG = {
  // Font settings
  font: {
    // Inter: Modern sans-serif optimized for screen reading
    // Excellent legibility, clear number differentiation (1 vs l, 0 vs O)
    // Open source, includes all weights
    family: 'Inter',
    url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',

    // Fallback chain for robustness
    fallback: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'
  },

  // Size settings
  size: {
    default: 0.03,      // Base font size in world units
    min: 0.015,         // Minimum (50% of default)
    max: 0.06,          // Maximum (200% of default)
    step: 0.003,        // Increment/decrement step (10% of default)
  },

  // Color settings
  color: {
    default: 0xffffff,  // White (high contrast against space)
    graticule: 0xe0e0e0, // Slightly dimmed for graticule labels
    pressure: 0xffffff,  // White for pressure H/L labels
  },

  // Outline settings
  outline: {
    enabled: true,      // Outline enabled by default for readability
    width: 0.15,        // Outline width (percentage of fontSize)
    color: 0x000000,    // Black outline
    opacity: 0.8,       // 80% opacity
  },

  // Keyboard shortcuts
  hotkeys: {
    increase: ['Meta+=', 'Meta+Plus'],  // Cmd/Ctrl + (macOS: Cmd+=, Windows: Ctrl+=)
    decrease: ['Meta+-', 'Meta+Minus'], // Cmd/Ctrl -
    reset: ['Meta+0'],                   // Cmd/Ctrl 0 (reset to default size)
  },

  // Performance settings
  performance: {
    // Pre-render these characters during bootstrap
    characters: 'HLhPa0123456789°NESW-+.,\n ',

    // Update frequency
    updateOnlyWhenChanged: true,  // Don't update every frame

    // Culling
    frustumCulling: true,         // Hide labels behind globe
    cullDotThreshold: 0.0,        // Dot product threshold for back-face culling
  },

  // Billboard settings (always face camera)
  billboard: {
    enabled: true,      // Always face camera
    sizeAttenuation: false, // Constant screen size regardless of distance
  },

  // Positioning
  positioning: {
    // Graticule labels placed outside sphere for visibility
    graticuleRadiusMultiplier: 1.05,  // 5% beyond surface

    // Pressure labels on sphere surface
    pressureRadiusMultiplier: 1.0,
  },
} as const;

// Type exports for type safety
export type TextConfig = typeof TEXT_CONFIG;
export type FontSize = number; // World units
export type TextColor = number; // Hex color
