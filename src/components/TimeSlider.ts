import m from 'mithril';
import { clampTimeToDataRange } from '../utils/timeUtils';

export interface TimeSliderAttrs {
  currentTime: Date;
  startTime: Date;
  endTime: Date;
  onTimeChange: (time: Date) => void;
}

export const TimeSlider: m.Component<TimeSliderAttrs> = {
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

    // Jump to current time
    const jumpToNow = () => {
      const now = new Date();
      const clampedNow = clampTimeToDataRange(now);
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

    const timeDisplay = formatTimeDisplay(currentTime);

    return m('div.time-slider-container', [
      // Centered time display
      m('div.time-display-overlay', [
        m('div.time-display-circle', [
          m('div.time-year', timeDisplay.year),
          m('div.time-date', timeDisplay.monthDay),
          m('div.time-time', timeDisplay.time)
        ])
      ]),

      // Timeline with ticks
      m('div.time-slider-wrapper', [
        // Tick marks
        m('div.time-ticks',
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
            const clampedTime = clampTimeToDataRange(newTime);
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
