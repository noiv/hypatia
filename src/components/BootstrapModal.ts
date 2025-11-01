import m from 'mithril';
import type { LoadProgress } from '../services/ResourceManager';
import { getCapabilityHelpUrls } from '../utils/capabilityCheck';

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
            m('p', error.includes('WebGL') || error.includes('WebGPU') ? 'Browser Not Supported' : 'Failed to load resources'),
            error.includes('WebGL') || error.includes('WebGPU') ? [
              m('p.error-detail', 'Your browser does not support required features.'),
              m('p.help-links', 'Please check your browser configuration:'),
              m('ul.help-list', [
                m('li', [
                  m('a', {
                    href: getCapabilityHelpUrls().webgl,
                    target: '_blank',
                    rel: 'noopener noreferrer'
                  }, 'WebGL2 Support')
                ]),
                m('li', [
                  m('a', {
                    href: getCapabilityHelpUrls().webgpu,
                    target: '_blank',
                    rel: 'noopener noreferrer'
                  }, 'WebGPU Implementation Status')
                ])
              ])
            ] : m('p.error-detail', error)
          ]),
          onRetry && !error.includes('WebGL') && !error.includes('WebGPU') && m('button.retry-btn', {
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
            m('p.progress-file', progress.currentFile ? progress.currentFile.split('/').pop() : 'Loading...')
          ])
        ] : [
          // Initial state
          m('p.loading', 'Initializing...')
        ]
      ])
    ]);
  }
};
