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
import { BootstrapModal } from './components/BootstrapModal';
import { HeaderPanel } from './components/HeaderPanel';
import { FullscreenPanel } from './components/FullscreenPanel';
import { LayersPanel } from './components/LayersPanel';
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
import { sanitizeUrl } from './utils/sanitizeUrl';
import { parseUrlState } from './utils/urlState';

import type { LayerId } from './visualization/ILayer';

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
  initializeScene(): Promise<void>;

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
    // Detect locale
    const localeInfo = detectLocale();
    console.log(formatLocaleInfo(localeInfo));

    // Initialize services in dependency order
    // 1. Foundation services (no dependencies)
    this.configService = new ConfigService();
    this.dateTimeService = new DateTimeService();

    // Load all configs before continuing
    await this.configService.loadAll();

    // Sanitize URL and get corrected state (needs config loaded first)
    const bootstrapState = { localeInfo } as any;
    const sanitizedState = sanitizeUrl(this.configService, bootstrapState);

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
      sliderStartTime: sanitizedState.time,  // Will be set in bootstrap
      sliderEndTime: sanitizedState.time,    // Will be set in bootstrap
      blend: 0.0,
      textEnabled: sanitizedState.layers.includes('text'),
      localeInfo,
      timezone: {
        short: Intl.DateTimeFormat().resolvedOptions().timeZone,
        long: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });

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
    if (!canvas) return;

    if (!this.scene) return;

    // Start animation loop
    this.scene.start();

    // Initialize viewport controls
    this.viewportControls = this.scene.createViewportControls({
      onTimeChange: (newTime) => this.handleTimeChange(newTime),
      onCameraChange: () => this.appService?.updateUrl(),
      getCurrentTime: () => this.stateService!.getCurrentTime()
    }, this.dateTimeService);

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
    const result = await AppBootstrapService.bootstrap(
      {
        initializeScene: this.initializeScene.bind(this),
        activate: this.activate.bind(this),
        configService: this.configService,
        getScene: () => this.scene,
        downloadService: this.downloadService,
        layersService: this.layersService
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

    // Update state with bootstrap results
    const urlState = parseUrlState();
    this.stateService!.update({
      bootstrapStatus: result.bootstrapStatus,
      bootstrapProgress: result.bootstrapProgress,
      bootstrapError: result.bootstrapError,
      currentTime: urlState?.time || result.currentTime || this.stateService!.getCurrentTime(),
      latestRun: result.latestRun,
      userLocation: result.userLocation,
      preloadedImages: result.preloadedImages
    });

    if (result.bootstrapStatus === 'ready') {
      // Set layer state (now owned by LayersService)
      if (this.layersService) {
        this.stateService!.setLayerState(this.layersService.getLayerState());
      }

      // Calculate slider range
      const hypatiaConfig = this.configService!.getHypatiaConfig();
      const maxRangeDays = hypatiaConfig.data.maxRangeDays;
      const daysBack = Math.floor(maxRangeDays / 2);
      const currentTime = this.stateService!.getCurrentTime();

      const sliderStartTime = new Date(currentTime);
      sliderStartTime.setUTCDate(sliderStartTime.getUTCDate() - daysBack);
      sliderStartTime.setUTCHours(0, 0, 0, 0);

      const sliderEndTime = new Date(sliderStartTime);
      sliderEndTime.setUTCDate(sliderEndTime.getUTCDate() + maxRangeDays);
      sliderEndTime.setUTCHours(sliderEndTime.getUTCHours() - 6);

      this.stateService!.update({ sliderStartTime, sliderEndTime });

      // Create AppService (TextureService and LayersService already created in initializeScene)
      if (this.layersService) {
        this.appService = new AppService(
          this.stateService!,
          () => this.scene,
          this.layersService,
          this.configService!,
          () => this.isBootstrapping
        );
      }
    }

    // Log memory usage
    if ((performance as any).memory) {
      const mem = (performance as any).memory;
      console.log(`[HYPATIA_LOADED] Mem: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`);
    } else {
      console.log('[HYPATIA_LOADED]');
    }

    // Bootstrap complete
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

    // Create scene
    this.scene = new Scene(canvas, state.currentTime, state.preloadedImages || undefined);

    // Set camera position from URL if available
    if (urlState?.camera) {
      this.scene.setCameraState(urlState.camera, urlState.camera.distance);
    }

    // Set initial scene state
    this.scene.setBasemapBlend(state.blend);
    this.scene.updateTime(state.currentTime);

    // Create TextureService and LayersService now that we have the renderer
    const renderer = this.scene.getRenderer?.();
    if (renderer) {
      this.textureService = new TextureService(renderer);
      this.layersService = new LayersService(
        this.downloadService!,
        this.configService!,
        this.dateTimeService!
      );

      // Inject services into scene immediately after creation
      // This must happen before bootstrap creates layers
      this.scene.setServices(
        this.downloadService!,
        this.textureService,
        this.dateTimeService!,
        this.configService!
      );
    }

    this.stateService!.setScene(this.scene);
  },

  handleTimeChange(newTime: Date) {
    const currentTime = this.stateService!.getCurrentTime();
    const hypatiaConfig = this.configService!.getHypatiaConfig();
    const maxRangeDays = hypatiaConfig.data.maxRangeDays;

    // Clamp time to data window
    const clamped = this.dateTimeService!.clampToDataWindow(
      newTime,
      currentTime,
      maxRangeDays
    );

    this.stateService!.setCurrentTime(clamped);
    this.scene?.updateTime(clamped);

    // Prioritize timestamps for progressive loading
    if (this.downloadService) {
      const weatherLayers: LayerId[] = ['temp2m', 'precipitation'];
      for (const layerId of weatherLayers) {
        this.downloadService.prioritizeTimestamps(layerId, clamped);
      }
    }

    this.appService?.updateUrl();
    m.redraw();
  },

  async handleLayerToggle(layerId: LayerId) {
    // Delegate to AppService which uses LayersService
    if (this.appService) {
      await this.appService.handleLayerToggle(layerId);
      this.appService.updateUrl();
    }
    m.redraw();
  },

  async handleTextToggle() {
    const currentlyEnabled = this.stateService!.isTextEnabled();
    const newEnabled = !currentlyEnabled;

    this.stateService!.setTextEnabled(newEnabled);

    // Use LayersService if available, otherwise fall back to direct scene manipulation
    if (this.layersService) {
      await this.layersService.toggle('text', newEnabled);
    } else {
      const scene = this.scene;
      if (scene) {
        if (newEnabled) {
          await scene.createLayer('text');
          scene.setLayerVisible('text', true);
        } else {
          scene.setLayerVisible('text', false);
        }
        scene.setTextEnabled(newEnabled);
      }
    }

    this.appService?.updateUrl();
    m.redraw();
  },

  handleFullscreenToggle() {
    if (this.appService) {
      this.appService.handleFullscreenToggle();
    }
    m.redraw();
  },

  handleTextSizeChange(action: 'increase' | 'decrease' | 'reset') {
    const scene = this.scene;
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
    const scene = this.scene;
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
    const range = this.configService!.getDatasetRange('temp2m');
    return range || { startTime: new Date(), endTime: new Date() };
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

    // Show bootstrap modal during loading
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

      m(LayersPanel as any, {
        layerStates: this.getLayerStates(),
        textEnabled: state.textEnabled,
        onLayerToggle: (id: LayerId) => this.handleLayerToggle(id),
        onTextToggle: () => this.handleTextToggle(),
        blend: state.blend,
        onBlendChange: (newBlend: number) => {
          this.stateService!.setBlend(newBlend);
          this.scene?.setBasemapBlend(newBlend);
        },
        downloadService: this.downloadService || undefined
      }),

      m(TimeCirclePanel, {
        currentTime: state.currentTime
      }),

      m(TimeBarPanel, {
        currentTime: state.currentTime,
        startTime: state.sliderStartTime,
        endTime: state.sliderEndTime,
        onTimeChange: (time) => this.handleTimeChange(time),
        dateTimeService: this.dateTimeService!,
        configService: this.configService!
      }),

      m(PerformancePanel, {
        onElementCreated: (el) => state.scene?.setPerformanceElement(el)
      })
    ]);
  }
};
