import m from 'mithril';
import type { BootstrapProgress, BootstrapStatus } from '../services/AppBootstrapService';
import { getCapabilityHelpUrls } from '../utils/capabilityCheck';

interface BootstrapModalAttrs {
  progress: BootstrapProgress | null;
  error: string | null;
  status?: BootstrapStatus;
  onRetry?: () => void;
  onContinue?: () => void;
}

export const BootstrapModal: m.Component<BootstrapModalAttrs> = {
  view(vnode) {
    const { progress, error, status, onRetry, onContinue } = vnode.attrs;

    return m('div.bootstrap-modal', [
      m('div.bootstrap-content', [
        m('img.bootstrap-brand', {
          src: '/hypatia-brand-white.svg',
          alt: 'Hypatia'
        }),
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
        ] : progress || status === 'waiting' ? [
          // Loading or Waiting state
          m('div.progress-container', [
            m('div.progress-bar', [
              m('div.progress-fill', {
                style: status === 'waiting' ? 'width: 100%' : `width: ${progress?.percentage || 0}%`
              })
            ]),
            m('p.progress-text', status === 'waiting' ? 'Ready' : `${Math.round(progress?.percentage || 0)}%`),
            progress?.currentFile && status !== 'waiting' ?
              m('p.progress-file', progress.currentFile) : null,
            m('button.time-edge-button', {
              onclick: onContinue,
              style: `margin-top: 20px; visibility: ${status === 'waiting' ? 'visible' : 'hidden'}`
            }, 'Continue')
          ])
        ] : [
          // Initial state
          m('p.loading', 'Initializing...')
        ]
      ])
    ]);
  }
};
