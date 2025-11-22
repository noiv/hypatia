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
import type { ConfigService } from '../services/ConfigService';

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

  // Services
  downloadService: DownloadService;
  configService: ConfigService;

  // Canvas registration callback
  onProgressCanvasCreated: ((layerId: LayerId, canvas: HTMLCanvasElement) => void) | undefined;
}

export const LayersPanel: m.Component<LayersPanelAttrs> = {
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

      // Check if this is a data layer (not decoration) that uses progressive loading
      // Decoration layers (cubemaps + decoration): earth, sun, graticule, text
      // Data layers: temp, rain, wind, pressure, humidity, clouds, waves
      const config = vnode.attrs.configService.getHypatiaConfig();
      const decorationLayers = [...config.layers.cubemaps, ...config.layers.decoration];
      const hasProgressCanvas = !decorationLayers.includes(layerId);

      // Get layer label from config
      const layerConfig = vnode.attrs.configService.getLayerById(layerId);
      const layerLabel = layerConfig?.label?.short || layerId;

      const button = m('button.btn', {
        class: `${isActive ? 'active' : ''} ${hasProgressCanvas ? 'data-layer' : 'decoration-layer'}`.trim(),
        'data-layer': layerId,
        onclick: () => onLayerToggle(layerId)
      }, layerLabel);

      // Always render progress canvas for data layers (acts as bottom border)
      if (hasProgressCanvas) {
        // Get download state (will be empty/zero for non-activated layers)
        const totalTimestamps = downloadService.getTimestepCount(layerId) || 0;
        const loadedIndices = downloadService.getLoadedIndices(layerId) || new Set();
        const loadingIndex = downloadService.getLoadingIndex(layerId);
        const failedIndices = downloadService.getFailedIndices(layerId) || new Set();

        return m('div.layer-button-wrapper', [
          button,
          m(ProgressCanvas, {
            layerId,
            totalTimestamps,
            loadedIndices,
            loadingIndex,
            failedIndices,
            layerColor: '#ff6b35', // Will use proper color from config later
            onCanvasCreated: vnode.attrs.onProgressCanvasCreated
          })
        ]);
      }

      // Non-data layers (earth, sun, graticule, text)
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
        m('button.btn.decoration-layer', {
          class: textEnabled ? 'active' : '',
          'data-layer': 'text',
          onclick: () => onTextToggle()
        }, 'Text Labels')
      ])
    ]);
  }
};
