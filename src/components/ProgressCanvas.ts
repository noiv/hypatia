/**
 * Progress Canvas Component
 *
 * Renders a 2px height canvas below layer buttons showing cache state.
 * Each timestamp is represented by a small segment with colors:
 * - Transparent: not requested
 * - Layer color (pulsing): downloading
 * - Layer color (100%): downloaded
 * - Red: error/failed
 *
 * Updated directly from Scene.animate() loop for efficient rendering.
 */

import m from 'mithril';
import type { LayerId } from '../layers/ILayer';

export interface ProgressCanvasAttrs {
  layerId: LayerId;
  totalTimestamps: number;
  loadedIndices: Set<number>;
  loadingIndex: number | null;
  failedIndices: Set<number>;
  layerColor: string; // Hex color from config
  onCanvasCreated: ((layerId: LayerId, canvas: HTMLCanvasElement) => void) | undefined;
}

// Layer colors (can be moved to config later)
const LAYER_COLORS: Record<LayerId, string> = {
  temp: '#ff6b35',       // Orange-red
  rain: '#4ecdc4',       // Cyan
  wind: '#95e1d3',       // Light teal
  pressure: '#f38181',   // Light red
  humidity: '#a29bfe',   // Purple
  clouds: '#dfe6e9',     // Light gray
  waves: '#0984e3',      // Blue
  earth: '#4a69bd',      // Blue (unused)
  sun: '#feca57',        // Yellow (unused)
  graticule: '#ffffff',  // White (unused)
  text: '#ffffff',       // White (unused)
  debug: '#ff00ff'       // Magenta (dev only, unused)
};

const CANVAS_HEIGHT = 2; // pixels
const FAILED_COLOR = '#ff0000'; // Red for failed
const NOT_LOADED_COLOR = 'rgba(255, 255, 255, 0.3)'; // Default border color
const PULSE_PERIOD = 1000; // 1 second pulse cycle

// Parse hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1]!, 16),
        g: parseInt(result[2]!, 16),
        b: parseInt(result[3]!, 16)
      }
    : { r: 255, g: 255, b: 255 };
}

/**
 * Update progress canvas with current download state
 * Called directly from Scene.animate() loop with wallTime for pulsing animation
 */
export function updateProgressCanvas(
  canvas: HTMLCanvasElement,
  layerId: LayerId,
  totalTimestamps: number,
  loadedIndices: Set<number>,
  loadingIndex: number | null,
  failedIndices: Set<number>,
  wallTime: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // If no timestamps (layer not activated), draw solid default color
  if (totalTimestamps === 0) {
    ctx.fillStyle = NOT_LOADED_COLOR;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // Calculate segment width
  const segmentWidth = width / totalTimestamps;

  // Get layer color
  const layerColor = LAYER_COLORS[layerId] || '#ffffff';
  const rgb = hexToRgb(layerColor);

  // Calculate pulsing opacity (0.3 to 1.0) using wall clock
  const pulsePhase = (wallTime % PULSE_PERIOD) / PULSE_PERIOD;
  const pulseOpacity = 0.3 + 0.7 * Math.abs(Math.sin(pulsePhase * Math.PI * 2));

  // Draw each timestamp segment
  for (let i = 0; i < totalTimestamps; i++) {
    const x = i * segmentWidth;

    if (failedIndices.has(i)) {
      // Failed - red
      ctx.fillStyle = FAILED_COLOR;
      ctx.fillRect(x, 0, segmentWidth, height);
    } else if (i === loadingIndex) {
      // Downloading - pulsing animation
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${pulseOpacity})`;
      ctx.fillRect(x, 0, segmentWidth, height);
    } else if (loadedIndices.has(i)) {
      // Downloaded - 100% opacity
      ctx.fillStyle = layerColor;
      ctx.fillRect(x, 0, segmentWidth, height);
    } else {
      // Not loaded - default border color
      ctx.fillStyle = NOT_LOADED_COLOR;
      ctx.fillRect(x, 0, segmentWidth, height);
    }
  }
}

/**
 * Legacy redraw function for Mithril lifecycle (backward compatibility)
 * Will be removed once Scene handles all updates
 */
function redrawCanvas(vnode: m.VnodeDOM<ProgressCanvasAttrs>): void {
  const { layerId, totalTimestamps, loadedIndices, loadingIndex, failedIndices } = vnode.attrs;
  const canvas = vnode.dom as HTMLCanvasElement;

  // Use current time for pulse animation
  const wallTime = performance.now();

  updateProgressCanvas(
    canvas,
    layerId,
    totalTimestamps,
    loadedIndices,
    loadingIndex,
    failedIndices,
    wallTime
  );
}

export const ProgressCanvas: m.Component<ProgressCanvasAttrs> = {
  oncreate(vnode) {
    const canvas = vnode.dom as HTMLCanvasElement;

    // Notify parent that canvas is ready
    if (vnode.attrs.onCanvasCreated) {
      vnode.attrs.onCanvasCreated(vnode.attrs.layerId, canvas);
    }

    // Initial render
    redrawCanvas(vnode);
  },

  onupdate(vnode) {
    // Legacy update path - will be removed once Scene handles all updates
    redrawCanvas(vnode);
  },

  view() {
    const buttonWidth = 120; // Approximate button width, can be adjusted

    return m('canvas.progress-canvas', {
      width: buttonWidth,
      height: CANVAS_HEIGHT
    });
  }
};
