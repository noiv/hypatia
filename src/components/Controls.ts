import m from 'mithril';
import { BlendSlider } from './BlendSlider';

export interface ControlsAttrs {
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
  blend: number;
  onBlendChange: (blend: number) => void;
  onReferenceClick: () => void;
  showTemp2m: boolean;
  onTemp2mToggle: () => void;
  temp2mLoading?: boolean;
  showRain: boolean;
  onRainToggle: () => void;
}

export const Controls: m.Component<ControlsAttrs> = {
  view(vnode) {
    const {
      isFullscreen,
      onFullscreenToggle,
      blend,
      onBlendChange,
      onReferenceClick,
      showTemp2m,
      onTemp2mToggle,
      temp2mLoading,
      showRain,
      onRainToggle
    } = vnode.attrs;

    return m('div.controls', [
      // Fullscreen button
      m('button.btn', {
        onclick: onFullscreenToggle
      }, isFullscreen ? '⬌ Exit' : '⛶ Fullscreen'),

      // Reference link (alt=12742000 is 2 Earth radii above surface)
      m('button.btn', {
        onclick: onReferenceClick
      }, '↺ Reference'),

      // Temp2m toggle button
      m('button.btn', {
        onclick: onTemp2mToggle,
        disabled: temp2mLoading,
        class: showTemp2m ? 'active' : ''
      }, temp2mLoading ? '⏳ Loading...' : (showTemp2m ? '🌡️ Temp ON' : '🌡️ Temp OFF')),

      // Rain toggle button (below temp)
      m('button.btn', {
        onclick: onRainToggle,
        class: showRain ? 'active' : ''
      }, showRain ? '🌧️ Rain ON' : '🌧️ Rain OFF'),

      // Blend slider
      m('div.blend-control', [
        m('label.blend-label', 'Blend'),
        m(BlendSlider, { blend, onBlendChange })
      ])
    ]);
  }
};
