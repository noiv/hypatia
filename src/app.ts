/**
 * Main Application Component
 *
 * Orchestrates app initialization, state management, and rendering
 */

import m from 'mithril';

import * as perform from './utils/performance';

import type { AppState } from './state/AppState';

import { configLoader } from './config';

import { Scene } from './visualization/scene';

import { TimeSlider } from './components/TimeSlider';
import { Controls } from './components/Controls';
import { BootstrapModal } from './components/BootstrapModal';

import { sanitizeUrl } from './utils/sanitizeUrl';
import { clampTimeToDataRange } from './utils/timeUtils';
import { WheelGestureDetector } from './utils/wheelGestureDetector';
import { parseUrlState, debouncedUpdateUrlState } from './utils/urlState';

import { LayerStateService } from './services/LayerStateService';
import { AppBootstrapService } from './services/AppBootstrapService';

interface AppComponent extends m.Component {
  state: AppState;
  _keydownHandler?: (e: KeyboardEvent) => void;
  _mousedownHandler?: (e: MouseEvent) => void;
  _clickHandler?: (e: MouseEvent) => void;
  _wheelHandler?: (e: WheelEvent) => void;
  _resizeHandler?: () => void;
  _wheelGestureDetector?: WheelGestureDetector;

  // Component methods
  activate(): void;
  runBootstrap(): Promise<void>;
  initializeScene(): Promise<void>;
  loadEnabledLayers(): Promise<void>;
  updateUrl(): void;
  handleLayerToggle(layerId: string): Promise<void>;
  renderControls(): m.Vnode<any, any> | null;
  renderPerformance(): m.Vnode<any, any> | null;
  handleReferenceClick(): void;
}

export const App: AppComponent = {
  state: null as any, // Initialized in oninit

  async oninit() {
    // Sanitize URL and get corrected state
    const sanitizedState = sanitizeUrl();

    // Initialize state synchronously
    this.state = {
      currentTime: sanitizedState.time,
      isFullscreen: false,
      blend: 0.0,
      textEnabled: sanitizedState.layers.includes('text'),
      scene: null,
      bootstrapStatus: 'loading',
      bootstrapProgress: null,
      bootstrapError: null,
      preloadedImages: null,
      latestRun: null,
      userLocation: null,
      layerState: null
    };

    // Setup resize listener early (before bootstrap)
    this._resizeHandler = () => {
      if (this.state.scene) {
        this.state.scene.onWindowResize();
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    // Bootstrap asynchronously
    this.runBootstrap();
  },

  activate() {
    const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const { scene } = this.state;

    // Initialize wheel gesture detector
    this._wheelGestureDetector = new WheelGestureDetector({
      timeoutMs: 100,
      onReset: () => {
        // Re-enable controls when gesture ends
        if (scene) {
          scene.toggleControls(true);
        }
      }
    });

    // Keyboard events
    this._keydownHandler = (e: KeyboardEvent) => {
      const { currentTime, scene } = this.state;

      // Spacebar: toggle time animation
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        // TODO: Implement time animation
      }

      // Arrow keys: adjust time
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const delta = e.code === 'ArrowLeft' ? -1 : 1;
        const newTime = new Date(currentTime.getTime() + delta * 60 * 60 * 1000);
        const clampedTime = clampTimeToDataRange(newTime);

        this.state.currentTime = clampedTime;
        if (scene) {
          scene.updateTime(clampedTime);
          this.updateUrl();
        }
        m.redraw();
      }

      // F: toggle fullscreen
      if (e.code === 'KeyF') {
        e.preventDefault();
        this.state.isFullscreen = !this.state.isFullscreen;
        if (this.state.isFullscreen) {
          document.documentElement.requestFullscreen();
        } else {
          // Only exit fullscreen if document is actually in fullscreen mode
          if (document.fullscreenElement) {
            document.exitFullscreen();
          }
        }
        m.redraw();
      }

      // Text size shortcuts: Cmd/Ctrl +/-/0
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault();
          if (scene) {
            const textService = scene.getTextService();
            if (textService) {
              textService.increaseFontSize();
            }
          }
        } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          if (scene) {
            const textService = scene.getTextService();
            if (textService) {
              textService.decreaseFontSize();
            }
          }
        } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault();
          if (scene) {
            const textService = scene.getTextService();
            if (textService) {
              textService.resetFontSize();
            }
          }
        }
      }
    };
    window.addEventListener('keydown', this._keydownHandler);

    // Mouse/touch events - delegate to Scene
    this._mousedownHandler = (e: MouseEvent) => {
      if (scene) {
        scene.onMouseDown(e);
      }
    };
    canvas.addEventListener('mousedown', this._mousedownHandler);

    this._clickHandler = (e: MouseEvent) => {
      if (scene) {
        scene.onClick(e);
      }
    };
    canvas.addEventListener('click', this._clickHandler);

    // Wheel events - App handles horizontal scroll for time change
    // OrbitControls handles vertical scroll for zoom (only when over Earth)
    this._wheelHandler = (e: WheelEvent) => {
      if (!this._wheelGestureDetector) return;

      const { scene } = this.state;
      if (!scene) return;

      // Detect gesture direction
      const gestureMode = this._wheelGestureDetector.detect(e);

      // Handle horizontal scroll (time change)
      if (gestureMode === 'horizontal') {
        e.preventDefault();

        // Disable OrbitControls during horizontal gesture
        scene.toggleControls(false);

        // Time change: 1 minute per pixel of scroll
        const minutesPerPixel = 1;
        const minutes = e.deltaX * minutesPerPixel;
        const hoursDelta = minutes / 60;

        const { currentTime } = this.state;
        const newTime = new Date(currentTime.getTime() + hoursDelta * 3600000);
        const clampedTime = clampTimeToDataRange(newTime);

        this.state.currentTime = clampedTime;
        scene.updateTime(clampedTime);
        this.updateUrl();
        m.redraw();
      }
      // Handle vertical scroll (zoom) - only when over Earth
      else if (gestureMode === 'vertical') {
        const isOverEarth = scene.checkMouseOverEarth(e.clientX, e.clientY);
        if (!isOverEarth) {
          e.preventDefault();
          scene.toggleControls(false);
          // Re-enable on next gesture reset
        }
        // If over Earth, ensure controls are enabled for zoom
        else {
          scene.toggleControls(true);
        }
      }
    };
    canvas.addEventListener('wheel', this._wheelHandler, { passive: false });

    console.log('App.activated');
  },

  async runBootstrap() {

    const result = await AppBootstrapService.bootstrap(this, (progress) => {
      this.state.bootstrapProgress = {
        loaded: 0,
        total: 100,
        percentage: progress.percentage,
        currentFile: progress.label
      };
      m.redraw();
    });

    // Update state with bootstrap results
    Object.assign(this.state, result);

    if (result.bootstrapStatus === 'ready') {
      // Get layer state (already initialized in bootstrap)
      this.state.layerState = LayerStateService.getInstance();

      // Re-sanitize URL with bootstrap state (locale, geolocation)
      // If URL has default (0,0), update with locale-based default
      if (result.localeInfo && window.location.search.includes('ll=0.000,0.000')) {
        const sanitizedState = sanitizeUrl(result, true);  // Force use of bootstrap camera position
        this.state.currentTime = sanitizedState.time;

        // Update scene camera to new position
        if (this.state.scene) {
          this.state.scene.setCameraState(sanitizedState.camera, sanitizedState.camera.distance);
        }
      }
    }

    // Log loaded with memory
    if ((performance as any).memory) {
      const mem = (performance as any).memory;
      console.log(`[HYPATIA_LOADED] Mem: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`);
    } else {
      console.log('[HYPATIA_LOADED]');
    }

    m.redraw();
  },

  async initializeScene() {
    const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas not found');
    }

    const { blend, currentTime } = this.state;
    const urlState = parseUrlState();
    const scene = new Scene(canvas);

    if (urlState) {
      scene.setCameraState(urlState.camera, urlState.camera.distance);
    }

    scene.setBasemapBlend(blend);
    scene.updateTime(currentTime);

    // Setup camera change handler for URL updates
    scene.onCameraChange(() => {
      this.updateUrl();
    });

    this.state.scene = scene;
  },

  async loadEnabledLayers() {
    const { scene } = this.state;
    if (!scene) return;

    // Get layers from URL
    const urlState = parseUrlState();
    if (!urlState) {
      // No URL state - no layers to load
      return;
    }

    const layersToLoad = urlState.layers;

    if (layersToLoad.length > 0) {
      console.log(`Bootstrap.loading: ${layersToLoad.join(', ')}`);
    }

    for (const layerId of layersToLoad) {
      try {
        m.redraw();

        // Create and show layer
        await scene.createLayer(layerId as any);
        scene.setLayerVisible(layerId as any, true);

        m.redraw();
      } catch (error) {
        console.error(`Bootstrap.error: ${layerId}`, error);
      }
    }

    // After all layers loaded, update sun direction based on which layers are visible
    // This ensures earth/temp2m get correct sun direction (zero if sun not loaded)
    scene.updateTime(this.state.currentTime);

    // Apply text enabled state (text layer must be created first)
    if (this.state.textEnabled) {
      scene.setTextEnabled(true);
    }
  },

  updateUrl() {
    const { scene, currentTime, textEnabled } = this.state;
    if (!scene) return;

    // Get visible layers from scene
    const visibleLayers = scene.getVisibleLayers();

    // Add 'text' to layers if enabled
    const layers = textEnabled
      ? [...visibleLayers, 'text']
      : visibleLayers;

    debouncedUpdateUrlState({
      time: currentTime,
      camera: scene.getCameraState(),
      layers
    }, 100);
  },

  async handleLayerToggle(layerId: string) {
    const { scene } = this.state;
    if (!scene) return;

    try {
      const state = scene.getLayerState(layerId as any); // Cast for now

      if (!state.created) {
        // Layer not created yet - create and show it
        await scene.createLayer(layerId as any);
        scene.setLayerVisible(layerId as any, true);
      } else {
        // Layer exists - toggle visibility
        scene.setLayerVisible(layerId as any, !state.visible);
      }

      this.updateUrl();
      m.redraw();
    } catch (error) {
      console.error(`Layer toggle failed:`, error);
    }
  },


  onremove() {
    const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;

    // Clean up event listeners
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    if (canvas) {
      if (this._mousedownHandler) {
        canvas.removeEventListener('mousedown', this._mousedownHandler);
      }
      if (this._clickHandler) {
        canvas.removeEventListener('click', this._clickHandler);
      }
      if (this._wheelHandler) {
        canvas.removeEventListener('wheel', this._wheelHandler);
      }
    }

    // Clean up wheel gesture detector
    if (this._wheelGestureDetector) {
      this._wheelGestureDetector.dispose();
    }

    // Clean up scene
    if (this.state.scene) {
      this.state.scene.dispose();
    }
  },

  view() {
    // Guard against view being called before oninit completes
    if (!this.state) {
      return m('div.loading', 'Initializing...');
    }

    const { bootstrapStatus, bootstrapProgress, bootstrapError, currentTime } = this.state;

    // Show bootstrap modal during loading or error
    if (bootstrapStatus !== 'ready') {
      return m(BootstrapModal as any, {
        progress: bootstrapProgress,
        error: bootstrapError,
        onRetry: bootstrapStatus === 'error' ? () => {
          this.state.bootstrapStatus = 'loading';
          this.state.bootstrapError = null;
          this.state.bootstrapProgress = null;
          this.runBootstrap();
        } : undefined
      });
    }

    // Show main app when ready
    return m('div.app-container', {
      class: bootstrapStatus === 'ready' ? 'ready' : ''
    }, [
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
            currentTime.toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            })
          ),
          m('p.time-utc',
            currentTime.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
          )
        ]),

        // Controls
        this.renderControls(),
        this.renderPerformance(),

        // Time Slider
        m(TimeSlider, {
          currentTime,
          startTime: (() => {
            const range = configLoader.getDatasetRange('temp2m');
            return range ? range.startTime : new Date();
          })(),
          endTime: (() => {
            const range = configLoader.getDatasetRange('temp2m');
            return range ? range.endTime : new Date();
          })(),
          onTimeChange: (newTime: Date) => {
            this.state.currentTime = newTime;
            if (this.state.scene) {
              this.state.scene.updateTime(newTime);
              this.updateUrl();
            }
            m.redraw();
          }
        })
      ])
    ]);
  },

  renderPerformance() {
    return m('.performance',
      m('.info', {
        oncreate: (vnode: any) => {
          // Pass DOM reference to scene for direct updates
          if (this.state.scene) {
            this.state.scene.setPerformanceElement(vnode.dom as HTMLElement);
          }
        }
      }, perform.line())
    );
  },

  renderControls() {
    const { isFullscreen, blend, scene, textEnabled } = this.state;

    // Don't render controls until scene is ready
    if (!scene) {
      return null;
    }

    // Get layer states from scene
    const earthState = scene.getLayerState('earth');
    const sunState = scene.getLayerState('sun');
    const temp2mState = scene.getLayerState('temp2m');
    const precipitationState = scene.getLayerState('precipitation');
    const windState = scene.getLayerState('wind10m');
    const pressureState = scene.getLayerState('pressure');
    const graticuleState = scene.getLayerState('graticule');

    return m(Controls, {
      isFullscreen,
      onFullscreenToggle: () => {
        this.state.isFullscreen = !this.state.isFullscreen;
        if (this.state.isFullscreen) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      },
      blend,
      onBlendChange: (newBlend: number) => {
        this.state.blend = newBlend;
        if (scene) {
          scene.setBasemapBlend(newBlend);
        }
      },
      onReferenceClick: () => {
        this.handleReferenceClick();
      },
      showEarth: earthState.created && earthState.visible,
      onEarthToggle: async () => {
        await this.handleLayerToggle('earth');
      },
      showSun: sunState.created && sunState.visible,
      onSunToggle: async () => {
        await this.handleLayerToggle('sun');
      },
      showTemp2m: temp2mState.created && temp2mState.visible,
      temp2mLoading: false, // TODO: track loading state
      onTemp2mToggle: async () => {
        await this.handleLayerToggle('temp2m');
      },
      showRain: precipitationState.created && precipitationState.visible,
      onRainToggle: async () => {
        await this.handleLayerToggle('precipitation');
      },
      showWind: windState.created && windState.visible,
      onWindToggle: async () => {
        await this.handleLayerToggle('wind10m');
      },
      showPressure: pressureState.created && pressureState.visible,
      onPressureToggle: async () => {
        await this.handleLayerToggle('pressure');
      },
      showGraticule: graticuleState.created && graticuleState.visible,
      onGraticuleToggle: async () => {
        await this.handleLayerToggle('graticule');
      },
      showText: textEnabled,
      onTextToggle: async () => {
        this.state.textEnabled = !this.state.textEnabled;
        if (scene) {
          if (this.state.textEnabled) {
            // Create text layer if not exists, then enable
            await scene.createLayer('text');
            scene.setLayerVisible('text', true);
          } else {
            // Disable text layer
            scene.setLayerVisible('text', false);
          }
          scene.setTextEnabled(this.state.textEnabled);
        }
        this.updateUrl();
        m.redraw();
      }
    });
  },

  handleReferenceClick() {
    const { scene } = this.state;

    // Reference state: 2x Earth radius altitude, looking at lat=0 lon=0
    const referenceTime = new Date('2025-10-29T12:00:00Z');
    const referenceAltitude = 12742000; // 2x Earth radius in meters
    const referenceDistance = (referenceAltitude / 6371000) + 1; // Convert to THREE.js units

    const referencePosition = {
      x: 0,
      y: 0,
      z: referenceDistance
    };

    // Update state
    this.state.currentTime = referenceTime;
    if (scene) {
      scene.updateTime(referenceTime);
      scene.setCameraState(referencePosition, referenceDistance);
    }

    // Update URL using proper updateUrl method
    this.updateUrl();

    m.redraw();
  }
};
