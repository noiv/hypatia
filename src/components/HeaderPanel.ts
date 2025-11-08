/**
 * HeaderPanel Component
 *
 * Displays application header with brand logo
 */

import m from 'mithril';

export interface HeaderPanelAttrs {
  onLogoClick: () => void;
}

export const HeaderPanel: m.Component<HeaderPanelAttrs> = {
  view(vnode) {
    const { onLogoClick } = vnode.attrs;

    return m('div.header.panel', [
      m('a.brand-link[href=/]', {
        onclick: (e: Event) => {
          e.preventDefault();
          onLogoClick();
        }
      }, [
        m('img.brand-logo', {
          src: '/hypatia-brand-white.svg',
          alt: 'Hypatia'
        })
      ])
    ]);
  }
};
