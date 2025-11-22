# Atmosphere Shader Documentation

## Overview

The atmosphere is rendered as a sphere mesh slightly larger than Earth, using a custom shader that simulates atmospheric scattering. The shader uses a simplified approach combining a base atmospheric layer with rim lighting for realistic edge glow.

## Approach

**Type**: Geometry-based shader (not post-processing)
**Geometry**: Sphere mesh at `atmosphereRadius` (100km above Earth surface)
**Rendering**: FrontSide, transparent, additive blending, no depth write

### Two-Layer System

The shader combines two layers for realistic appearance:

1. **Base Atmospheric Layer**: Uniform blue coverage across the dayside
2. **Rim Glow**: Soft edge glow that fades toward the center

This creates the appearance of:
- Blue sky covering the illuminated hemisphere
- Bright atmospheric glow at the limb (edge)
- Sunset/twilight colors at the day/night terminator
- Smooth, gradual falloff to space

## Shader Parameters

### Rim Falloff (`pow(rim, 4.5)`)

**Location**: Line 499
**Current value**: `4.5`
**Range**: `2.0` - `7.0`

Controls the softness of the atmospheric edge glow.

- **Lower values** (2.0-3.0): Sharper, more defined edge - atmosphere appears as thin shell
- **Higher values** (5.0-7.0): Softer, more gradual falloff - atmosphere appears thicker, more diffuse
- **Current 4.5**: Balanced soft edge without being too diffuse

**Visual effect**: This is the primary control for the "sharp cutoff" issue. Higher = softer edge.

### Base Atmosphere Strength (`twilight * 0.65`)

**Location**: Line 512
**Current value**: `0.65`
**Range**: `0.0` - `1.0`

Controls how much blue atmospheric coverage appears across the dayside, independent of rim glow.

- **0.0**: No base layer - only rim glow visible (thin shell appearance)
- **0.3-0.5**: Subtle blue tint on dayside
- **0.65** (current): Strong blue coverage - atmosphere visible across hemisphere
- **1.0**: Maximum coverage - may appear too opaque

**Visual effect**: Controls how much "the blue covers the planet" - higher values make atmosphere visible throughout its depth, not just at edges.

### Rim Intensity Multiplier (`rim * twilight * 0.5`)

**Location**: Line 513
**Current value**: `0.5`
**Range**: `0.0` - `1.0`

Controls the strength of the rim glow relative to the base layer.

- **Low values** (0.3-0.5): Rim glow is subtle accent to base layer
- **High values** (0.7-1.0): Bright, prominent edge glow dominates
- **Current 0.5**: Balanced - rim visible but doesn't overpower base layer

**Visual effect**: Adjust if rim appears too bright/dim relative to overall atmosphere.

### Base Alpha Contribution (`baseAtmosphere * 0.7`)

**Location**: Line 519
**Current value**: `0.7`
**Range**: `0.0` - `1.0`

Opacity of the base atmospheric layer.

- **Low values** (0.3-0.5): More transparent, see-through atmosphere
- **High values** (0.7-0.9): More opaque, solid-looking atmosphere
- **Current 0.7**: Strong presence without obscuring Earth surface details

**Visual effect**: Controls how much the atmosphere blocks/tints the view of Earth below.

### Rim Alpha Contribution (`rim * twilight * 0.4`)

**Location**: Line 519
**Current value**: `0.4`
**Range**: `0.0` - `1.0`

Additional opacity added at the rim/edge.

- **Low values** (0.2-0.4): Subtle edge brightening
- **High values** (0.6-0.8): Strong bright rim
- **Current 0.4**: Visible edge enhancement without halo effect

**Combined Alpha**: `(baseAtmosphere * 0.7) + (rim * twilight * 0.4)`
Max possible: ~0.7 + 0.4 = 1.1 (clamped to 1.0)

## Color Parameters

### Day Color (`vec3(0.4, 0.6, 1.0)`)

**Location**: Line 506
**Current value**: RGB(0.4, 0.6, 1.0) - Sky blue
**Type**: RGB values, range 0.0-1.0 each

The primary atmospheric color on the illuminated (day) side.

- **R=0.4, G=0.6, B=1.0**: Light blue (Rayleigh scattering color)
- Represents shorter wavelength (blue) light scattering

**Adjustment tips**:
- Increase blue (B) for deeper sky color
- Adjust green (G) for cyan/turquoise tints
- Keep red (R) lower for realistic daytime atmosphere

### Sunset Color (`vec3(1.0, 0.5, 0.2)`)

**Location**: Line 507
**Current value**: RGB(1.0, 0.5, 0.2) - Orange/red
**Type**: RGB values, range 0.0-1.0 each

Color at the day/night terminator (twilight zone).

- **R=1.0, G=0.5, B=0.2**: Orange-red sunset color
- Represents longer wavelength light at low sun angles

**Adjustment tips**:
- Increase red (R) for redder sunsets
- Increase green (G) for yellower sunsets
- Decrease blue (B) for warmer colors

### Sunset Factor (`pow(1.0 - abs(sunDot), 1.5)`)

**Location**: Line 508
**Current value**: Exponent `1.5`
**Range**: `1.0` - `3.0`

Controls how sunset color blends at the terminator.

- **1.0**: Linear falloff - gradual sunset band
- **1.5** (current): Moderate concentration at terminator
- **2.0+**: Sharp, narrow sunset band

**Visual effect**: Higher values create more concentrated, vivid sunset colors at horizon.

### Sunset Mix Amount (`sunsetFactor * 0.8`)

**Location**: Line 509
**Current value**: `0.8`
**Range**: `0.0` - `1.0`

How much sunset color replaces day color at terminator.

- **0.0**: No sunset colors - always blue
- **0.5**: Subtle orange tint at terminator
- **0.8** (current): Strong sunset colors - prominent orange/red band
- **1.0**: Maximum sunset color

**Visual effect**: Controls intensity/visibility of sunset colors.

## Sun Illumination

### Twilight Zone Width (`smoothstep(-0.2, 0.2, sunDot)`)

**Location**: Line 503
**Current values**: `-0.2` to `0.2`
**Range**: `-0.5` to `0.5` (degrees as dot product)

Defines the transition zone between day and night.

- **Narrower** (-0.1, 0.1): Sharp day/night transition
- **Wider** (-0.3, 0.3): Gradual twilight zone
- **Current** (-0.2, 0.2): Balanced transition width

**Visual effect**: Wider values create longer twilight zones with more gradual color transitions.

## Configuration File Values

### atmosphere.config.json

Some parameters are loaded from `/src/layers/sun/atmosphere.config.json`:

```json
{
  "physical": {
    "planetRadius": 6371000,        // Earth radius in meters
    "atmosphereRadius": 6471000,    // +100km atmosphere height
    "sunIntensity": 22.0            // Overall brightness multiplier
  },
  "visual": {
    "exposure": 1.0                 // Post-exposure adjustment
  }
}
```

**Note**: The full ray-marching scattering code exists in the shader (lines 423-490) but is currently **not used**. The simpler two-layer approach (lines 492-521) provides good visual results with better performance.

## Tuning Guide

### To fix "sharp cutoff to space"
- Increase rim falloff exponent: `pow(rim, 5.0)` or higher

### To make atmosphere more visible across planet
- Increase base atmosphere: `twilight * 0.7` or higher
- Increase base alpha: `baseAtmosphere * 0.8`

### To make atmosphere thinner/subtler
- Decrease base atmosphere: `twilight * 0.4` or lower
- Decrease base alpha: `baseAtmosphere * 0.5`

### To enhance sunset colors
- Increase sunset mix: `sunsetFactor * 0.9`
- Make sunset color more saturated: `vec3(1.0, 0.4, 0.1)` (redder)
- Increase sunset factor exponent: `pow(..., 2.0)` (narrower band)

### To make atmosphere brighter overall
- Increase `sunIntensity` in atmosphere.config.json
- Increase both alpha contributions proportionally

### To make edge glow more prominent
- Increase rim intensity multiplier: `rim * twilight * 0.7`
- Increase rim alpha: `rim * twilight * 0.6`

## Current Settings Summary

**Optimized for**:
- ✓ Soft, gradual falloff to space (no sharp cutoff)
- ✓ Strong blue atmospheric coverage across dayside
- ✓ Prominent orange/red sunset colors at terminator
- ✓ Balanced rim glow without overpowering base layer
- ✓ Realistic Earth atmosphere appearance from space

**Performance**: Lightweight - simple per-fragment calculations, no ray marching

**Quality**: Good visual appearance balancing realism with artistic presentation

## Implementation Notes

- Shader uses **simplified scattering** - not physically accurate but visually appealing
- **BackSide/FrontSide**: Currently FrontSide - renders outer surface of atmosphere sphere
- **Blending**: AdditiveBlending - atmosphere colors add to scene (no darkening)
- **Depth**: depthWrite=false, depthTest=true - atmosphere renders over Earth but respects depth
- **Full ray-marching code**: Available but disabled - see `atmosphere()` function for physically-based approach
