/**
 * FullscreenPanel Component
 *
 * Displays fullscreen toggle button with icon
 */

import m from 'mithril';

export interface FullscreenPanelAttrs {
  isFullscreen: boolean;
  onToggle: () => void;
}

export const FullscreenPanel: m.Component<FullscreenPanelAttrs> = {
  view(vnode) {
    const { isFullscreen, onToggle } = vnode.attrs;

    return m('div.fullscreen.panel', [
      m('button.fullscreen-btn', {
        onclick: onToggle,
        title: isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'
      }, [
        m('img.fullscreen-icon', {
          src: isFullscreen ? '/icon-fullscreen-on.svg' : '/icon-fullscreen-off.svg',
          alt: isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'
        })
      ])
    ]);
  }
};
