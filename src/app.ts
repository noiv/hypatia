/**
 * Main Application Component (Refactored - New Architecture)
 *
 * Slim orchestrator that delegates to services
 * Uses new event-driven architecture with centralized service management
 */

import m from 'mithril';

// Components
import { TimeCirclePanel } from './components/TimeCirclePanel';
import { TimeBarPanel } from './components/TimeBarPanel';
import { BootstrapModal, type BootstrapModalAttrs } from './components/BootstrapModal';
import { HeaderPanel } from './components/HeaderPanel';
import { FullscreenPanel } from './components/FullscreenPanel';
import { LayersPanel, type LayersPanelAttrs } from './components/LayersPanel';
import { PerformancePanel } from './components/PerformancePanel';

// New Services
import { ConfigService } from './services/ConfigService';
import { DateTimeService } from './services/DateTimeService';
import { DownloadService } from './services/DownloadService';
import { TextureService } from './services/TextureService';
import { LayersService } from './services/LayersService';
import { AppService } from './services/AppService';

// Existing Services
import { EventService } from './services/EventService';
import { AppStateService } from './services/AppStateService';
import { Scene } from './visualization/scene';
import { AppBootstrapService } from './services/AppBootstrapService';
import { ViewportControlsService } from './services/ViewportControlsService';

// Utils
import { detectLocale, formatLocaleInfo } from './services/LocaleService';
import { sanitizeUrlState, parseUrlState } from './services/UrlService';

import type { LayerId } from './layers/ILayer';
import type { LayerRenderState } from './config/types';

interface AppComponent extends m.Component {
  // New Services
  configService?: ConfigService;
  dateTimeService?: DateTimeService;
  downloadService?: DownloadService;
  textureService?: TextureService;
  layersService?: LayersService;
  appService?: AppService;

  // Existing Services
  eventService?: EventService;
  stateService?: AppStateService;
  scene?: Scene;
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
  initializeScene(): Promise<Scene | undefined>;
  startAggressiveDownloads(): void;

  // Handlers
  handleTimeChange(newTime: Date): void;
  handleLayerToggle(layerId: LayerId): Promise<void>;
  handleTextToggle(): Promise<void>;
  handleFullscreenToggle(): void;
  handleTextSizeChange(action: 'increase' | 'decrease' | 'reset'): void;

  // Helpers
  getLayerStates(): Map<LayerId, LayerRenderState>;
  getDataRange(): { startTime: Date; endTime: Date };
}

export const App: AppComponent = {
  isBootstrapping: true,

  async oninit() {
    // Detect locale
    const localeInfo = detectLocale();
    console.log(formatLocaleInfo(localeInfo));

    // Initialize services in dependency order
    // 1. Foundation services (no dependencies)
    this.configService = new ConfigService();

    // Load all configs before continuing
    await this.configService.loadAll();

    // 2. Services that depend on config
    this.dateTimeService = new DateTimeService(this.configService);

    // Sanitize URL and get corrected state (needs config loaded first)
    const sanitizedState = sanitizeUrlState(this.configService, localeInfo);

    // 2. Download service
    const hypatiaConfig = this.configService.getHypatiaConfig();
    const downloadConfig = {
      maxRangeDays: hypatiaConfig?.data?.maxRangeDays || 14,
      maxConcurrentDownloads: hypatiaConfig?.dataCache?.maxConcurrentDownloads || 4,
      bandwidthSampleSize: 10
    };
    this.downloadService = new DownloadService(
      downloadConfig,
      this.configService,
      this.dateTimeService
    );

    // Initialize state service
    this.stateService = new AppStateService({
      currentTime: sanitizedState.time,
      blend: 0.0,
      textEnabled: sanitizedState.layers.includes('text'),
      localeInfo,
      timezone: {
        short: Intl.DateTimeFormat().resolvedOptions().timeZone,
        long: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });

    // Initialize LayersService (Scene and TextureService will be injected later)
    this.layersService = new LayersService(
      this.downloadService,
      this.configService,
      this.dateTimeService
    );

    // Scene service
    // Scene will be created in initializeScene()

    // Event service (handles event registration + keyboard shortcuts)
    this.eventService = new EventService(
      () => this.stateService!.getCurrentTime(),
      {
        onTimeChange: (newTime) => this.handleTimeChange(newTime),
        onFullscreenToggle: () => this.handleFullscreenToggle(),
        onTextSizeIncrease: () => this.handleTextSizeChange('increase'),
        onTextSizeDecrease: () => this.handleTextSizeChange('decrease'),
        onTextSizeReset: () => this.handleTextSizeChange('reset')
      },
      this.dateTimeService!,
      this.configService!
    );

    // Note: AppService and LayersService will be created after scene is initialized
    // (they need renderer for TextureService)

    // Register resize handler
    this.eventService.register(
      window,
      'resize',
      () => this.scene?.onWindowResize()
    );

    // Bootstrap asynchronously
    this.runBootstrap();
  },

  activate() {
    const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;
    // Start animation loop
    this.scene!.start();

    // Initialize viewport controls
    this.viewportControls = this.scene!.createViewportControls({
      onTimeChange: (newTime) => this.handleTimeChange(newTime),
      onCameraChange: () => this.appService!.updateUrl(),
      getCurrentTime: () => this.stateService!.getCurrentTime()
    }, this.configService!, this.dateTimeService);

    // Register event handlers
    this.eventService!.register(window, 'keydown', this.eventService!.handleKeydown as EventListener);
    this.eventService!.register(canvas, 'mousedown', (e) => this.viewportControls!.handleMouseDown(e as MouseEvent));
    this.eventService!.register(canvas, 'mousemove', (e) => this.viewportControls!.handleMouseMove(e as MouseEvent));
    this.eventService!.register(canvas, 'mouseup', (e) => this.viewportControls!.handleMouseUp(e as MouseEvent));
    this.eventService!.register(canvas, 'click', (e) => this.viewportControls!.handleClick(e as MouseEvent));
    this.eventService!.register(canvas, 'dblclick', (e) => this.viewportControls!.handleDoubleClick(e as MouseEvent));
    this.eventService!.register(canvas, 'touchstart', (e) => this.viewportControls!.handleTouchStart(e as TouchEvent));
    this.eventService!.register(canvas, 'touchmove', (e) => this.viewportControls!.handleTouchMove(e as TouchEvent), { passive: false });
    this.eventService!.register(canvas, 'touchend', (e) => this.viewportControls!.handleTouchEnd(e as TouchEvent));
    this.eventService!.register(
      canvas,
      'wheel',
      (e) => this.viewportControls!.handleWheel(e as WheelEvent),
      { passive: false }
    );

    console.log('App.activated');
  },

  async runBootstrap() {
    await AppBootstrapService.bootstrap(
      {
        initializeScene: this.initializeScene.bind(this),
        activate: this.activate.bind(this),
        configService: this.configService!,
        dateTimeService: this.dateTimeService!,
        getScene: () => this.scene,
        stateService: this.stateService!,
        downloadService: this.downloadService!,
        layersService: this.layersService!,
        setAppService: (service) => { this.appService = service; },
        isBootstrapping: () => this.isBootstrapping
      },
      (progress) => {
        this.stateService!.setBootstrapProgress({
          loaded: 0,
          total: 100,
          percentage: progress.percentage,
          currentFile: progress.label
        });
        m.redraw();
      }
    );

    // Bootstrap directly mutates stateService, no need to copy results
    const bootstrapStatus = this.stateService!.getBootstrapStatus();

    if (bootstrapStatus === 'ready') {
      // Set layer state (now owned by LayersService)
      this.stateService!.setLayerState(this.layersService!.getLayerState());

      // Sync URL with current state (AppService created in bootstrap)
      this.appService!.updateUrl();
    }

    // Log memory usage (Chrome/Edge/Safari only)
    if (performance.memory) {
      const mem = performance.memory;
      console.log(`[HYPATIA_LOADED] Mem: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`);
    } else {
      console.log('[HYPATIA_LOADED]');
    }

    // Bootstrap complete
    this.isBootstrapping = false;
    m.redraw();
  },

  async initializeScene(): Promise<Scene | undefined> {
    const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas not found');
    }

    const state = this.stateService!.get();
    const urlState = parseUrlState()!; // Guaranteed to exist after sanitizeUrl

    // Create scene
    this.scene = new Scene(canvas, state.currentTime, state.preloadedImages || undefined);

    // Set camera position from URL
    this.scene.setCameraState(urlState.camera, urlState.camera.distance);

    // Set initial scene state
    this.scene.setBasemapBlend(state.blend);
    this.scene.updateTime(state.currentTime);

    // Create TextureService now that we have the renderer
    const renderer = this.scene.getRenderer()!;
    this.textureService = new TextureService(renderer);

    // Inject Scene and TextureService into LayersService
    // This must happen before LayersService.createLayers() is called
    this.layersService!.setServices(this.scene, this.textureService);

    this.stateService!.setScene(this.scene);

    // Inject DownloadService into Scene for progress canvas updates
    this.scene.setDownloadService(this.downloadService!);
    return this.scene;
  },

  handleTimeChange(newTime: Date) {
    // Get slider bounds (actual first and last timestep times)
    const { startTime, endTime } = this.dateTimeService!.getSliderBounds();

    // Clamp time to data window bounds
    const clamped = this.dateTimeService!.clampToFixedBounds(
      newTime,
      startTime,
      endTime
    );

    this.stateService!.setCurrentTime(clamped);
    this.scene?.updateTime(clamped);

    // Prioritize timestamps for all visible data layers
    this.layersService?.prioritizeDownloads(clamped);

    this.appService!.updateUrl();
    m.redraw();
  },

  async handleLayerToggle(layerId: LayerId) {
    // Delegate to AppService which uses LayersService
    if (!this.appService) {
      console.warn('[App] handleLayerToggle called before AppService initialized');
      return;
    }
    await this.appService.handleLayerToggle(layerId);
    this.appService.updateUrl();
    m.redraw();
  },

  async handleTextToggle() {
    const currentlyEnabled = this.stateService!.isTextEnabled();
    const newEnabled = !currentlyEnabled;

    this.stateService!.setTextEnabled(newEnabled);

    // Use LayersService to toggle text layer
    if (this.layersService && this.stateService) {
      const currentTime = this.stateService.getCurrentTime();

      // Create text layer if it doesn't exist yet
      if (!this.layersService.hasLayer('text')) {
        await this.layersService.createLayers(['text'], currentTime);
      }

      // Toggle visibility
      await this.layersService.toggle('text', newEnabled);

      // Update Scene text enabled state
      if (this.scene) {
        this.scene.setTextEnabled(newEnabled);
      }
    }

    this.appService?.updateUrl();
    m.redraw();
  },

  handleFullscreenToggle() {
    if (!this.appService) {
      console.warn('[App] handleFullscreenToggle called before AppService initialized');
      return;
    }
    this.appService.handleFullscreenToggle();
    m.redraw();
  },

  handleTextSizeChange(action: 'increase' | 'decrease' | 'reset') {
    const textService = this.scene!.getTextService()!;

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

  getLayerStates(): Map<LayerId, LayerRenderState> {
    const states = new Map<LayerId, LayerRenderState>();
    const layerIds: LayerId[] = [
      'earth',
      'sun',
      'graticule',
      'temp',
      'rain',
      'wind',
      'pressure'
    ];

    // Use LayersService as source of truth for layer state
    if (this.layersService) {
      for (const id of layerIds) {
        const created = this.layersService.hasLayer(id);
        if (created) {
          const visible = this.layersService.isVisible(id);
          states.set(id, { created: true, visible });
        } else {
          states.set(id, { created: false, visible: false });
        }
      }
    } else if (this.scene) {
      // Fallback to scene if LayersService not available
      for (const id of layerIds) {
        states.set(id, this.scene.getLayerState(id));
      }
    }

    return states;
  },

  getDataRange(): { startTime: Date; endTime: Date } {
    const range = this.configService!.getDatasetRange('temp');
    return range || { startTime: new Date(), endTime: new Date() };
  },

  /**
   * Start aggressive downloads for all visible layers
   * Called when user chooses "Aggressive" mode
   */
  startAggressiveDownloads() {
    const visibleLayerIds = this.layersService!.getVisibleLayerIds();
    console.log(`[App] Starting aggressive downloads for layers:`, visibleLayerIds);

    // Queue all timesteps for each visible data layer
    for (const layerId of visibleLayerIds) {
      const metadata = this.layersService!.getMetadata(layerId);
      if (metadata?.isDataLayer) {
        this.downloadService!.downloadAllTimesteps(layerId);
      }
    }
  },

  onremove() {
    this.eventService?.dispose();
    this.viewportControls?.dispose();
    this.scene?.dispose();
    this.layersService?.dispose();
    this.downloadService?.dispose();
  },

  view() {
    // Guard against view being called before oninit completes
    if (!this.stateService) {
      return m('div.loading', 'Initializing...');
    }

    const state = this.stateService.get();

    // Always render modal, but hide it when ready
    const showModal = state.bootstrapStatus === 'loading' ||
                      state.bootstrapStatus === 'error' ||
                      state.bootstrapStatus === 'waiting';

    const modalProps: BootstrapModalAttrs = {
      progress: state.bootstrapProgress,
      error: state.bootstrapError,
      status: state.bootstrapStatus,
      visible: showModal,
      ...(state.bootstrapStatus === 'error' && {
        onRetry: () => {
          this.stateService!.setBootstrapStatus('loading');
          this.stateService!.setBootstrapError(null);
          this.stateService!.setBootstrapProgress(null);
          this.runBootstrap();
        }
      }),
      ...(state.bootstrapStatus === 'waiting' && {
        onContinue: (downloadMode: 'aggressive' | 'on-demand') => {
          this.stateService!.setDownloadMode(downloadMode);
          this.stateService!.setBootstrapStatus('ready');
          console.log(`[App] User selected download mode: ${downloadMode}`);

          // Sync URL with current state (AppService created in bootstrap)
          this.appService!.updateUrl();

          // If aggressive, trigger background downloads
          if (downloadMode === 'aggressive') {
            this.startAggressiveDownloads();
          }
        }
      })
    };

    const modalOverlay = m(BootstrapModal, modalProps);

    // Main app should be visible when ready OR waiting
    const showApp = state.bootstrapStatus === 'ready' || state.bootstrapStatus === 'waiting';

    return m('div', [
      // Modal overlay (shown FIRST so it's always ready on top)
      modalOverlay,

      // App container (always rendered, but hidden during loading/error)
      m('div.app-container.ready.no-events', {
        style: showApp ? '' : 'display: none;'
      }, [
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
        onLayerToggle: (id: LayerId) => this.handleLayerToggle(id),
        onTextToggle: () => this.handleTextToggle(),
        blend: state.blend,
        onBlendChange: (newBlend: number) => {
          this.stateService!.setBlend(newBlend);
          this.scene?.setBasemapBlend(newBlend);
        },
        downloadService: this.downloadService!,
        configService: this.configService!,
        onProgressCanvasCreated: (layerId, canvas) => {
          this.scene?.setProgressCanvas(layerId, canvas);
        }
      } satisfies LayersPanelAttrs),

      m(TimeCirclePanel, {
        currentTime: state.currentTime
      }),

      m(TimeBarPanel, {
        currentTime: state.currentTime,
        onTimeChange: (time) => this.handleTimeChange(time),
        dateTimeService: this.dateTimeService!
      }),

      m(PerformancePanel, {
        onElementCreated: (el) => state.scene?.setPerformanceElement(el)
      })
      ])
    ]);
  }
};
