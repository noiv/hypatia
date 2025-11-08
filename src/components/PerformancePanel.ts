/**
 * Performance Panel Component
 *
 * Displays performance statistics
 * Provides DOM element to scene for direct updates
 */

import m from 'mithril';
import * as perform from '../utils/performance';

export interface PerformancePanelAttrs {
  onElementCreated: (element: HTMLElement) => void;
}

export const PerformancePanel: m.Component<PerformancePanelAttrs> = {
  view(vnode) {
    const { onElementCreated } = vnode.attrs;

    return m('.performance.panel',
      m('.info', {
        oncreate: (vn: m.VnodeDOM) => {
          onElementCreated(vn.dom as HTMLElement);
        }
      }, perform.line())
    );
  }
};
