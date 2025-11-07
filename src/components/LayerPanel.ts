/**
 * Layer Panel Component
 *
 * Displays layer toggle buttons organized by groups
 * Simplified from Controls component - uses Map instead of individual boolean props
 */

import m from 'mithril';
import { BlendSlider } from './BlendSlider';
import type { LayerId } from '../visualization/ILayer';

export interface LayerState {
  created: boolean;
  visible: boolean;
  loading?: boolean;
}

export interface LayerPanelAttrs {
  // Layer states
  layerStates: Map<LayerId, LayerState>;
  textEnabled: boolean;

  // Handlers
  onLayerToggle: (layerId: LayerId) => Promise<void>;
  onTextToggle: () => Promise<void>;

  // Other controls
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
  blend: number;
  onBlendChange: (blend: number) => void;
  onReferenceClick: () => void;
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

export const LayerPanel: m.Component<LayerPanelAttrs> = {
  view(vnode) {
    const {
      layerStates,
      textEnabled,
      onLayerToggle,
      onTextToggle,
      isFullscreen,
      onFullscreenToggle,
      blend,
      onBlendChange,
      onReferenceClick
    } = vnode.attrs;

    const renderLayerButton = (layerId: LayerId) => {
      const state = layerStates.get(layerId);
      const isActive = state?.created && state?.visible;
      const isLoading = state?.loading;

      return m('button.btn', {
        class: isActive ? 'active' : '',
        disabled: isLoading,
        onclick: () => onLayerToggle(layerId)
      }, LAYER_DISPLAY_NAMES[layerId] + (isLoading ? '...' : ''));
    };

    return m('div.controls', [
      // Fullscreen toggle
      m('button.btn', {
        class: isFullscreen ? 'active' : '',
        onclick: onFullscreenToggle
      }, 'Fullscreen'),

      // Blend slider
      m(BlendSlider, {
        blend,
        onChange: onBlendChange
      }),

      // Reference button
      m('button.btn', {
        onclick: onReferenceClick
      }, 'Reference'),

      // Base layers
      m('div.layer-group', [
        m('h4', 'Base'),
        renderLayerButton('earth'),
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
