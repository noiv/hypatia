import m from 'mithril';
import { BlendSlider } from './BlendSlider';

export interface ControlsAttrs {
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
  blend: number;
  onBlendChange: (blend: number) => void;
}

export const Controls: m.Component<ControlsAttrs> = {
  view(vnode) {
    const { isFullscreen, onFullscreenToggle, blend, onBlendChange } = vnode.attrs;

    return m('div.controls', [
      // Fullscreen button
      m('button.btn', {
        onclick: onFullscreenToggle
      }, isFullscreen ? '⬌ Exit' : '⛶ Fullscreen'),

      // Reference link (alt=12742000 is 2 Earth radii above surface)
      m('a.btn', {
        href: '/?dt=2025-10-29:12:00&alt=12742000&ll=0.000,0.000'
      }, '↺ Reference'),

      // Blend slider
      m('div.blend-control', [
        m('label.blend-label', 'Blend'),
        m(BlendSlider, { blend, onBlendChange })
      ])
    ]);
  }
};
