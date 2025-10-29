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

    return m('div.time-slider', [
      m('input[type=range]', {
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
        // Handle wheel events for scrubbing
        onwheel: (e: WheelEvent) => {
          e.preventDefault();
          const hoursToAdd = e.deltaY > 0 ? -1 : 1;
          const newTime = new Date(currentTime.getTime() + hoursToAdd * 3600000);
          const clampedTime = clampTimeToDataRange(newTime);
          onTimeChange(clampedTime);
        }
      })
    ]);
  }
};
