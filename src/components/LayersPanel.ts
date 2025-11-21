/**
 * Layers Panel Component
 *
 * Displays layer toggle buttons organized by groups
 * Simplified from Controls component - uses Map instead of individual boolean props
 */

import m from 'mithril';
import { BlendSlider } from './BlendSlider';
import { ProgressCanvas } from './ProgressCanvas';
import type { LayerId } from '../layers/ILayer';
import type { LayerRenderState } from '../config/types';
import type { DownloadService } from '../services/DownloadService';

export interface LayersPanelAttrs {
  // Layer states
  layerStates: Map<LayerId, LayerRenderState>;
  textEnabled: boolean;

  // Handlers
  onLayerToggle: (layerId: LayerId) => Promise<void>;
  onTextToggle: () => Promise<void>;

  // Other controls
  blend: number;
  onBlendChange: (blend: number) => void;

  // Services (optional for backward compatibility)
  downloadService?: DownloadService;
}

const LAYER_DISPLAY_NAMES: Record<LayerId, string> = {
  earth: 'Earth',
  sun: 'Sun',
  graticule: 'Graticule',
  temp: 'Temperature',
  rain: 'Rain',
  wind: 'Wind',
  pressure: 'Pressure',
  text: 'Text'
};

// Event handlers stored per component instance
const eventHandlers = new WeakMap<any, () => void>();

export const LayersPanel: m.Component<LayersPanelAttrs> = {
  oninit(vnode) {
    // Subscribe to download service events to trigger redraws
    const downloadService = vnode.attrs.downloadService;
    if (downloadService) {
      const handleDownloadEvent = () => m.redraw();

      // Store handler for cleanup
      eventHandlers.set(vnode.state, handleDownloadEvent);

      // Listen to download progress events
      downloadService.on('progress', handleDownloadEvent);
      downloadService.on('timestampLoaded', handleDownloadEvent);
    }
  },

  onremove(vnode) {
    // Cleanup event listener
    const downloadService = vnode.attrs.downloadService;
    const handleDownloadEvent = eventHandlers.get(vnode.state);

    if (downloadService && handleDownloadEvent) {
      downloadService.off('progress', handleDownloadEvent);
      downloadService.off('timestampLoaded', handleDownloadEvent);
      eventHandlers.delete(vnode.state);
    }
  },

  view(vnode) {
    const {
      layerStates,
      textEnabled,
      onLayerToggle,
      onTextToggle,
      blend,
      onBlendChange,
      downloadService
    } = vnode.attrs;

    const renderLayerButton = (layerId: LayerId) => {
      const state = layerStates.get(layerId);
      const isActive = state?.created && state?.visible;

      // Check if this is a data layer (not render-only) that uses progressive loading
      // Data layers: temp, rain, wind, pressure, humidity, clouds, waves
      // Render-only layers: earth, sun, graticule, text
      const renderOnlyLayers: LayerId[] = ['earth', 'sun', 'graticule', 'text'];
      const hasProgressCanvas = !renderOnlyLayers.includes(layerId);

      const button = m('button.btn', {
        class: isActive ? 'active' : '',
        onclick: () => onLayerToggle(layerId)
      }, LAYER_DISPLAY_NAMES[layerId]);

      if (hasProgressCanvas && isActive) {
        if (downloadService) {
          const totalTimestamps = downloadService.getTimestepCount(layerId);
          const loadedIndices = downloadService.getLoadedIndices(layerId);
          const loadingIndex = downloadService.getLoadingIndex(layerId);
          const failedIndices = downloadService.getFailedIndices(layerId);

          return m('div.layer-button-wrapper', [
            button,
            m(ProgressCanvas, {
              layerId,
              totalTimestamps,
              loadedIndices,
              loadingIndex,
              failedIndices,
              layerColor: '#ff6b35' // Will use proper color from config later
            })
          ]);
        } else {
          // DownloadService not available
          return button;
        }
      }

      return button;
    };

    return m('div.layers.panel', [
      // Base layers
      m('div.layer-group', [
        m('h4', 'Base'),
        renderLayerButton('earth'),
        // Blend slider after Earth button
        m(BlendSlider, {
          blend,
          onChange: onBlendChange
        }),
        renderLayerButton('sun'),
        renderLayerButton('graticule'),
      ]),

      // Weather layers
      m('div.layer-group', [
        m('h4', 'Weather'),
        renderLayerButton('temp'),
        renderLayerButton('rain'),
        renderLayerButton('wind'),
        renderLayerButton('pressure'),
      ]),

      // Text overlay
      m('div.layer-group', [
        m('h4', 'Overlays'),
        m('button.btn', {
          class: textEnabled ? 'active' : '',
          onclick: () => onTextToggle()
        }, 'Text Labels')
      ])
    ]);
  }
};
