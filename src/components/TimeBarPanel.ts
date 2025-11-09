/**
 * Time Bar Panel Component
 *
 * Displays timeline slider with controls at bottom
 */

import m from 'mithril';
import { clampTimeToDataWindow } from '../utils/timeUtils';
import { configLoader } from '../config';

export interface TimeBarPanelAttrs {
  currentTime: Date;
  startTime: Date;
  endTime: Date;
  onTimeChange: (time: Date) => void;
}

export const TimeBarPanel: m.Component<TimeBarPanelAttrs> = {
  view(vnode) {
    const { currentTime, startTime, endTime, onTimeChange } = vnode.attrs;

    // Calculate slider value (0-1 through the forecast range)
    const rangeProgress = (currentTime.getTime() - startTime.getTime()) /
                         (endTime.getTime() - startTime.getTime());

    // Format dates for display
    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit'
      });
    };

    // Jump to current time
    const jumpToNow = () => {
      const now = new Date();
      const maxRangeDays = configLoader.getHypatiaConfig().data.maxRangeDays;
      const clampedNow = clampTimeToDataWindow(now, currentTime, maxRangeDays);
      onTimeChange(clampedNow);
    };

    // Jump to start
    const jumpToStart = () => {
      onTimeChange(startTime);
    };

    // Jump to end
    const jumpToEnd = () => {
      onTimeChange(endTime);
    };

    // Generate tick marks (one per day)
    const totalDays = Math.ceil((endTime.getTime() - startTime.getTime()) / (24 * 60 * 60 * 1000));
    const ticks = Array.from({ length: totalDays + 1 }, (_, i) => i / totalDays);

    return m('div.time-bar.panel.no-events', [
      // Timeline with ticks
      m('div.time-bar-wrapper', [
        // Tick marks
        m('div.time-ticks.no-events',
          ticks.map(tick =>
            m('div.time-tick', {
              style: `left: ${tick * 100}%`
            })
          )
        ),

        // Range input
        m('input[type=range].time-range-input', {
          min: 0,
          max: 1,
          step: 0.0001,
          value: rangeProgress,
          oninput: (e: Event) => {
            const target = e.target as HTMLInputElement;
            const progress = parseFloat(target.value);
            const newTime = new Date(startTime.getTime() +
              progress * (endTime.getTime() - startTime.getTime()));
            onTimeChange(newTime);
          },
          onwheel: (e: WheelEvent) => {
            e.preventDefault();
            const hoursToAdd = e.deltaY > 0 ? -1 : 1;
            const newTime = new Date(currentTime.getTime() + hoursToAdd * 3600000);
            const maxRangeDays = configLoader.getHypatiaConfig().data.maxRangeDays;
            const clampedTime = clampTimeToDataWindow(newTime, currentTime, maxRangeDays);
            onTimeChange(clampedTime);
          }
        }),

        // Start/Now/End buttons
        m('div.time-labels', [
          m('button.time-edge-button.time-start-button', {
            onclick: jumpToStart
          }, formatDate(startTime)),
          m('button.time-now-button', {
            onclick: jumpToNow
          }, 'Now'),
          m('button.time-edge-button.time-end-button', {
            onclick: jumpToEnd
          }, formatDate(endTime))
        ])
      ])
    ]);
  }
};
