import m from 'mithril';

export interface TimeSliderAttrs {
  currentTime: Date;
  onTimeChange: (time: Date) => void;
}

export const TimeSlider: m.Component<TimeSliderAttrs> = {
  view(vnode) {
    const { currentTime, onTimeChange } = vnode.attrs;

    // Get current year range
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    // Calculate slider value (0-1 through the year)
    const yearProgress = (currentTime.getTime() - yearStart.getTime()) /
                        (yearEnd.getTime() - yearStart.getTime());

    return m('div.time-slider', [
      m('input[type=range]', {
        min: 0,
        max: 1,
        step: 0.0001,
        value: yearProgress,
        oninput: (e: Event) => {
          const target = e.target as HTMLInputElement;
          const progress = parseFloat(target.value);
          const newTime = new Date(yearStart.getTime() +
            progress * (yearEnd.getTime() - yearStart.getTime()));
          onTimeChange(newTime);
        },
        // Handle wheel events for scrubbing
        onwheel: (e: WheelEvent) => {
          e.preventDefault();
          const hoursToAdd = e.deltaY > 0 ? -1 : 1;
          const newTime = new Date(currentTime.getTime() + hoursToAdd * 3600000);
          onTimeChange(newTime);
        }
      })
    ]);
  }
};
