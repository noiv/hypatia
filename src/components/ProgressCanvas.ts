/**
 * Progress Canvas Component
 *
 * Renders a 2px height canvas below layer buttons showing cache state.
 * Each timestamp is represented by a small segment with colors:
 * - Transparent: not loaded
 * - Layer color (100%): loaded
 * - Layer color (50%): currently loading
 * - Red: failed/missing file
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
}

// Layer colors (can be moved to config later)
const LAYER_COLORS: Record<LayerId, string> = {
  temp2m: '#ff6b35',          // Orange-red
  precipitation: '#4ecdc4',   // Cyan
  wind10m: '#95e1d3',         // Light teal
  pressure_msl: '#f38181',    // Light red
  earth: '#4a69bd',           // Blue (unused)
  sun: '#feca57',             // Yellow (unused)
  graticule: '#ffffff',       // White (unused)
  text: '#ffffff'             // White (unused)
};

const CANVAS_HEIGHT = 2; // pixels
const FAILED_COLOR = '#ff0000'; // Red for failed

function redrawCanvas(vnode: m.VnodeDOM<ProgressCanvasAttrs>): void {
    const { layerId, totalTimestamps, loadedIndices, loadingIndex, failedIndices } = vnode.attrs;
    const canvas = vnode.dom as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (totalTimestamps === 0) return;

    // Calculate segment width
    const segmentWidth = width / totalTimestamps;

    // Get layer color
    const layerColor = LAYER_COLORS[layerId] || '#ffffff';

    // Parse hex color to RGB
    const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1]!, 16),
            g: parseInt(result[2]!, 16),
            b: parseInt(result[3]!, 16)
          }
        : { r: 255, g: 255, b: 255 };
    };

    const rgb = hexToRgb(layerColor);

    // Draw each timestamp segment
    for (let i = 0; i < totalTimestamps; i++) {
      const x = i * segmentWidth;

      if (failedIndices.has(i)) {
        // Failed - red
        ctx.fillStyle = FAILED_COLOR;
        ctx.fillRect(x, 0, segmentWidth, height);
      } else if (i === loadingIndex) {
        // Loading - 50% opacity
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`;
        ctx.fillRect(x, 0, segmentWidth, height);
      } else if (loadedIndices.has(i)) {
        // Loaded - 100% opacity
        ctx.fillStyle = layerColor;
        ctx.fillRect(x, 0, segmentWidth, height);
      }
      // Empty - skip (transparent)
    }
}

export const ProgressCanvas: m.Component<ProgressCanvasAttrs> = {
  oncreate(vnode) {
    redrawCanvas(vnode);
  },

  onupdate(vnode) {
    redrawCanvas(vnode);
  },

  view() {
    const buttonWidth = 120; // Approximate button width, can be adjusted

    return m('canvas.progress-canvas', {
      width: buttonWidth,
      height: CANVAS_HEIGHT,
      style: {
        display: 'block',
        width: '100%',
        height: `${CANVAS_HEIGHT}px`,
        marginTop: '2px',
        imageRendering: 'pixelated' // Crisp rendering for small segments
      }
    });
  }
};
