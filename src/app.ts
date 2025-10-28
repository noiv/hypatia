import m from 'mithril';
import { Scene } from './visualization/Scene';
import { TimeSlider } from './components/TimeSlider';
import { Controls } from './components/Controls';
import { parseUrlState, debouncedUpdateUrlState } from './utils/urlState';

interface AppState {
  currentTime: Date;
  isFullscreen: boolean;
  blend: number;
  scene: Scene | null;
}

interface AppComponent extends m.Component {
  state: AppState;
}

export const App: AppComponent = {
  oninit() {
    // Try to parse URL state
    const urlState = parseUrlState();

    this.state = {
      currentTime: urlState?.time ?? new Date(),
      isFullscreen: false,
      blend: 0.0,
      scene: null
    };
  },

  oncreate(vnode) {
    const state = this.state;
    const canvas = vnode.dom.querySelector('.scene-canvas') as HTMLCanvasElement;

    if (!canvas) {
      console.error('Canvas element not found');
      return;
    }

    // Initialize Three.js scene
    state.scene = new Scene(canvas);
    state.scene.updateTime(state.currentTime);

    // Apply URL state if available
    const urlState = parseUrlState();
    if (urlState) {
      state.scene.setCameraState(urlState.cameraPosition, urlState.cameraDistance);
    }

    // Register camera change listener for URL updates
    state.scene.onCameraChange(() => {
      if (state.scene) {
        debouncedUpdateUrlState({
          time: state.currentTime,
          cameraPosition: state.scene.getCameraPosition(),
          cameraDistance: state.scene.getCameraDistance()
        });
      }
    });

    // Register time scroll listener (when scrolling over Earth)
    state.scene.onTimeScroll((hoursDelta: number) => {
      const newTime = new Date(state.currentTime.getTime() + hoursDelta * 3600000);
      state.currentTime = newTime;

      if (state.scene) {
        state.scene.updateTime(newTime);

        debouncedUpdateUrlState({
          time: newTime,
          cameraPosition: state.scene.getCameraPosition(),
          cameraDistance: state.scene.getCameraDistance()
        });
      }

      m.redraw();
    });

    console.log('Hypatia initialized');
  },

  onremove() {
    if (this.state.scene) {
      this.state.scene.dispose();
    }
  },

  view() {
    const state = this.state;

    return m('div.app-container', [
      // Canvas container
      m('div.canvas-container', [
        m('canvas.scene-canvas')
      ]),

      // UI Overlay
      m('div.ui-overlay', [
        // Header
        m('div.header', [
          m('h1', 'Hypatia'),
          m('p',
            `${state.currentTime.toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}`
          )
        ]),

        // Controls
        m(Controls, {
          isFullscreen: state.isFullscreen,
          onFullscreenToggle: () => {
            state.isFullscreen = !state.isFullscreen;
            if (state.isFullscreen) {
              document.documentElement.requestFullscreen();
            } else {
              document.exitFullscreen();
            }
          },
          blend: state.blend,
          onBlendChange: (newBlend: number) => {
            state.blend = newBlend;
            if (state.scene) {
              state.scene.setBlend(newBlend);
            }
          }
        }),

        // Time Slider
        m(TimeSlider, {
          currentTime: state.currentTime,
          onTimeChange: (newTime: Date) => {
            state.currentTime = newTime;
            if (state.scene) {
              state.scene.updateTime(newTime);

              // Update URL with new time
              debouncedUpdateUrlState({
                time: newTime,
                cameraPosition: state.scene.getCameraPosition(),
                cameraDistance: state.scene.getCameraDistance()
              });
            }
            m.redraw();
          }
        })
      ])
    ]);
  }
};
