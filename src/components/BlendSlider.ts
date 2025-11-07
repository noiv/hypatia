import m from 'mithril';

export interface BlendSliderAttrs {
  blend: number;
  onChange: (blend: number) => void;
}

export const BlendSlider: m.Component<BlendSliderAttrs> = {
  view(vnode) {
    const { blend, onChange } = vnode.attrs;

    return m('input[type=range].blend-slider', {
      min: 0,
      max: 1,
      step: 0.01,
      value: blend,
      oninput: (e: Event) => {
        const target = e.target as HTMLInputElement;
        const newBlend = parseFloat(target.value);
        onChange(newBlend);
      }
    });
  }
};
