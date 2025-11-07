/**
 * Time Info Component
 *
 * Displays current time in both local and UTC formats
 */

import m from 'mithril';

export interface TimeInfoAttrs {
  currentTime: Date;
}

export const TimeInfo: m.Component<TimeInfoAttrs> = {
  view(vnode) {
    const { currentTime } = vnode.attrs;

    return m('div.time-info', [
      m('p.time-display',
        currentTime.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      ),
      m('p.time-utc',
        currentTime.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
      )
    ]);
  }
};
