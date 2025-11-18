/**
 * Layers Panel Component
 *
 * Displays layer toggle buttons organized by groups
 * Simplified from Controls component - uses Map instead of individual boolean props
 */

import m from 'mithril';
import { BlendSlider } from './BlendSlider';
import { ProgressCanvas } from './ProgressCanvas';
import type { LayerId } from '../visualization/ILayer';
import type { DownloadService } from '../services/DownloadService';

export interface LayerState {
  created: boolean;
  visible: boolean;
  loading?: boolean;
}

export interface LayersPanelAttrs {
  // Layer states
  layerStates: Map<LayerId, LayerState>;
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
  temp2m: 'Temperature',
  precipitation: 'Rain',
  wind10m: 'Wind',
  pressure_msl: 'Pressure',
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
      const isLoading = state?.loading;

      // Check if this is a weather layer that uses progressive loading
      const weatherLayers: LayerId[] = ['temp2m', 'precipitation'];
      const hasProgressCanvas = weatherLayers.includes(layerId);

      const button = m('button.btn', {
        class: isActive ? 'active' : '',
        disabled: isLoading,
        onclick: () => onLayerToggle(layerId)
      }, LAYER_DISPLAY_NAMES[layerId] + (isLoading ? '...' : ''));

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
        renderLayerButton('temp2m'),
        renderLayerButton('precipitation'),
        renderLayerButton('wind10m'),
        renderLayerButton('pressure_msl'),
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
