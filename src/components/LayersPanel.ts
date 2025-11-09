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
import { getLayerCacheControl } from '../services/LayerCacheControl';

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
    // Subscribe to cache control events to trigger redraws
    try {
      const cacheControl = getLayerCacheControl();
      const handleCacheEvent = () => m.redraw();

      // Store handler for cleanup
      eventHandlers.set(vnode.state, handleCacheEvent);

      // Single event listener - fileLoadUpdate fires after each file loads
      cacheControl.on('fileLoadUpdate', handleCacheEvent);
    } catch (e) {
      // Cache control not initialized yet
    }
  },

  onremove(vnode) {
    // Cleanup event listener
    try {
      const cacheControl = getLayerCacheControl();
      const handleCacheEvent = eventHandlers.get(vnode.state);

      if (handleCacheEvent) {
        cacheControl.removeListener('fileLoadUpdate', handleCacheEvent);
        eventHandlers.delete(vnode.state);
      }
    } catch (e) {
      // Cache control not initialized
    }
  },

  view(vnode) {
    const {
      layerStates,
      textEnabled,
      onLayerToggle,
      onTextToggle,
      blend,
      onBlendChange
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
        try {
          const cacheControl = getLayerCacheControl();
          const totalTimestamps = cacheControl.getTimestepCount(layerId);
          const loadedIndices = cacheControl.getLoadedIndices(layerId);
          const loadingIndex = cacheControl.getLoadingIndex(layerId);
          const failedIndices = cacheControl.getFailedIndices(layerId);

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
        } catch (e) {
          // Cache control not initialized yet
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
