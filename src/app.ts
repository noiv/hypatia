/**
 * Main Application Component (Refactored)
 *
 * Slim orchestrator that delegates to services and components
 */

import m from 'mithril';

import { configLoader } from './config';

// Components
import { TimeCirclePanel } from './components/TimeCirclePanel';
import { TimeBarPanel } from './components/TimeBarPanel';
import { BootstrapModal } from './components/BootstrapModal';
import { HeaderPanel } from './components/HeaderPanel';
import { FullscreenPanel } from './components/FullscreenPanel';
import { LayersPanel } from './components/LayersPanel';
import { PerformancePanel } from './components/PerformancePanel';

// Services
import { EventManagerService } from './services/EventManagerService';
import { KeyboardShortcutsService } from './services/KeyboardShortcutsService';
import { AppStateService } from './services/AppStateService';
import { SceneLifecycleService } from './services/SceneLifecycleService';
import { AppLogicService } from './services/AppLogicService';
import { AppBootstrapService } from './services/AppBootstrapService';
import { LayerStateService } from './services/LayerStateService';
import { detectLocale, formatLocaleInfo } from './services/LocaleService';
import { ViewportControlsService } from './services/ViewportControlsService';

// Utils
import { sanitizeUrl } from './utils/sanitizeUrl';
import { clampTimeToDataRange } from './utils/timeUtils';
import { parseUrlState } from './utils/urlState';
import { getLayerCacheControl } from './services/LayerCacheControl';

import type { LayerId } from './visualization/ILayer';

interface AppComponent extends m.Component {
  // Services
  eventManager?: EventManagerService;
  keyboardShortcuts?: KeyboardShortcutsService;
  stateService?: AppStateService;
  sceneService?: SceneLifecycleService;
  logicService?: AppLogicService;
  viewportControls?: ViewportControlsService;

  // Flags
  isBootstrapping: boolean;

  // Lifecycle
  oninit(): Promise<void>;
  activate(): void;
  onremove(): void;
  view(): m.Vnode<any, any>;

  // Bootstrap
  runBootstrap(): Promise<void>;
  initializeScene(): Promise<void>;
  loadEnabledLayers(): Promise<void>;

  // Handlers
  handleTimeChange(newTime: Date): void;
  handleLayerToggle(layerId: LayerId): Promise<void>;
  handleTextToggle(): Promise<void>;
  handleFullscreenToggle(): void;
  handleTextSizeChange(action: 'increase' | 'decrease' | 'reset'): void;

  // Helpers
  getLayerStates(): Map<LayerId, any>;
  getDataRange(): { startTime: Date; endTime: Date };
}

export const App: AppComponent = {
  isBootstrapping: true,

  async oninit() {
    // Detect locale immediately (uses browser APIs, no async needed)
    const localeInfo = detectLocale();
    console.log(formatLocaleInfo(localeInfo));

    // Load hypatia config first (needed for defaultAltitude, defaultLayers)
    await configLoader.loadHypatiaConfig();

    // Sanitize URL and get corrected state (with locale for default camera position)
    const bootstrapState = { localeInfo } as any;
    const sanitizedState = sanitizeUrl(bootstrapState);

    // Initialize services (slider range will be calculated after config loads)
    this.stateService = new AppStateService({
      currentTime: sanitizedState.time,
      sliderStartTime: sanitizedState.time,  // Temporary, will be set in bootstrap
      sliderEndTime: sanitizedState.time,    // Temporary, will be set in bootstrap
      blend: 0.0,
      textEnabled: sanitizedState.layers.includes('text')
    });

    this.sceneService = new SceneLifecycleService();

    this.logicService = new AppLogicService(
      this.stateService,
      this.sceneService,
      () => this.isBootstrapping
    );

    this.eventManager = new EventManagerService();

    // Setup keyboard shortcuts
    this.keyboardShortcuts = new KeyboardShortcutsService(
      () => this.stateService!.getCurrentTime(),
      {
        onTimeChange: (newTime) => this.handleTimeChange(newTime),
        onFullscreenToggle: () => this.handleFullscreenToggle(),
        onTextSizeIncrease: () => this.handleTextSizeChange('increase'),
        onTextSizeDecrease: () => this.handleTextSizeChange('decrease'),
        onTextSizeReset: () => this.handleTextSizeChange('reset')
      }
    );

    // Register resize handler
    this.eventManager.register(
      window,
      'resize',
      () => this.sceneService!.getScene()?.onWindowResize()
    );

    // Bootstrap asynchronously
    this.runBootstrap();
  },

  activate() {
    const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const scene = this.sceneService!.getScene();
    if (!scene) return;

    // Initialize viewport controls service
    this.viewportControls = scene.createViewportControls({
      onTimeChange: (newTime) => this.handleTimeChange(newTime),
      onCameraChange: () => this.logicService!.updateUrl(),
      getCurrentTime: () => this.stateService!.getCurrentTime()
    });

    // Register event handlers
    this.eventManager!.register(window, 'keydown', this.keyboardShortcuts!.handleKeydown as EventListener);
    this.eventManager!.register(canvas, 'mousedown', (e) => this.viewportControls!.handleMouseDown(e as MouseEvent));
    this.eventManager!.register(canvas, 'mousemove', (e) => this.viewportControls!.handleMouseMove(e as MouseEvent));
    this.eventManager!.register(canvas, 'mouseup', (e) => this.viewportControls!.handleMouseUp(e as MouseEvent));
    this.eventManager!.register(canvas, 'click', (e) => this.viewportControls!.handleClick(e as MouseEvent));
    this.eventManager!.register(canvas, 'dblclick', (e) => this.viewportControls!.handleDoubleClick(e as MouseEvent));
    this.eventManager!.register(canvas, 'touchstart', (e) => this.viewportControls!.handleTouchStart(e as TouchEvent));
    this.eventManager!.register(canvas, 'touchmove', (e) => this.viewportControls!.handleTouchMove(e as TouchEvent), { passive: false });
    this.eventManager!.register(canvas, 'touchend', (e) => this.viewportControls!.handleTouchEnd(e as TouchEvent));
    this.eventManager!.register(
      canvas,
      'wheel',
      (e) => this.viewportControls!.handleWheel(e as WheelEvent),
      { passive: false }
    );

    console.log('App.activated');
  },

  async runBootstrap() {
    const result = await AppBootstrapService.bootstrap(this, (progress) => {
      this.stateService!.setBootstrapProgress({
        loaded: 0,
        total: 100,
        percentage: progress.percentage,
        currentFile: progress.label
      });
      m.redraw();
    });

    // Update state with bootstrap results
    // Extract only properties that exist in AppState
    this.stateService!.update({
      bootstrapStatus: result.bootstrapStatus,
      bootstrapProgress: result.bootstrapProgress,
      bootstrapError: result.bootstrapError,
      currentTime: result.currentTime || this.stateService!.getCurrentTime(),
      latestRun: result.latestRun,
      userLocation: result.userLocation,
      preloadedImages: result.preloadedImages
    });

    if (result.bootstrapStatus === 'ready') {
      // Get layer state (already initialized in bootstrap)
      this.stateService!.setLayerState(LayerStateService.getInstance());

      // Calculate fixed slider range from maxRangeDays (now that config is loaded)
      // Must match the data generation logic: first day 00z, last day 18z
      const hypatiaConfig = configLoader.getHypatiaConfig();
      const maxRangeDays = hypatiaConfig.data.maxRangeDays;
      const daysBack = Math.floor(maxRangeDays / 2);
      const currentTime = this.stateService!.getCurrentTime();

      // First timestamp: currentTime - daysBack at 00z
      const sliderStartTime = new Date(currentTime);
      sliderStartTime.setUTCDate(sliderStartTime.getUTCDate() - daysBack);
      sliderStartTime.setUTCHours(0, 0, 0, 0);

      // Last timestamp: (currentTime - daysBack + maxRangeDays) - 6 hours = last day at 18z
      const sliderEndTime = new Date(sliderStartTime);
      sliderEndTime.setUTCDate(sliderEndTime.getUTCDate() + maxRangeDays);
      sliderEndTime.setUTCHours(sliderEndTime.getUTCHours() - 6); // Back to 18z of previous day

      this.stateService!.update({ sliderStartTime, sliderEndTime });
    }

    // Log loaded with memory
    if ((performance as any).memory) {
      const mem = (performance as any).memory;
      console.log(`[HYPATIA_LOADED] Mem: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`);
    } else {
      console.log('[HYPATIA_LOADED]');
    }

    // Bootstrap complete - allow URL updates now
    this.isBootstrapping = false;

    m.redraw();
  },

  async initializeScene() {
    const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas not found');
    }

    const state = this.stateService!.get();
    const urlState = parseUrlState();

    const scene = await this.sceneService!.initializeScene(
      canvas,
      {
        blend: state.blend,
        currentTime: state.currentTime,
        ...(urlState?.camera && { cameraState: urlState.camera })
      },
      state.preloadedImages || undefined
    );

    this.stateService!.setScene(scene);
  },

  async loadEnabledLayers() {
    // Get layers from URL
    const urlState = parseUrlState();
    if (!urlState) {
      // No URL state - no layers to load
      return;
    }

    // Load layers (progress tracked via LayerCacheControl events)
    await this.sceneService!.loadLayersFromUrl(urlState.layers);

    // After all layers loaded, update sun direction based on which layers are visible
    const scene = this.sceneService!.getScene();
    const state = this.stateService!.get();
    if (scene) {
      scene.updateTime(state.currentTime);
    }

    // Apply text enabled state (text layer must be created first)
    if (state.textEnabled && scene) {
      scene.setTextEnabled(true);
    }
  },

  handleTimeChange(newTime: Date) {
    const clamped = clampTimeToDataRange(newTime);
    this.stateService!.setCurrentTime(clamped);
    this.sceneService!.getScene()?.updateTime(clamped);

    // Prioritize timestamps for progressive loading
    try {
      const cacheControl = getLayerCacheControl();
      const weatherLayers: LayerId[] = ['temp2m', 'precipitation'];
      for (const layerId of weatherLayers) {
        cacheControl.prioritizeTimestamps(layerId, clamped);
      }
    } catch (e) {
      // Cache control not initialized yet
    }

    this.logicService!.updateUrl();
    m.redraw();
  },

  async handleLayerToggle(layerId: LayerId) {
    await this.logicService!.handleLayerToggle(layerId);
    this.logicService!.updateUrl();
    m.redraw();
  },

  async handleTextToggle() {
    const scene = this.sceneService!.getScene();
    const currentlyEnabled = this.stateService!.isTextEnabled();
    const newEnabled = !currentlyEnabled;

    this.stateService!.setTextEnabled(newEnabled);

    if (scene) {
      if (newEnabled) {
        // Create text layer if not exists, then enable
        await scene.createLayer('text');
        scene.setLayerVisible('text', true);
      } else {
        // Disable text layer
        scene.setLayerVisible('text', false);
      }
      scene.setTextEnabled(newEnabled);
    }

    this.logicService!.updateUrl();
    m.redraw();
  },

  handleFullscreenToggle() {
    this.stateService!.toggleFullscreen();

    if (this.stateService!.isFullscreen()) {
      document.documentElement.requestFullscreen();
    } else {
      // Only exit fullscreen if document is actually in fullscreen mode
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    }

    m.redraw();
  },

  handleTextSizeChange(action: 'increase' | 'decrease' | 'reset') {
    const scene = this.sceneService!.getScene();
    if (!scene) return;

    const textService = scene.getTextService();
    if (!textService) return;

    switch (action) {
      case 'increase':
        textService.increaseFontSize();
        break;
      case 'decrease':
        textService.decreaseFontSize();
        break;
      case 'reset':
        textService.resetFontSize();
        break;
    }
  },

  getLayerStates(): Map<LayerId, any> {
    const scene = this.sceneService!.getScene();
    if (!scene) return new Map();

    const states = new Map<LayerId, any>();
    const layerIds: LayerId[] = [
      'earth',
      'sun',
      'graticule',
      'temp2m',
      'precipitation',
      'wind10m',
      'pressure_msl'
    ];

    for (const id of layerIds) {
      states.set(id, scene.getLayerState(id));
    }

    return states;
  },

  getDataRange(): { startTime: Date; endTime: Date } {
    const range = configLoader.getDatasetRange('temp2m');
    return range || { startTime: new Date(), endTime: new Date() };
  },

  onremove() {
    this.eventManager?.dispose();
    this.viewportControls?.dispose();
    this.sceneService?.dispose();
  },

  view() {
    // Guard against view being called before oninit completes
    if (!this.stateService) {
      return m('div.loading', 'Initializing...');
    }

    const state = this.stateService.get();

    // Show bootstrap modal during loading, waiting, or error
    if (state.bootstrapStatus !== 'ready') {
      return m(BootstrapModal as any, {
        progress: state.bootstrapProgress,
        error: state.bootstrapError,
        status: state.bootstrapStatus,
        onRetry: state.bootstrapStatus === 'error' ? () => {
          this.stateService!.setBootstrapStatus('loading');
          this.stateService!.setBootstrapError(null);
          this.stateService!.setBootstrapProgress(null);
          this.runBootstrap();
        } : undefined,
        onContinue: state.bootstrapStatus === 'waiting' ? () => {
          this.stateService!.setBootstrapStatus('ready');
        } : undefined
      });
    }

    // Show main app when ready
    return m('div.app-container.ready.no-events', [
      m(HeaderPanel, {
        onLogoClick: () => window.location.href = '/'
      }),

      m(FullscreenPanel, {
        isFullscreen: state.isFullscreen,
        onToggle: () => this.handleFullscreenToggle()
      }),

      m(LayersPanel, {
        layerStates: this.getLayerStates(),
        textEnabled: state.textEnabled,
        onLayerToggle: (id) => this.handleLayerToggle(id),
        onTextToggle: () => this.handleTextToggle(),
        blend: state.blend,
        onBlendChange: (newBlend) => {
          this.stateService!.setBlend(newBlend);
          this.sceneService!.getScene()?.setBasemapBlend(newBlend);
        }
      }),

      m(TimeCirclePanel, {
        currentTime: state.currentTime
      }),

      m(TimeBarPanel, {
        currentTime: state.currentTime,
        startTime: state.sliderStartTime,
        endTime: state.sliderEndTime,
        onTimeChange: (time) => this.handleTimeChange(time)
      }),

      m(PerformancePanel, {
        onElementCreated: (el) => state.scene?.setPerformanceElement(el)
      })
    ]);
  }
};
