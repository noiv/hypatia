/**
 * Time Circle Panel Component
 *
 * Displays current time in circular format at top-right
 */

import m from 'mithril';

export interface TimeCirclePanelAttrs {
  currentTime: Date;
}

export const TimeCirclePanel: m.Component<TimeCirclePanelAttrs> = {
  view(vnode) {
    const { currentTime } = vnode.attrs;

    const formatTimeDisplay = (date: Date) => {
      const year = date.getFullYear();
      const monthDay = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      const time = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });

      return { year, monthDay, time };
    };

    const timeDisplay = formatTimeDisplay(currentTime);

    return m('div.time-circle.panel', [
      m('div.time-circle-display', {
        onclick: () => {
          console.log('Time circle clicked');
        }
      }, [
        m('div.time-year', timeDisplay.year),
        m('div.time-date', timeDisplay.monthDay),
        m('div.time-time', timeDisplay.time)
      ])
    ]);
  }
};
