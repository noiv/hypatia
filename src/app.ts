import m from 'mithril';
import { Scene } from './visualization/Scene';
import { TimeSlider } from './components/TimeSlider';
import { Controls } from './components/Controls';
import { BootstrapModal } from './components/BootstrapModal';
import { parseUrlState, debouncedUpdateUrlState } from './utils/urlState';
import { sanitizeUrl } from './utils/sanitizeUrl';
import { clampTimeToDataRange } from './utils/timeUtils';
import { getCurrentTime } from './services/TimeService';
import { getLatestRun, type ECMWFRun } from './services/ECMWFService';
import { preloadImages, getTotalSize, type LoadProgress } from './services/ResourceManager';
import { getUserLocation, type UserLocation } from './services/GeolocationService';
import { getUserOptions } from './services/UserOptionsService';
import { getDatasetRange } from './manifest';

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
  showTemp2m: boolean;
  temp2mLoading: boolean;
  showRain: boolean;
  rainLoading: boolean;
}

interface AppComponent extends m.Component {
  state: AppState;
  _keydownHandler?: (e: KeyboardEvent) => void;
}

export const App: AppComponent = {
  oninit() {
    // Sanitize URL and get corrected state
    const sanitizedState = sanitizeUrl();

    // Initialize state synchronously to avoid undefined access in view
    this.state = {
      currentTime: sanitizedState.time,
      isFullscreen: false,
      blend: 0.0,
      scene: null,
      latestRun: null,
      userLocation: null,
      bootstrapStatus: 'loading',
      bootstrapProgress: null,
      bootstrapError: null,
      preloadedImages: null,
      showTemp2m: sanitizedState.layers?.includes('temp2m') ?? false,
      temp2mLoading: false,
      showRain: sanitizedState.layers?.includes('rain') ?? false,
      rainLoading: false
    };

    // Setup keyboard controls
    this.setupKeyboardControls();

    // Bootstrap asynchronously
    this.runBootstrap();
  },

  async runBootstrap() {
    try {
      const urlState = parseUrlState();

      // Define bootstrap steps with progress ranges
      const STEPS = {
        INIT: { start: 0, end: 0, label: 'Starting...' },
        TIME: { start: 0, end: 10, label: 'Fetching server time...' },
        FORECAST: { start: 10, end: 20, label: 'Checking latest forecast...' },
        IMAGES: { start: 20, end: 100, label: 'Loading resources...' }
      };

      // Helper to update progress
      const updateProgress = (step: typeof STEPS[keyof typeof STEPS], percentage?: number) => {
        const percent = percentage ?? step.end;
        this.state.bootstrapProgress = {
          loaded: 0,
          total: 100,
          percentage: percent,
          currentFile: step.label
        };
        m.redraw();
      };

      // Initialize progress bar
      updateProgress(STEPS.INIT, STEPS.INIT.start);

      // Bootstrap step 1: Get accurate time from time server
      updateProgress(STEPS.TIME, STEPS.TIME.start);
      const serverTime = await getCurrentTime();
      updateProgress(STEPS.TIME, STEPS.TIME.end);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Bootstrap step 2: Check ECMWF for latest IFS model run
      updateProgress(STEPS.FORECAST, STEPS.FORECAST.start);
      const latestRun = await getLatestRun(serverTime);
      updateProgress(STEPS.FORECAST, STEPS.FORECAST.end);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Bootstrap step 3: Preload critical images
      const totalSize = getTotalSize('critical');
      const images = await preloadImages('critical', (progress) => {
        // Map image loading progress (0-100%) to allocated range (20-100%)
        const mappedPercentage = STEPS.IMAGES.start +
          (progress.percentage / 100) * (STEPS.IMAGES.end - STEPS.IMAGES.start);

        this.state.bootstrapProgress = {
          loaded: progress.loaded,
          total: totalSize,
          percentage: mappedPercentage,
          currentFile: progress.currentFile
        };
        m.redraw();
      });

      // Update state with bootstrap results
      const desiredTime = urlState?.time ?? serverTime;

      // Clamp time to available data range
      const dataRange = getDatasetRange('temp2m');
      if (dataRange) {
        this.state.currentTime = new Date(Math.max(
          dataRange.startTime.getTime(),
          Math.min(dataRange.endTime.getTime(), desiredTime.getTime())
        ));
      } else {
        this.state.currentTime = desiredTime;
      }

      this.state.latestRun = latestRun;
      this.state.userLocation = null; // Skip geolocation
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

  setupKeyboardControls() {
    const handleKeydown = (e: KeyboardEvent) => {
      const state = this.state;

      // Only handle arrow keys
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
        return;
      }

      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Prevent default scrolling behavior
      e.preventDefault();

      // Calculate new time (±1 hour)
      const hoursDelta = e.key === 'ArrowLeft' ? -1 : 1;
      const newTime = new Date(state.currentTime.getTime() + hoursDelta * 3600000);

      // Clamp to data range
      const clampedTime = clampTimeToDataRange(newTime);

      // Update state
      state.currentTime = clampedTime;

      // Update scene
      if (state.scene) {
        state.scene.updateTime(clampedTime);
        this.updateUrl();
      }

      // Redraw UI
      m.redraw();
    };

    // Store reference for cleanup
    this._keydownHandler = handleKeydown;

    // Add event listener
    window.addEventListener('keydown', handleKeydown);
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

  async initializeScene(dom: Element) {
    const state = this.state;
    const canvas = dom.querySelector('.scene-canvas') as HTMLCanvasElement;

    if (!canvas) {
      console.error('Canvas element not found');
      return;
    }

    // Load user options
    const userOptions = await getUserOptions();

    // Initialize Three.js scene with preloaded images and user options
    state.scene = new Scene(canvas, state.preloadedImages ?? undefined, userOptions);
    state.scene.updateTime(state.currentTime);

    // Apply URL state if available, otherwise use user location
    const urlState = parseUrlState();
    if (urlState) {
      // Set layer state BEFORE camera change to preserve URL params
      if (urlState.layers && urlState.layers.includes('temp2m')) {
        state.showTemp2m = true;
      }
      if (urlState.layers && urlState.layers.includes('rain')) {
        state.showRain = true;
      }

      state.scene.setCameraState(urlState.cameraPosition, urlState.cameraDistance);

      // Load layers from URL (async, but state already set)
      // Each layer loads independently
      if (urlState.layers) {
        if (urlState.layers.includes('temp2m')) {
          this.loadTemp2mLayer();
        }
        if (urlState.layers.includes('rain')) {
          this.loadPratesfcLayer();
        }
      }
    } else if (state.userLocation) {
      state.scene.setCameraToLocation(
        state.userLocation.latitude,
        state.userLocation.longitude,
        3 // Default distance
      );
    }

    // Register camera change listener for URL updates
    state.scene.onCameraChange(() => {
      this.updateUrl();
    });

    // Register time scroll listener (when scrolling over Earth)
    state.scene.onTimeScroll((hoursDelta: number) => {
      const newTime = new Date(state.currentTime.getTime() + hoursDelta * 3600000);
      const clampedTime = clampTimeToDataRange(newTime);

      state.currentTime = clampedTime;

      if (state.scene) {
        state.scene.updateTime(clampedTime);
        this.updateUrl();
      }

      m.redraw();
    });

    console.log('Hypatia initialized');
  },

  async loadTemp2mLayer() {
    const state = this.state;
    if (!state.scene) return;

    // Check if already loaded in Scene
    if (state.scene.isTemp2mLoaded()) {
      console.log('✓ Temp2m layer already loaded');
      return;
    }

    // Prevent double-loading (race condition)
    if (state.temp2mLoading) {
      console.log('⏳ Temp2m layer already loading, skipping...');
      return;
    }

    state.temp2mLoading = true;
    m.redraw();

    try {
      console.log('📊 Loading temp2m layer...');
      await state.scene.loadTemp2mLayer(1);
      console.log('✅ Temp2m layer loaded');
    } catch (error) {
      console.error('❌ Failed to load temp2m layer:', error);
      alert('Failed to load temperature data. Please check the console for details.');
    } finally {
      state.temp2mLoading = false;
      m.redraw();
    }
  },

  async loadPratesfcLayer() {
    const state = this.state;
    if (!state.scene) return;

    // Check if already loaded in Scene
    if (state.scene.isRainLoaded()) {
      console.log('✓ Pratesfc layer already loaded');
      return;
    }

    // Prevent double-loading (race condition)
    if (state.rainLoading) {
      console.log('⏳ Pratesfc layer already loading, skipping...');
      return;
    }

    state.rainLoading = true;
    m.redraw();

    try {
      console.log('🌧️ Loading pratesfc layer...');
      await state.scene.loadPratesfcLayer();
      console.log('✅ Pratesfc layer loaded');
    } catch (error) {
      console.error('❌ Failed to load pratesfc layer:', error);
      // Don't alert, just log - precipitation is optional
    } finally {
      state.rainLoading = false;
      m.redraw();
    }
  },

  updateUrl() {
    const state = this.state;
    if (!state.scene) return;

    const layers: string[] = [];
    if (state.showTemp2m) {
      layers.push('temp2m');
    }
    if (state.showRain) {
      layers.push('rain');
    }

    debouncedUpdateUrlState({
      time: state.currentTime,
      cameraPosition: state.scene.getCameraPosition(),
      cameraDistance: state.scene.getCameraDistance(),
      layers: layers.length > 0 ? layers : undefined
    });
  },

  onremove() {
    // Clean up keyboard event listener
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
    }

    // Clean up scene
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
          m('h1', [
            m('a[href=/]', {
              onclick: (e: Event) => {
                e.preventDefault();
                window.location.href = '/';
              }
            }, 'Hypatia')
          ]),
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
          },
          onReferenceClick: () => {
            // Update URL with reference state
            m.route.set('/', { dt: '2025-10-29:12:00', alt: '12742000', ll: '0.000,0.000' });

            // Parse and apply the reference state
            const urlState = parseUrlState();
            if (urlState && state.scene) {
              state.currentTime = urlState.time;
              state.scene.updateTime(urlState.time);
              state.scene.setCameraState(urlState.cameraPosition, urlState.cameraDistance);
            }

            m.redraw();
          },
          showTemp2m: state.showTemp2m,
          temp2mLoading: state.temp2mLoading,
          onTemp2mToggle: async () => {
            if (!state.scene) return;

            // If turning on
            if (!state.showTemp2m) {
              // Load temp2m layer if not already loaded
              if (!state.scene.isTemp2mLoaded()) {
                await this.loadTemp2mLayer();
              }
              // Toggle visibility and update state
              state.scene.toggleTemp2m(true);
              state.showTemp2m = true;
            } else {
              // Turning off
              state.scene.toggleTemp2m(false);
              state.showTemp2m = false;
            }

            // Update URL with new layer state
            this.updateUrl();
            m.redraw();
          },
          showRain: state.showRain,
          onRainToggle: async () => {
            if (!state.scene) return;

            // Toggle visibility
            if (!state.showRain) {
              // Check if pratesfc layer is loaded, load if not
              if (!state.scene.isRainLoaded()) {
                await this.loadPratesfcLayer();
              }
              state.scene.toggleRain(true);
              state.showRain = true;
            } else {
              state.scene.toggleRain(false);
              state.showRain = false;
            }

            // Update URL with new layer state
            this.updateUrl();
            m.redraw();
          }
        }),

        // Time Slider
        m(TimeSlider, {
          currentTime: state.currentTime,
          startTime: (() => {
            const range = getDatasetRange('temp2m');
            return range ? range.startTime : new Date();
          })(),
          endTime: (() => {
            const range = getDatasetRange('temp2m');
            return range ? range.endTime : new Date();
          })(),
          onTimeChange: (newTime: Date) => {
            state.currentTime = newTime;
            if (state.scene) {
              state.scene.updateTime(newTime);
              this.updateUrl();
            }
            m.redraw();
          }
        })
      ])
    ]);
  }
};
