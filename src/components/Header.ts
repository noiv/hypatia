/**
 * Header Component
 *
 * Displays application header with logo and time information
 */

import m from 'mithril';
import { TimeInfo } from './TimeInfo';

export interface HeaderAttrs {
  currentTime: Date;
  onLogoClick: () => void;
}

export const Header: m.Component<HeaderAttrs> = {
  view(vnode) {
    const { currentTime, onLogoClick } = vnode.attrs;

    return m('div.header', [
      m('h1', [
        m('a[href=/]', {
          onclick: (e: Event) => {
            e.preventDefault();
            onLogoClick();
          }
        }, 'Hypatia')
      ]),
      m(TimeInfo, { currentTime })
    ]);
  }
};
