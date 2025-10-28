import m from 'mithril';
import { Scene } from './visualization/Scene';
import { TimeSlider } from './components/TimeSlider';
import { Controls } from './components/Controls';
import { BootstrapModal } from './components/BootstrapModal';
import { parseUrlState, debouncedUpdateUrlState } from './utils/urlState';
import { getCurrentTime } from './services/TimeService';
import { getLatestRun, type ECMWFRun } from './services/ECMWFService';
import { preloadImages, type LoadProgress } from './services/ResourceManager';
import { getUserLocation, type UserLocation } from './services/GeolocationService';

type BootstrapStatus = 'loading' | 'ready' | 'error';

interface AppState {
  currentTime: Date;
  isFullscreen: boolean;
  blend: number;
  scene: Scene | null;
  latestRun: ECMWFRun | null;
  userLocation: UserLocation | null;
  bootstrapStatus: BootstrapStatus;
  bootstrapProgress: LoadProgress | null;
  bootstrapError: string | null;
  preloadedImages: Map<string, HTMLImageElement> | null;
}

interface AppComponent extends m.Component {
  state: AppState;
}

export const App: AppComponent = {
  oninit() {
    // Try to parse URL state
    const urlState = parseUrlState();

    // Initialize state synchronously to avoid undefined access in view
    this.state = {
      currentTime: urlState?.time ?? new Date(),
      isFullscreen: false,
      blend: 0.0,
      scene: null,
      latestRun: null,
      userLocation: null,
      bootstrapStatus: 'loading',
      bootstrapProgress: null,
      bootstrapError: null,
      preloadedImages: null
    };

    // Bootstrap asynchronously
    this.runBootstrap();
  },

  async runBootstrap() {
    try {
      const urlState = parseUrlState();

      // Bootstrap step 1: Get accurate time from time server
      const serverTime = await getCurrentTime();

      // Bootstrap step 2: Check ECMWF for latest IFS model run
      const latestRun = await getLatestRun(serverTime);

      // Bootstrap step 3: Get user location
      const userLocation = await getUserLocation();

      // Bootstrap step 4: Preload critical images
      const images = await preloadImages('critical', (progress) => {
        this.state.bootstrapProgress = progress;
        m.redraw();
      });

      // Update state with bootstrap results
      this.state.currentTime = urlState?.time ?? serverTime;
      this.state.latestRun = latestRun;
      this.state.userLocation = userLocation;
      this.state.preloadedImages = images;

      // Keep modal visible for 1 second to show completion
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.state.bootstrapStatus = 'ready';
      m.redraw();
    } catch (error) {
      console.error('Bootstrap failed:', error);
      this.state.bootstrapStatus = 'error';
      this.state.bootstrapError = error instanceof Error ? error.message : 'Unknown error';
      m.redraw();
    }
  },

  oncreate(vnode) {
    // Only initialize scene when bootstrap is ready
    if (this.state.bootstrapStatus !== 'ready') {
      return;
    }

    this.initializeScene(vnode.dom);
  },

  onupdate(vnode) {
    // Initialize scene when bootstrap completes
    if (this.state.bootstrapStatus === 'ready' && !this.state.scene) {
      this.initializeScene(vnode.dom);
    }
  },

  initializeScene(dom: Element) {
    const state = this.state;
    const canvas = dom.querySelector('.scene-canvas') as HTMLCanvasElement;

    if (!canvas) {
      console.error('Canvas element not found');
      return;
    }

    // Initialize Three.js scene
    state.scene = new Scene(canvas);
    state.scene.updateTime(state.currentTime);

    // Apply URL state if available, otherwise use user location
    const urlState = parseUrlState();
    if (urlState) {
      state.scene.setCameraState(urlState.cameraPosition, urlState.cameraDistance);
    } else if (state.userLocation) {
      state.scene.setCameraToLocation(
        state.userLocation.latitude,
        state.userLocation.longitude,
        3 // Default distance
      );
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

    // Show bootstrap modal during loading or error
    if (state.bootstrapStatus !== 'ready') {
      return m(BootstrapModal, {
        progress: state.bootstrapProgress,
        error: state.bootstrapError,
        onRetry: state.bootstrapStatus === 'error' ? () => {
          state.bootstrapStatus = 'loading';
          state.bootstrapError = null;
          state.bootstrapProgress = null;
          this.runBootstrap();
        } : undefined
      });
    }

    // Show main app when ready
    return m('div.app-container', {
      class: state.bootstrapStatus === 'ready' ? 'ready' : ''
    }, [
      // Canvas container
      m('div.canvas-container', [
        m('canvas.scene-canvas')
      ]),

      // UI Overlay
      m('div.ui-overlay', [
        // Header
        m('div.header', [
          m('h1', 'Hypatia'),
          m('p.time-display',
            state.currentTime.toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            })
          ),
          m('p.time-utc',
            state.currentTime.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
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
