import m from 'mithril';
import type { LoadProgress } from '../services/ResourceManager';

interface BootstrapModalAttrs {
  progress: LoadProgress | null;
  error: string | null;
  onRetry?: () => void;
}

export const BootstrapModal: m.Component<BootstrapModalAttrs> = {
  view(vnode) {
    const { progress, error, onRetry } = vnode.attrs;

    return m('div.bootstrap-modal', [
      m('div.bootstrap-content', [
        m('h1', 'Hypatia'),
        m('p.welcome', 'Weather Visualization'),

        error ? [
          // Error state
          m('div.error-message', [
            m('p', 'Failed to load resources'),
            m('p.error-detail', error)
          ]),
          onRetry && m('button.retry-btn', {
            onclick: onRetry
          }, 'Retry')
        ] : progress ? [
          // Loading state
          m('div.progress-container', [
            m('div.progress-bar', [
              m('div.progress-fill', {
                style: `width: ${progress.percentage}%`
              })
            ]),
            m('p.progress-text', `${Math.round(progress.percentage)}%`),
            m('p.progress-file', progress.currentFile.split('/').pop())
          ])
        ] : [
          // Initial state
          m('p.loading', 'Initializing...')
        ]
      ])
    ]);
  }
};
