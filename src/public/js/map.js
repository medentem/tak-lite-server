/**
 * Map functionality for TAK Lite Admin Dashboard
 * Main orchestrator class for map display, annotation management, and user interactions
 */

// Import utilities
import { logger } from './utils/logger.js';
import { get, post, put, del } from './utils/api.js';
import { getToken } from './utils/storage.js';
import { q } from './utils/dom.js';

// Import geographic utilities
import {
  extractCoordinates,
  haversineDistance,
  calculateDistance,
  toRadians,
  toDegrees,
  generateCirclePolygon,
  pixelsToMeters as pixelsToMetersUtil,
  calculateLineLength,
  calculateCircleArea,
  calculatePolygonArea,
  isValidCoordinate
} from './utils/geography.js';

// Import formatting utilities
import {
  formatDistance,
  formatArea,
  formatAge,
  capitalizeFirst,
  escapeHtml,
  getStatusDescription
} from './utils/formatting.js';

// Import configuration
import {
  INTERACTION_CONFIG,
  DISPLAY_CONFIG,
  POI_CONFIG,
  COLORS,
  getColorHex,
  API_ENDPOINTS,
  LAYER_CONFIG,
  TIMING,
  DATA_LIMITS
} from './config/mapConfig.js';
import { websocketService } from './services/websocket.js';

// Import map components
import {
  MapInitializer,
  AnnotationManager,
  PoiDrawingTool,
  LineDrawingTool,
  AreaDrawingTool,
  FanMenu,
  ColorMenu,
  ShapeMenu,
  MenuManager,
  PopupManager,
  TimerPillOverlay,
  FeedbackDisplay,
  MapStateManager,
  EventBus,
  MAP_EVENTS,
  LongPressHandler,
  LocationManager,
  TeamManager,
  MapWebSocketManager,
  MapDataLoader,
  LayerManager,
  IconManager,
  MapBoundsManager,
  ThreatManager,
  MessageManager
} from './map/index.js';

class AdminMap {
  constructor() {
    logger.debug('AdminMap constructor called');
    this.map = null;
    
    // Initialize state management and event system
    this.state = new MapStateManager();
    this.eventBus = new EventBus();
    
    // Initialize components (will be fully initialized after map is created)
    this.mapInitializer = new MapInitializer();
    this.dataLoader = null; // Will be initialized after map is created
    this.annotationManager = null; // Will be initialized after map is created
    this.locationManager = null; // Will be initialized after map is created
    this.teamManager = null; // Will be initialized after map is created
    this.threatManager = null; // Will be initialized after map is created
    this.messageManager = null; // Will be initialized after map is created
    this.webSocketManager = null; // Will be initialized after map is created
    this.menuManager = new MenuManager();
    this.feedbackDisplay = new FeedbackDisplay();
    this.popupManager = null; // Will be initialized after map is created
    this.timerPillOverlay = null; // Timer pills for expiring annotations (matches Android)
    this.fanMenu = null; // Will be initialized after map is created
    this.colorMenu = null; // Will be initialized after map is created
    this.shapeMenu = null; // Will be initialized after map is created
    this.longPressHandler = null; // Will be initialized after map is created
    this.expirationTickInterval = null; // 1s tick to refresh expiring annotation visuals
    this._pendingMapDataRefreshTimeout = null; // debounce fallback refresh after annotation_update
    
    // Drawing tools
    this.poiDrawingTool = null;
    this.lineDrawingTool = null;
    this.areaDrawingTool = null;

    // Geographical monitors overlay
    this.geographicalMonitors = [];
    this.monitorAreasLoaded = false;
    this.showMonitorsWrapperEl = null;
    
    // Setup event listeners
    this.setupEventListeners();
    
    logger.debug('Calling init() method...');
    this.init();
  }
  
  /**
   * Setup event listeners for state changes and events
   */
  setupEventListeners() {
    // Listen to state changes
    this.state.subscribe('showAnnotations', (value) => {
      this.updateLayerVisibility();
    });
    
    this.state.subscribe('showLocations', (value) => {
      this.updateLayerVisibility();
    });
    
    this.state.subscribe('currentTeamId', (value) => {
      this.loadMapData();
    });
    
    // Listen to event bus events
    this.eventBus.on(MAP_EVENTS.DRAWING_FINISHED, (data) => {
      this.handleDrawingFinish(data);
    });
    
    this.eventBus.on(MAP_EVENTS.DRAWING_CANCELLED, () => {
      this.handleDrawingCancel();
    });
    
    this.eventBus.on(MAP_EVENTS.FAN_MENU_OPENED, (data) => {
      logger.debug('Fan menu opened via event bus');
    });
    
    this.eventBus.on(MAP_EVENTS.COLOR_MENU_OPENED, (data) => {
      logger.debug('Color menu opened via event bus');
    });

    // Command palette: create POI/area/line at map center
    document.addEventListener('command-palette:create-annotation', (e) => {
      const type = e.detail?.type;
      if (type && ['poi', 'area', 'line'].includes(type)) {
        this.startCreateAnnotationAtCenter(type);
      }
    });
  }

  /**
   * Start create annotation flow at map center (from command palette).
   * @param {string} type - 'poi' | 'area' | 'line'
   */
  startCreateAnnotationAtCenter(type) {
    if (!this.map || !this.colorMenu) return;
    const center = this.map.getCenter();
    const point = this.map.project(center);
    this.state.setPendingAnnotation({ lng: center.lng, lat: center.lat });
    this.state.setCurrentShape(type === 'poi' ? 'circle' : type);
    this.showColorMenu(point, type === 'poi' ? 'poi' : type);
    this.showFeedback(`Choose a color for your ${type === 'poi' ? 'POI' : type}`, 3000);
  }
  
  async init() {
    logger.debug('AdminMap init() method called');
    // Wait for MapLibre to load
    if (typeof maplibregl === 'undefined') {
      logger.debug('MapLibre not ready, retrying...');
      setTimeout(() => this.init(), TIMING.libraryCheckInterval);
      return;
    }
    
    logger.info('Initializing admin map...');
    await this.initializeMap();
    this.setupDOMEventListeners();
    
    // Resize once after init: dashboard may have been hidden at creation (0x0), or pageChanged
    // may have fired before this listener was attached; ensure map gets correct dimensions.
    if (this.map) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.map.resize();
        });
      });
    }
    
    // Only load data if we have authentication
    if (this.isAuthenticated()) {
      logger.info('User is authenticated, loading data...');
      await this.loadTeams();
      await this.loadMapData();
    } else {
      logger.debug('Not authenticated yet, waiting for login...');
      // Wait for authentication
      this.waitForAuthentication();
    }
  }
  
  isAuthenticated() {
    const token = getToken();
    return token && token.length > 0;
  }
  
  async waitForAuthentication() {
    // Check every 500ms for authentication
    const checkAuth = () => {
      if (this.isAuthenticated()) {
        logger.info('Authentication detected, loading map data...');
        this.loadTeams().then(() => this.loadMapData());
      } else {
        setTimeout(checkAuth, TIMING.authCheckInterval);
      }
    };
    checkAuth();
  }
  
  async loadTeams() {
    if (!this.teamManager) return;
    await this.teamManager.loadTeams();
    this.state.setTeams(this.teamManager.getTeams());
  }
  
  async initializeMap() {
    try {
      // Use MapInitializer to create map
      this.map = await this.mapInitializer.initialize();
      
    // Initialize data loader (creates managers internally)
    this.dataLoader = new MapDataLoader(this.map, this.eventBus, this.state);
    this.annotationManager = this.dataLoader.getAnnotationManager();
    this.locationManager = this.dataLoader.getLocationManager();
    this.teamManager = this.dataLoader.getTeamManager();
    
    // Initialize threat and message managers
    this.threatManager = new ThreatManager(this.map, this.eventBus);
    this.messageManager = new MessageManager(this.map, this.eventBus);
    
    // Initialize layer and rendering managers
    this.layerManager = new LayerManager(this.map);
    this.iconManager = new IconManager(this.map);
    this.boundsManager = new MapBoundsManager(this.map);
    
    // Initialize WebSocket manager
    this.webSocketManager = new MapWebSocketManager(this.eventBus, () => {
      this.loadMapData({ skipAutoCenter: true });
    });
    this.webSocketManager.setupGlobalListeners();
      
      // Initialize UI components
      this.popupManager = new PopupManager(this.map, this.annotationManager.getAnnotations());
      this.timerPillOverlay = new TimerPillOverlay(this.map, 'map_container');
      this.timerPillOverlay.attach();
      this.fanMenu = new FanMenu('fan_menu', this.map, this.menuManager);
      this.colorMenu = new ColorMenu('color_menu', this.menuManager);
      this.shapeMenu = new ShapeMenu('shape_menu', this.menuManager);
      
      // Initialize long press handler
      this.longPressHandler = new LongPressHandler(this.map, {
        onLongPress: (e) => {
          this.state.setIsLongPressing(true);

          // Check for existing annotation at long press location (include polygon fill and stroke so long-press inside or on edge shows edit menu)
          const layers = [
            LAYER_CONFIG.annotationLayers.poi,
            LAYER_CONFIG.annotationLayers.line,
            LAYER_CONFIG.annotationLayers.area,
            LAYER_CONFIG.annotationLayers.polygon,
            LAYER_CONFIG.annotationLayers.polygonStroke
          ];
          
          const features = this.map.queryRenderedFeatures(e.point, {
            layers: layers
          });
          
          if (features.length > 0) {
            // Show edit menu for existing annotation
            const feature = features[0];
            this.showEditFanMenu(feature, e.point);
          } else {
            // Show create menu for new annotation
            this.showFanMenu(e.point);
          }
          
          this.eventBus.emit(MAP_EVENTS.LONG_PRESS_STARTED, { point: e.point });
        },
        onCancel: () => {
          this.state.setIsLongPressing(false);
          this.eventBus.emit(MAP_EVENTS.LONG_PRESS_CANCELLED);
        }
      });
      
      // Initialize drawing tools
      this.poiDrawingTool = new PoiDrawingTool(this.map);
      this.lineDrawingTool = new LineDrawingTool(this.map, {
        onFinish: (annotationData) => {
          this.eventBus.emit(MAP_EVENTS.DRAWING_FINISHED, annotationData);
        },
        onCancel: () => {
          this.eventBus.emit(MAP_EVENTS.DRAWING_CANCELLED);
        }
      });
      this.areaDrawingTool = new AreaDrawingTool(this.map, {
        onFinish: (annotationData) => {
          this.eventBus.emit(MAP_EVENTS.DRAWING_FINISHED, annotationData);
        },
        onCancel: () => {
          this.eventBus.emit(MAP_EVENTS.DRAWING_CANCELLED);
        }
      });
      
      // Setup WebSocket event handlers
      this.setupWebSocketEventHandlers();
      
      // Wait for map to load
      this.map.on('load', async () => {
        this.setupMapSources();
        this.initializeAnnotationUI();
        this.setupMapInteractionHandlers();
        this.setupMapMovementHandlers();
        
        // Initialize threat and message visualization
        if (this.threatManager) {
          await this.threatManager.init();
        }
        if (this.messageManager) {
          await this.messageManager.init();
        }
        
        // Setup threat selection handler
        this.eventBus.on('threat:selected', (data) => {
          this.handleThreatSelection(data);
        });
        
        this.eventBus.emit(MAP_EVENTS.MAP_LOADED);
      });
      
    } catch (error) {
      logger.error('Failed to initialize map:', error);
    }
  }
  
  /**
   * Ensure map WebSocket listeners are connected. Call when dashboard is shown so we receive
   * client->server annotation updates even if the socket connected before the map was created.
   */
  ensureMapWebSocketConnected() {
    if (this.webSocketManager && window.socket && window.socket.connected && !this.webSocketManager.getIsConnected()) {
      this.webSocketManager.connect();
    }
  }

  /**
   * Setup WebSocket event handlers via EventBus and global websocket service.
   * We listen to both: MapWebSocketManager (window.socket) and websocketService.
   * The service connects first and always has the socket, so client->server annotation
   * updates are received even if the map's MapWebSocketManager.connect() ran late.
   */
  setupWebSocketEventHandlers() {
    const onAnnotationUpdate = (data) => {
      this.handleAnnotationUpdate(data);
      // Fallback: one refetch after a short delay so new annotations appear even if the
      // in-memory update or paint path fails (debounced so we don't refetch multiple times).
      if (typeof this.loadMapData !== 'function') return;
      if (this._pendingMapDataRefreshTimeout) clearTimeout(this._pendingMapDataRefreshTimeout);
      this._pendingMapDataRefreshTimeout = setTimeout(() => {
        this._pendingMapDataRefreshTimeout = null;
        this.loadMapData({ skipAutoCenter: true });
      }, 400);
    };

    // EventBus (MapWebSocketManager forwards admin:* to these)
    this.eventBus.on(MAP_EVENTS.ANNOTATION_UPDATED, onAnnotationUpdate);
    this.eventBus.on(MAP_EVENTS.ANNOTATION_DELETED, (data) => this.handleAnnotationDelete(data));
    this.eventBus.on(MAP_EVENTS.ANNOTATION_BULK_DELETED, (data) => this.handleBulkAnnotationDelete(data));
    this.eventBus.on(MAP_EVENTS.LOCATION_UPDATED, (data) => this.handleLocationUpdate(data));

    // Global websocket service – same events, so we receive them when the service
    // already has the socket (connects before map exists or regardless of map listener).
    const onDelete = (data) => this.handleAnnotationDelete(data);
    const onBulkDelete = (data) => this.handleBulkAnnotationDelete(data);
    const onLocation = (data) => this.handleLocationUpdate(data);
    websocketService.on('annotation_update', onAnnotationUpdate);
    websocketService.on('annotation_delete', onDelete);
    websocketService.on('annotation_bulk_delete', onBulkDelete);
    websocketService.on('location_update', onLocation);
    this._wsAnnotationHandlers = { annotation_update: onAnnotationUpdate, annotation_delete: onDelete, annotation_bulk_delete: onBulkDelete, location_update: onLocation };
  }
  
  /**
   * Handle drawing tool finish
   */
  async handleDrawingFinish(annotationData) {
    if (!annotationData) return;

    annotationData.teamId = this.state.getCurrentTeamId();
    try {
      await this.annotationManager.createAnnotation(annotationData);
      const message = annotationData.type === 'polygon' ? 'Polygon created' : 'Annotation created successfully';
      this.feedbackDisplay.show(message, 2000);
      this.updateMapData();
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_CREATED, annotationData);
    } catch (error) {
      this.feedbackDisplay.show(`Failed to create annotation: ${error.message || 'Unknown error'}`, 5000);
    }
    this.state.setCurrentDrawingTool(null);
  }
  
  /**
   * Handle drawing tool cancel
   */
  handleDrawingCancel() {
    this.feedbackDisplay.show('Drawing cancelled', 2000);
    this.state.setCurrentDrawingTool(null);
  }
  
  initializeAnnotationUI() {
    logger.debug('Initializing annotation UI...');
    
    // Get references to UI elements
    this.editForm = q('#annotation_edit_form');
    this.modalOverlay = q('#modal_overlay');
    
    logger.debug('Annotation UI elements found:');
    logger.debug('editForm:', this.editForm);
    logger.debug('modalOverlay:', this.modalOverlay);
    
    // Setup form event listeners
    this.setupFormEventListeners();
  }
  
  setupFormEventListeners() {
    // Edit form event listeners
    const editForm = document.getElementById('edit_annotation_form');
    const editCancel = document.getElementById('edit_cancel');
    const editDelete = document.getElementById('edit_delete');
    const editSave = document.getElementById('edit_save');
    
    if (editForm) {
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveAnnotationEdit();
      });
    }
    
    if (editCancel) {
      editCancel.addEventListener('click', () => {
        this.hideEditForm();
      });
    }
    
    if (editDelete) {
      editDelete.addEventListener('click', () => {
        this.deleteCurrentAnnotation();
      });
    }
    
    if (editSave) {
      editSave.addEventListener('click', (e) => {
        e.preventDefault();
        this.saveAnnotationEdit();
      });
    }
    
    // Modal overlay click to close
    if (this.modalOverlay) {
      this.modalOverlay.addEventListener('click', () => {
        this.hideEditForm();
      });
    }
  }
  
  setupMapSources() {
    // Check if map style is loaded before adding sources
    if (!this.map.isStyleLoaded()) {
      logger.debug('Map style not loaded yet, waiting...');
      this.map.once('styledata', () => {
        this.setupMapSources();
      });
      return;
    }
    
    if (!this.layerManager || !this.iconManager) {
      logger.error('LayerManager or IconManager not initialized');
      return;
    }
    
    // Generate Canvas-based POI icons for all shape-color combinations
    this.iconManager.generateAllIcons();
    
    // Setup sources
    this.layerManager.setupSources();
    
    // Add all layers
    this.layerManager.addAllLayers();
    
    // Add click handlers
    this.setupClickHandlers();
  }
  
  setupClickHandlers() {
    logger.debug('Setting up click handlers...');
    
    const layers = LAYER_CONFIG.annotationLayers;
    
    // Dismiss fan menu when user clicks anywhere on the map (canvas clicks may not bubble to document)
    this.map.on('click', () => {
      if (!this.fanMenu?.getElement()?.classList.contains('visible')) return;
      // Don't dismiss on the click that is the mouse release after long-press
      if (this.fanMenuOpenedAt && (Date.now() - this.fanMenuOpenedAt) < (TIMING.fanMenuOpenGraceMs ?? 400)) return;
      this.hideFanMenu();
    });
    
    // POI click handler (symbol layer) - single click for popup
    this.map.on('click', layers.poi, (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Line click handler
    this.map.on('click', layers.line, (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Area click handler
    this.map.on('click', layers.area, (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Polygon click handler
    this.map.on('click', layers.polygon, (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Location click handler
    this.map.on('click', LAYER_CONFIG.locationLayer, (e) => {
      const feature = e.features[0];
      this.showLocationPopup(feature, e.lngLat);
    });
    
    // Change cursor on hover for all layers
    const layerIds = [
      LAYER_CONFIG.annotationLayers.poi,
      LAYER_CONFIG.annotationLayers.line,
      LAYER_CONFIG.annotationLayers.area,
      LAYER_CONFIG.annotationLayers.polygon,
      LAYER_CONFIG.locationLayer
    ];
    layerIds.forEach(layerId => {
      this.map.on('mouseenter', layerId, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', layerId, () => {
        this.map.getCanvas().style.cursor = '';
      });
    });
  }
  
  setupMapInteractionHandlers() {
    logger.debug('Setting up map interaction handlers...');
    
    if (!this.map || !this.longPressHandler) {
      logger.error('Map or LongPressHandler not initialized, cannot setup interaction handlers');
      return;
    }
    
    // Start long press handler
    this.longPressHandler.start();
    
    logger.debug('Map interaction handlers setup complete');
  }
  
  setupMapMovementHandlers() {
    logger.debug('Setting up map movement handlers...');
    
    if (!this.map) {
      logger.error('Map not initialized, cannot setup movement handlers');
      return;
    }
    
    // Dismiss menus when map is moved (pan, zoom, etc.)
    const dismissMenus = () => {
      if (this.fanMenu) this.fanMenu.hide();
      if (this.colorMenu) this.colorMenu.hide();
    };
    
    this.map.on('move', () => {
      logger.debug('Map moved, dismissing menus');
      dismissMenus();
    });
    
    this.map.on('zoom', () => {
      logger.debug('Map zoomed, dismissing menus');
      dismissMenus();
    });
    
    this.map.on('rotate', () => {
      logger.debug('Map rotated, dismissing menus');
      dismissMenus();
    });
    
    this.map.on('pitch', () => {
      logger.debug('Map pitch changed, dismissing menus');
      dismissMenus();
    });
    
    logger.debug('Map movement handlers setup complete');
  }
  
  
  showFeedback(message, duration = 3000) {
    this.feedbackDisplay.show(message, duration);
  }
  
  showFanMenu(point, isEditMode = false) {
    logger.debug('showFanMenu called with point:', point, 'isEditMode:', isEditMode);
    logger.debug('fanMenu element:', this.fanMenu);
    
    if (!this.fanMenu) {
      logger.error('fanMenu element not found! Attempting to re-initialize...');
      this.initializeAnnotationUI();
      
      if (!this.fanMenu) {
        logger.error('fanMenu element still not found after re-initialization!');
        return;
      }
    }
    
    // Get the DOM element from the FanMenu instance
    const fanMenuElement = this.fanMenu.getElement();
    if (!fanMenuElement) {
      logger.error('fanMenu DOM element not found!');
      return;
    }
    
    // Clear existing segments but keep center hole
    const centerHole = fanMenuElement.querySelector('.fan-menu-center');
    const existingSegments = fanMenuElement.querySelector('.fan-menu-segments-container');
    
    fanMenuElement.innerHTML = '';
    if (centerHole) {
      fanMenuElement.appendChild(centerHole);
    }
    if (existingSegments) {
      existingSegments.remove();
    }
    
    // Get map coordinates for center text
    const lngLat = this.map.unproject(point);
    this.state.setPendingAnnotation(lngLat);
    
    // Update center text with coordinates
    this.updateFanMenuCenterText(lngLat);
    
    // Define options based on mode
    const options = isEditMode ? this.getEditModeOptions() : this.getCreateModeOptions();
    
    // Position fan menu at click point relative to map container
    fanMenuElement.style.left = (point.x - 100) + 'px'; // Center the donut ring (200px diameter)
    fanMenuElement.style.top = (point.y - 100) + 'px';
    fanMenuElement.style.position = 'absolute';
    
    // Create donut ring segments
    this.createDonutRingSegments(options, point);
    
    // Show fan menu
    fanMenuElement.classList.add('visible');
    this.fanMenuOpenedAt = Date.now();
    logger.debug('Fan menu made visible with', options.length, 'options');
    this.setupFanMenuDismiss();
  }
  
  getCreateModeOptions() {
    return [
      { type: 'circle', iconClass: 'shape-circle', label: 'Circle' },
      { type: 'square', iconClass: 'shape-square', label: 'Square' },
      { type: 'triangle', iconClass: 'shape-triangle', label: 'Triangle' },
      { type: 'exclamation', iconClass: 'shape-exclamation', label: 'Exclamation' },
      { type: 'area', iconClass: 'area', label: 'Area' },
      { type: 'line', iconClass: 'line', label: 'Line' }
    ];
  }
  
  getEditModeOptions(annotationType, annotation = null) {
    let data = null;
    if (annotation?.data) {
      data = typeof annotation.data === 'string' ? (() => { try { return JSON.parse(annotation.data); } catch { return {}; } })() : annotation.data;
    }
    const options = [
      { type: 'edit-label', iconClass: 'edit', label: 'Edit Label' },
      { type: 'edit-note', iconClass: 'note', label: 'Add Note' }
    ];
    
    // Add color option: segment fill shows current annotation color
    const currentColorHex = getColorHex(data?.color || 'green');
    options.push({ type: 'change-color', iconClass: 'color', label: 'Color', segmentFillColor: currentColorHex });
    
    // Add shape option only for POIs; icon shows current shape
    if (annotationType === 'poi') {
      const currentShape = data?.shape || 'circle';
      options.push({ type: 'change-shape', iconClass: `shape-${currentShape}`, label: 'Shape' });
    }
    
    // Add expiration (timer) option
    options.push({ type: 'set-expiration', iconClass: 'timer', label: 'Timer' });
    
    // Add delete option
    options.push({ type: 'delete', iconClass: 'delete', label: 'Delete' });
    
    return options;
  }
  
  showEditFanMenu(feature, point) {
    logger.debug('showEditFanMenu called with feature:', feature, 'point:', point);
    
    if (!this.fanMenu) {
      logger.error('fanMenu element not found!');
      return;
    }
    
    const fanMenuElement = this.fanMenu.getElement();
    if (!fanMenuElement) {
      logger.error('fanMenu DOM element not found!');
      return;
    }
    
    // Get annotation from feature
    const annotationId = feature.properties.id;
    const annotation = this.annotationManager.findAnnotation(annotationId);
    
    if (!annotation) {
      logger.error('[FANMENU] Annotation not found:', annotationId);
      this.showFeedback('Annotation not found', 3000);
      return;
    }
    
    logger.debug('[FANMENU] Found annotation for edit menu', {
      id: annotation.id,
      type: annotation.type,
      hasData: !!annotation.data,
      dataType: typeof annotation.data,
      dataKeys: annotation.data ? (typeof annotation.data === 'string' ? 'string' : Object.keys(annotation.data)) : []
    });
    
    // Store current editing annotation
    this.state.setCurrentEditingAnnotation(annotation);
    
    // Clear existing segments
    const centerHole = fanMenuElement.querySelector('.fan-menu-center');
    const existingSegments = fanMenuElement.querySelector('.fan-menu-segments-container');
    
    fanMenuElement.innerHTML = '';
    if (centerHole) {
      fanMenuElement.appendChild(centerHole);
    }
    if (existingSegments) {
      existingSegments.remove();
    }
    
    // Get map coordinates for center text
    const lngLat = this.map.unproject(point);
    
    // Update center text with annotation info
    this.updateEditFanMenuCenterText(annotation);
    
    // Define options based on annotation type and current annotation (for color/shape icons)
    const options = this.getEditModeOptions(annotation.type, annotation);
    
    // Position fan menu at click point relative to map container
    fanMenuElement.style.left = (point.x - 100) + 'px';
    fanMenuElement.style.top = (point.y - 100) + 'px';
    fanMenuElement.style.position = 'absolute';
    
    // Create donut ring segments
    this.createDonutRingSegments(options, point);
    
    // Show fan menu
    fanMenuElement.classList.add('visible');
    this.fanMenuOpenedAt = Date.now();
    logger.debug('Edit fan menu made visible with', options.length, 'options');
    this.setupFanMenuDismiss();
  }
  
  updateEditFanMenuCenterText(annotation) {
    const coordsEl = document.getElementById('fan_menu_coords');
    const distanceEl = document.getElementById('fan_menu_distance');
    
    if (!annotation) {
      logger.warn('[FANMENU] updateEditFanMenuCenterText called with null annotation');
      if (coordsEl) coordsEl.textContent = 'N/A';
      if (distanceEl) distanceEl.textContent = 'N/A';
      return;
    }
    
    // Parse data if it's a string
    let data = annotation.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        logger.warn('[FANMENU] Failed to parse annotation.data as JSON:', e);
        data = {};
      }
    }
    
    // Safely get annotation type
    const annotationType = annotation.type || data?.type || 'annotation';
    
    if (coordsEl) {
      let coords = '';
      try {
        if (annotationType === 'poi' && data?.position) {
          const lat = data.position.lt ?? data.position.lat ?? data.position.latitude;
          const lng = data.position.lng ?? data.position.longitude;
          if (typeof lat === 'number' && typeof lng === 'number') {
            coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          }
        } else if (annotationType === 'line' && data?.points && Array.isArray(data.points) && data.points.length > 0) {
          const firstPoint = data.points[0];
          const lat = firstPoint.lt ?? firstPoint.lat ?? firstPoint.latitude;
          const lng = firstPoint.lng ?? firstPoint.longitude;
          if (typeof lat === 'number' && typeof lng === 'number') {
            coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          }
        } else if (annotationType === 'area' && data?.center) {
          const lat = data.center.lt ?? data.center.lat ?? data.center.latitude;
          const lng = data.center.lng ?? data.center.longitude;
          if (typeof lat === 'number' && typeof lng === 'number') {
            coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          }
        } else if (annotationType === 'polygon' && data?.points && Array.isArray(data.points) && data.points.length > 0) {
          const firstPoint = data.points[0];
          const lat = firstPoint.lt ?? firstPoint.lat ?? firstPoint.latitude;
          const lng = firstPoint.lng ?? firstPoint.longitude;
          if (typeof lat === 'number' && typeof lng === 'number') {
            coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          }
        }
      } catch (e) {
        logger.warn('[FANMENU] Error extracting coordinates:', e);
      }
      coordsEl.textContent = coords || 'N/A';
    }
    
    if (distanceEl) {
      const label = (data && data.label) ? data.label : annotationType.toUpperCase();
      distanceEl.textContent = label.length > 15 ? label.substring(0, 15) + '...' : label;
    }
  }
  
  updateFanMenuCenterText(lngLat) {
    const coordsEl = document.getElementById('fan_menu_coords');
    const distanceEl = document.getElementById('fan_menu_distance');
    
    if (coordsEl) {
      coordsEl.textContent = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    }
    
    if (distanceEl) {
      // For now, just show a placeholder distance
      // In a real implementation, you'd calculate distance from user location
      distanceEl.textContent = '0.0 mi away';
    }
  }
  
  createDonutRingSegments(options, point) {
    const centerX = 100; // Center of 200px menu
    const centerY = 100;
    const innerRadius = 40; // Smaller center hole
    const outerRadius = 80; // Ring thickness
    const gapAngle = 4; // Degrees between segments

    const totalAngle = 360 - (options.length * gapAngle);
    const segmentAngle = totalAngle / options.length;

    // Create a single SVG container for all segments
    const svgContainer = document.createElement('div');
    svgContainer.className = 'fan-menu-segments-container';
    svgContainer.style.position = 'absolute';
    svgContainer.style.top = '0';
    svgContainer.style.left = '0';
    svgContainer.style.width = '200px';
    svgContainer.style.height = '200px';
    
    const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgElement.setAttribute('width', '200');
    svgElement.setAttribute('height', '200');
    svgElement.setAttribute('viewBox', '0 0 200 200');
    svgElement.style.position = 'absolute';
    svgElement.style.top = '0';
    svgElement.style.left = '0';
    
    svgContainer.appendChild(svgElement);
    
    // Create all paths and icons
    options.forEach((option, index) => {
      const startAngle = (index * (segmentAngle + gapAngle)) - 90; // Start from top
      const endAngle = startAngle + segmentAngle;
      
      // Create SVG path for donut segment
      const pathData = this.createDonutSegmentPath(centerX, centerY, innerRadius, outerRadius, startAngle, endAngle);
      
      // Calculate icon position within the segment
      const iconAngle = startAngle + (segmentAngle / 2); // Center of the segment
      const iconRadius = (innerRadius + outerRadius) / 2; // Middle of the donut ring
      const iconAngleRad = (iconAngle * Math.PI) / 180;
      const iconX = centerX + iconRadius * Math.cos(iconAngleRad);
      const iconY = centerY + iconRadius * Math.sin(iconAngleRad);
      
      logger.debug('Icon positioning:', {
        option: option.type,
        segmentIndex: index,
        startAngle, endAngle, segmentAngle,
        iconAngle, iconRadius,
        iconX, iconY
      });
      
      // Create path element
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', pathData);
      pathElement.setAttribute('data-option-type', option.type);
      pathElement.setAttribute('data-option-index', index.toString());
      const isColorSegment = option.segmentFillColor != null;
      pathElement.style.fill = isColorSegment ? option.segmentFillColor : 'rgba(0, 0, 0, 0.8)';
      pathElement.style.stroke = isColorSegment ? 'rgba(255, 255, 255, 0.9)' : 'white';
      pathElement.style.strokeWidth = '3';
      pathElement.style.transition = 'all 0.2s ease';
      pathElement.style.cursor = 'pointer';
      
      // Add click handler to path
      pathElement.addEventListener('click', (e) => {
        e.stopPropagation();
        logger.debug('Clicked on option:', option.type);
        this.handleFanMenuOption(option.type, point);
      });
      
      // Add hover handlers for proper hover effects
      pathElement.addEventListener('mouseenter', () => {
        logger.debug('Hovering over option:', option.type);
        if (isColorSegment) {
          pathElement.style.filter = 'brightness(1.2)';
          pathElement.style.stroke = 'white';
        } else {
          pathElement.style.fill = 'rgba(0, 0, 0, 0.9)';
          pathElement.style.stroke = 'rgba(255, 255, 255, 0.9)';
        }
      });
      
      pathElement.addEventListener('mouseleave', () => {
        if (isColorSegment) {
          pathElement.style.filter = '';
          pathElement.style.stroke = 'rgba(255, 255, 255, 0.9)';
        } else {
          pathElement.style.fill = 'rgba(0, 0, 0, 0.8)';
          pathElement.style.stroke = 'white';
        }
      });
      
      svgElement.appendChild(pathElement);
      
      // Create icon element (skip for color segment - the segment fill is the color indicator)
      if (option.type !== 'change-color') {
        const iconElement = document.createElement('div');
        iconElement.className = `fan-menu-segment-icon ${option.iconClass}`;
        iconElement.style.position = 'absolute';
        iconElement.style.left = `${iconX}px`;
        iconElement.style.top = `${iconY}px`;
        iconElement.style.transform = 'translate(-50%, -50%)';
        iconElement.style.pointerEvents = 'none';
        svgContainer.appendChild(iconElement);
      }
    });
    
    // Get the DOM element from the FanMenu instance
    const fanMenuElement = this.fanMenu.getElement();
    if (fanMenuElement) {
      fanMenuElement.appendChild(svgContainer);
    } else {
      logger.error('fanMenu DOM element not found in createDonutRingSegments!');
    }
  }
  
  createDonutSegmentPath(centerX, centerY, innerRadius, outerRadius, startAngle, endAngle) {
    const startAngleRad = (startAngle * Math.PI) / 180;
    const endAngleRad = (endAngle * Math.PI) / 180;
    
    // Calculate points on inner and outer circles
    const x1 = centerX + innerRadius * Math.cos(startAngleRad);
    const y1 = centerY + innerRadius * Math.sin(startAngleRad);
    const x2 = centerX + outerRadius * Math.cos(startAngleRad);
    const y2 = centerY + outerRadius * Math.sin(startAngleRad);
    const x3 = centerX + outerRadius * Math.cos(endAngleRad);
    const y3 = centerY + outerRadius * Math.sin(endAngleRad);
    const x4 = centerX + innerRadius * Math.cos(endAngleRad);
    const y4 = centerY + innerRadius * Math.sin(endAngleRad);
    
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
    
    // Create the donut segment path
    const path = `M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x1} ${y1} Z`;
    
    logger.debug('Donut segment path:', {
      centerX, centerY, innerRadius, outerRadius, startAngle, endAngle,
      path
    });
    
    return path;
  }
  
  hideFanMenu() {
    if (this.fanMenu) {
      const fanMenuElement = this.fanMenu.getElement();
      if (fanMenuElement) {
        fanMenuElement.classList.remove('visible');
        // Clear segments but keep center hole structure
        const centerHole = fanMenuElement.querySelector('.fan-menu-center');
        const segmentsContainer = fanMenuElement.querySelector('.fan-menu-segments-container');
        
        fanMenuElement.innerHTML = '';
        if (centerHole) {
          fanMenuElement.appendChild(centerHole);
        }
        if (segmentsContainer) {
          segmentsContainer.remove();
        }
      }
    }
    // Clean up dismiss event listener
    this.cleanupFanMenuDismiss();
  }
  
  setupFanMenuDismiss() {
    // Clean up any existing dismiss listener
    this.cleanupFanMenuDismiss();
    
    // Add click listener to document to dismiss fan menu when clicking outside
    this.fanMenuDismissHandler = (e) => {
      logger.debug('Fan menu dismiss handler triggered');
      logger.debug('Event _longPressHandled:', e._longPressHandled);
      logger.debug('longPressInProgress:', this.longPressInProgress);
      
      // Don't dismiss if this was a long press event
      if (e._longPressHandled) {
        logger.debug('Ignoring click dismissal due to long press event');
        return;
      }
      // Ignore the click that is the mouse release after long-press (browser fires click but it's a different event object)
      if (this.fanMenuOpenedAt && (Date.now() - this.fanMenuOpenedAt) < (TIMING.fanMenuOpenGraceMs ?? 400)) {
        logger.debug('Ignoring click dismissal: within grace period after fan menu opened');
        return;
      }
      
      // Check if click is outside the fan menu
      const fanMenuElement = this.fanMenu?.getElement();
      if (fanMenuElement && !fanMenuElement.contains(e.target)) {
        logger.debug('Clicking outside fan menu, dismissing');
        this.hideFanMenu();
      } else {
        logger.debug('Click was inside fan menu, not dismissing');
      }
    };
    
    // Use a small delay to prevent immediate dismissal from the click that opened the menu
    setTimeout(() => {
      document.addEventListener('click', this.fanMenuDismissHandler);
    }, 100);
  }
  
  cleanupFanMenuDismiss() {
    if (this.fanMenuDismissHandler) {
      document.removeEventListener('click', this.fanMenuDismissHandler);
      this.fanMenuDismissHandler = null;
    }
  }
  
  handleFanMenuOption(optionType, point) {
    this.hideFanMenu();
    
    if (['circle', 'square', 'triangle', 'exclamation'].includes(optionType)) {
      // Show color menu for POI shapes (two-step flow)
      this.state.setCurrentShape(optionType);
      this.showColorMenu(point, 'poi');
    } else if (optionType === 'area') {
      // Show color menu for area (two-step flow)
      this.state.setCurrentShape('area');
      this.showColorMenu(point, 'area');
    } else if (optionType === 'line') {
      // Show color menu for line (two-step flow)
      this.state.setCurrentShape('line');
      this.showColorMenu(point, 'line');
    } else if (optionType === 'edit-label') {
      // Handle edit label
      this.handleEditLabel();
    } else if (optionType === 'edit-note') {
      // Handle edit note
      this.handleEditNote();
    } else if (optionType === 'change-color') {
      // Handle change color
      this.handleChangeColor(point);
    } else if (optionType === 'change-shape') {
      // Handle change shape (POIs only)
      this.handleChangeShape(point);
    } else if (optionType === 'set-expiration') {
      this.handleSetExpiration();
    } else if (optionType === 'delete') {
      // Handle delete mode
      this.handleDeleteAnnotation();
    }
  }
  
  handleEditLabel() {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing) {
      this.showFeedback('No annotation selected', 3000);
      return;
    }
    
    const currentLabel = currentEditing.data.label || '';
    const newLabel = prompt('Enter new label:', currentLabel);
    
    if (newLabel !== null) {
      this.updateAnnotationField('label', newLabel);
    }
  }
  
  handleEditNote() {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing) {
      this.showFeedback('No annotation selected', 3000);
      return;
    }
    
    const currentNote = currentEditing.data.description || '';
    const newNote = prompt('Enter note/description:', currentNote);
    
    if (newNote !== null) {
      this.updateAnnotationField('description', newNote);
    }
  }
  
  handleChangeColor(point) {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing) {
      this.showFeedback('No annotation selected', 3000);
      return;
    }
    
    // Show color menu for editing
    if (!this.colorMenu) return;
    
    this.colorMenu.show(point, currentEditing.type, (color, annotationType) => {
      this.colorMenu.hide();
      this.updateAnnotationField('color', color);
    });
  }
  
  handleChangeShape(point) {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing || currentEditing.type !== 'poi') {
      this.showFeedback('Shape can only be changed for POIs', 3000);
      return;
    }
    
    if (!this.shapeMenu) return;
    
    this.shapeMenu.show(point, (shapeType) => {
      this.shapeMenu.hide();
      this.updateAnnotationField('shape', shapeType);
    });
  }
  
  handleSetExpiration() {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing) {
      this.showFeedback('No annotation selected', 3000);
      return;
    }
    let data = currentEditing.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        data = {};
      }
    }
    const expMs = data?.expirationTime;
    const now = Date.now();
    const currentStatus = expMs == null
      ? 'No expiration'
      : expMs <= now
        ? 'Expired'
        : `Expires in ${Math.round((expMs - now) / 60000)} min`;
    const currentMinutes = expMs != null && expMs > now
      ? String(Math.round((expMs - now) / 60000))
      : '';
    const modalId = 'expiration_prompt_modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Set expiration');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10001;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.className = 'annotation-edit-form';
    box.style.cssText = 'background:var(--surface, #1e293b);padding:1.25rem;border-radius:8px;min-width:280px;box-shadow:0 10px 40px rgba(0,0,0,0.4);';
    box.innerHTML = `
      <h3 style="margin:0 0 0.75rem 0;font-size:1rem;">Set expiration</h3>
      <p style="margin:0 0 0.5rem 0;font-size:0.85rem;color:var(--muted, #94a3b8);">${escapeHtml(currentStatus)}</p>
      <div class="form-group" style="margin-bottom:1rem;">
        <label for="expiration_minutes" style="display:block;margin-bottom:0.25rem;font-size:0.875rem;">Expiration (minutes)</label>
        <input type="number" id="expiration_minutes" min="1" step="1" placeholder="e.g. 5" value="${escapeHtml(currentMinutes)}" style="width:100%;padding:0.5rem;border-radius:4px;border:1px solid var(--border, #334155);background:var(--input-bg, #0f172a);color:inherit;box-sizing:border-box;">
        <span style="font-size:0.75rem;color:var(--muted, #94a3b8);">Leave empty for no expiration</span>
      </div>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
        <button type="button" id="expiration_clear" class="btn-secondary">Clear</button>
        <button type="button" id="expiration_cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="expiration_set" class="btn-primary">Set</button>
      </div>
    `;
    overlay.appendChild(box);
    const close = () => {
      overlay.remove();
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    box.querySelector('#expiration_cancel').addEventListener('click', close);
    box.querySelector('#expiration_clear').addEventListener('click', async () => {
      try {
        await this.updateAnnotationField('expirationTime', null);
        this.showFeedback('Expiration cleared', 2000);
        close();
      } catch (err) {
        this.showFeedback(`Failed to clear expiration: ${err.message}`, 5000);
      }
    });
    box.querySelector('#expiration_set').addEventListener('click', async () => {
      const input = box.querySelector('#expiration_minutes');
      const raw = input.value.trim();
      const minutes = raw === '' ? null : parseInt(raw, 10);
      if (minutes != null && (Number.isNaN(minutes) || minutes < 1)) {
        this.showFeedback('Enter a valid number of minutes (1 or more)', 3000);
        return;
      }
      const value = minutes == null ? null : now + minutes * 60 * 1000;
      try {
        await this.updateAnnotationField('expirationTime', value);
        this.showFeedback(minutes == null ? 'Expiration cleared' : `Expiration set to ${minutes} min`, 2000);
        close();
      } catch (err) {
        this.showFeedback(`Failed to set expiration: ${err.message}`, 5000);
      }
    });
    document.body.appendChild(overlay);
    box.querySelector('#expiration_minutes').focus();
  }
  
  async updateAnnotationField(field, value) {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing || !this.annotationManager) {
      this.showFeedback('No annotation selected', 3000);
      return;
    }
    
    try {
      const updateData = { [field]: value };
      await this.annotationManager.updateAnnotation(currentEditing.id, updateData);
      this.showFeedback(`Annotation ${field} updated successfully`, 2000);
      this.updateMapData();
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_UPDATED, { id: currentEditing.id, ...updateData });
    } catch (error) {
      logger.error('Failed to update annotation:', error);
      this.showFeedback(`Failed to update annotation: ${error.message || 'Unknown error'}`, 5000);
    }
  }
  
  handleDeleteAnnotation() {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing) {
      this.showFeedback('No annotation selected', 3000);
      return;
    }
    
    if (confirm('Are you sure you want to delete this annotation?')) {
      this.deleteAnnotationById(currentEditing.id);
    }
  }
  
  showColorMenu(point, annotationType) {
    if (!this.colorMenu) return;
    
    this.colorMenu.show(point, annotationType, (color, annotationType) => {
      this.handleColorSelection(color, annotationType);
    });
    
    this.eventBus.emit(MAP_EVENTS.COLOR_MENU_OPENED, { point, annotationType });
  }
  
  hideColorMenu() {
    if (this.colorMenu) {
      this.colorMenu.hide();
    }
  }

  hideShapeMenu() {
    if (this.shapeMenu) {
      this.shapeMenu.hide();
    }
  }
  
  handleColorSelection(color, annotationType) {
    if (this.colorMenu) {
      this.colorMenu.hide();
      this.eventBus.emit(MAP_EVENTS.COLOR_MENU_CLOSED);
    }
    this.state.setCurrentColor(color);
    
    if (annotationType === 'poi') {
      this.createPOI();
    } else if (annotationType === 'area') {
      this.startAreaDrawing();
    } else if (annotationType === 'line') {
      this.startLineDrawing();
    }
  }
  
  createPOI() {
    const pendingAnnotation = this.state.getPendingAnnotation();
    if (!pendingAnnotation) {
      this.showFeedback('No location selected', 3000);
      return;
    }
    
    if (!this.poiDrawingTool) return;
    
    const annotationData = this.poiDrawingTool.createPOI(
      pendingAnnotation,
      this.state.getCurrentColor(),
      this.state.getCurrentShape()
    );
    
    annotationData.teamId = this.state.getCurrentTeamId();
    this.createAnnotation(annotationData);
    this.state.setPendingAnnotation(null);
  }
  
  showAnnotationContextMenu(feature, lngLat, point) {
    // Close any existing popups first
    this.closeAllPopups();
    
    // Create context menu
    const contextMenu = document.createElement('div');
    contextMenu.className = 'fan-menu visible';
    contextMenu.style.left = point.x + 'px';
    contextMenu.style.top = point.y + 'px';
    contextMenu.style.zIndex = '1001';
    
    // Create edit and delete options
    const editOption = document.createElement('div');
    editOption.className = 'fan-menu-option edit';
    editOption.innerHTML = '<span class="icon">✏️</span>';
    editOption.style.left = '-40px';
    editOption.style.top = '0px';
    
    const deleteOption = document.createElement('div');
    deleteOption.className = 'fan-menu-option delete';
    deleteOption.innerHTML = '<span class="icon">🗑️</span>';
    deleteOption.style.left = '40px';
    deleteOption.style.top = '0px';
    
    editOption.addEventListener('click', (e) => {
      e.stopPropagation();
      this.editAnnotation(feature);
      contextMenu.remove();
    });
    
    deleteOption.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteAnnotation(feature);
      contextMenu.remove();
    });
    
    contextMenu.appendChild(editOption);
    contextMenu.appendChild(deleteOption);
    
    // Add to map container
    const mapContainer = document.getElementById('map_container');
    mapContainer.appendChild(contextMenu);
    
    // Remove context menu when clicking elsewhere
    const removeContextMenu = (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.remove();
        document.removeEventListener('click', removeContextMenu);
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', removeContextMenu);
    }, 100);
  }
  
  editAnnotation(feature) {
    if (!this.annotationManager) return;
    const annotationId = feature.properties.id;
    const annotation = this.annotationManager.findAnnotation(annotationId);
    
    if (!annotation) {
      this.showFeedback('Annotation not found', 3000);
      return;
    }
    
    this.state.setCurrentEditingAnnotation(annotation);
    this.showEditForm(annotation);
    this.eventBus.emit(MAP_EVENTS.EDIT_FORM_OPENED, annotation);
  }
  
  showEditForm(annotation) {
    if (!this.editForm || !this.modalOverlay) return;
    
    // Populate form with annotation data
    const data = annotation.data;
    
    q('#edit_label').value = data.label || '';
    q('#edit_color').value = data.color || 'green';
    
    // Show/hide relevant fields based on annotation type
    const shapeGroup = q('#edit_shape_group');
    const radiusGroup = q('#edit_radius_group');
    
    if (annotation.type === 'poi') {
      if (shapeGroup) shapeGroup.style.display = 'block';
      const editShape = q('#edit_shape');
      if (editShape) editShape.value = data.shape || 'circle';
      if (radiusGroup) radiusGroup.style.display = 'none';
    } else if (annotation.type === 'area') {
      if (shapeGroup) shapeGroup.style.display = 'none';
      if (radiusGroup) radiusGroup.style.display = 'block';
      const editRadius = q('#edit_radius');
      if (editRadius) editRadius.value = data.radius || 100;
    } else {
      if (shapeGroup) shapeGroup.style.display = 'none';
      if (radiusGroup) radiusGroup.style.display = 'none';
    }
    
    // Update form title
    const editFormTitle = q('#edit_form_title');
    if (editFormTitle) {
      editFormTitle.textContent = `Edit ${annotation.type.toUpperCase()} Annotation`;
    }
    
    // Show form and overlay
    this.modalOverlay.classList.add('visible');
    this.editForm.style.display = 'block';
  }
  
  hideEditForm() {
    if (this.editForm) {
      this.editForm.style.display = 'none';
    }
    if (this.modalOverlay) {
      this.modalOverlay.classList.remove('visible');
    }
    this.state.setCurrentEditingAnnotation(null);
    this.eventBus.emit(MAP_EVENTS.EDIT_FORM_CLOSED);
  }
  
  async saveAnnotationEdit() {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing) {
      logger.warn('[EDIT] No annotation currently being edited');
      return;
    }
    
    logger.debug('[EDIT] Starting annotation edit save', {
      annotationId: currentEditing.id,
      type: currentEditing.type,
      currentData: currentEditing.data
    });
    
    const editForm = q('#edit_annotation_form');
    if (!editForm) {
      logger.warn('[EDIT] Edit form not found');
      return;
    }
    const formData = new FormData(editForm);
    const updateData = {
      label: formData.get('label') || '',
      color: formData.get('color') || 'green'
    };
    
    // Add type-specific fields
    if (currentEditing.type === 'poi') {
      updateData.shape = formData.get('shape') || 'circle';
    } else if (currentEditing.type === 'area') {
      updateData.radius = parseFloat(formData.get('radius')) || 100;
    }
    
    logger.debug('[EDIT] Update data to send', {
      updateData,
      originalDataKeys: Object.keys(currentEditing.data || {}),
      originalData: currentEditing.data
    });
    
    if (!this.annotationManager) {
      logger.error('[EDIT] AnnotationManager not available');
      return;
    }
    if (!currentEditing) {
      logger.error('[EDIT] Current editing annotation is null');
      return;
    }
    
    try {
      const result = await this.annotationManager.updateAnnotation(currentEditing.id, updateData);
      logger.debug('[EDIT] Update result received', {
        result,
        resultDataType: typeof result.data,
        resultDataKeys: result.data ? Object.keys(result.data) : []
      });
      
      // Verify annotation still exists after update
      const updatedAnnotation = this.annotationManager.findAnnotation(currentEditing.id);
      logger.info('[EDIT] Verification after update', {
        annotationExists: !!updatedAnnotation,
        annotationType: updatedAnnotation?.type,
        hasData: !!updatedAnnotation?.data,
        dataKeys: updatedAnnotation?.data ? (typeof updatedAnnotation.data === 'string' ? 'string' : Object.keys(updatedAnnotation.data)) : [],
        hasPosition: !!(updatedAnnotation?.data && (typeof updatedAnnotation.data === 'string' ? JSON.parse(updatedAnnotation.data) : updatedAnnotation.data).position),
        totalAnnotations: this.annotationManager.getAnnotations().length
      });
      
      if (!updatedAnnotation) {
        logger.error('[EDIT] CRITICAL: Annotation disappeared after update!', {
          annotationId: currentEditing.id,
          totalAnnotations: this.annotationManager.getAnnotations().length
        });
        this.showFeedback('Error: Annotation disappeared after update', 5000);
        return;
      }
      
      this.showFeedback('Annotation updated successfully', 2000);
      this.updateMapData();
      this.hideEditForm();
      // DO NOT emit ANNOTATION_UPDATED here - it triggers handleAnnotationUpdate which can corrupt the data
      // The map is already updated via updateMapData()
    } catch (error) {
      logger.error('[EDIT] Failed to update annotation:', error);
      this.showFeedback(`Failed to update annotation: ${error.message || 'Unknown error'}`, 5000);
    }
  }
  
  async deleteCurrentAnnotation() {
    const currentEditing = this.state.getCurrentEditingAnnotation();
    if (!currentEditing) return;
    
    if (confirm('Are you sure you want to delete this annotation?')) {
      await this.deleteAnnotationById(currentEditing.id);
      this.hideEditForm();
    }
  }
  
  async deleteAnnotation(feature) {
    const annotationId = feature.properties.id;
    
    if (confirm('Are you sure you want to delete this annotation?')) {
      await this.deleteAnnotationById(annotationId);
    }
  }
  
  async deleteAnnotationById(annotationId) {
    if (!this.annotationManager) return;
    try {
      await this.annotationManager.deleteAnnotation(annotationId);
      this.showFeedback('Annotation deleted successfully', 2000);
      this.updateMapData();
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_DELETED, { annotationId });
    } catch (error) {
      logger.error('Failed to delete annotation:', error);
      this.showFeedback(`Failed to delete annotation: ${error.message || 'Unknown error'}`, 5000);
    }
  }
  
  
  startLineDrawing() {
    const pendingAnnotation = this.state.getPendingAnnotation();
    if (!pendingAnnotation || !this.lineDrawingTool) {
      this.showFeedback('No location selected', 3000);
      return;
    }
    
    this.state.setCurrentDrawingTool(this.lineDrawingTool);
    this.lineDrawingTool.start(pendingAnnotation, this.state.getCurrentColor());
    this.state.setPendingAnnotation(null);
    this.eventBus.emit(MAP_EVENTS.DRAWING_STARTED, { type: 'line' });
    
    this.showFeedback('Click to add more points, use check mark to finish or X to cancel', 5000);
  }
  
  startAreaDrawing() {
    const pendingAnnotation = this.state.getPendingAnnotation();
    if (!pendingAnnotation || !this.areaDrawingTool) {
      this.showFeedback('No location selected', 3000);
      return;
    }
    
    this.state.setCurrentDrawingTool(this.areaDrawingTool);
    this.areaDrawingTool.start(pendingAnnotation, this.state.getCurrentColor());
    this.state.setPendingAnnotation(null);
    this.eventBus.emit(MAP_EVENTS.DRAWING_STARTED, { type: 'area' });
    
    this.showFeedback('Drag to adjust radius, click check mark to finish or X to cancel', 5000);
  }
  
  
  async createAnnotation(annotationData) {
    if (!this.annotationManager) return;
    try {
      const result = await this.annotationManager.createAnnotation(annotationData);
      this.showFeedback('Annotation created successfully', 2000);
      this.updateMapData();
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_CREATED, result);
      return result;
    } catch (error) {
      logger.error('Failed to create annotation:', error);
      this.showFeedback(`Failed to create annotation: ${error.message || 'Unknown error'}`, 5000);
      throw error;
    }
  }
  
  showAnnotationPopup(feature, lngLat) {
    if (this.popupManager) {
      this.popupManager.showAnnotationPopup(feature, lngLat);
    }
  }
  
  showLocationPopup(feature, lngLat) {
    if (this.popupManager) {
      this.popupManager.showLocationPopup(feature, lngLat);
    }
  }
  
  
  setupDOMEventListeners() {
    // Team selection
    const teamSelect = q('#map_team_select');
    if (teamSelect) {
      teamSelect.addEventListener('change', (e) => {
        const teamId = e.target.value || null;
        this.state.setCurrentTeamId(teamId);
        this.eventBus.emit(MAP_EVENTS.TEAM_SELECTED, { teamId });
      });
    }
    
    // Map style toggle (street / satellite)
    const styleStreet = q('#map_style_street');
    const styleSatellite = q('#map_style_satellite');
    if (styleStreet) {
      styleStreet.addEventListener('click', () => this.setMapStyle('street'));
    }
    if (styleSatellite) {
      styleSatellite.addEventListener('click', () => this.setMapStyle('satellite'));
    }

    // Refresh button
    const refreshBtn = q('#map_refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadMapData();
      });
    }
    
    // Center map button
    const centerBtn = q('#map_center');
    if (centerBtn) {
      centerBtn.addEventListener('click', () => {
        this.boundsManager.autoCenter(
          this.annotationManager.getAnnotations(),
          this.locationManager.getLocations()
        );
      });
    }
    
    // Clear all annotations button
    const clearAllBtn = q('#map_clear_all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        this.clearAllAnnotations();
      });
    }
    
    // Show/hide toggles
    const showAnnotations = q('#map_show_annotations');
    if (showAnnotations) {
      showAnnotations.checked = this.state.getShowAnnotations();
      showAnnotations.addEventListener('change', (e) => {
        this.state.setShowAnnotations(e.target.checked);
      });
    }
    
    const showLocations = q('#map_show_locations');
    if (showLocations) {
      showLocations.checked = this.state.getShowLocations();
      showLocations.addEventListener('change', (e) => {
        this.state.setShowLocations(e.target.checked);
      });
    }

    // Monitor areas toggle (geographical social media monitors)
    const showMonitors = q('#map_show_monitors');
    const showMonitorsWrapper = q('#map_show_monitors_wrapper');
    if (showMonitors) {
      showMonitors.addEventListener('change', (e) => {
        this.setMonitorAreasVisible(e.target.checked);
      });
    }
    this.showMonitorsWrapperEl = showMonitorsWrapper;
    // Load geographical monitors to determine if we should show the toggle
    this.loadGeographicalMonitorsForToggle();
    
    // Resize map when dashboard page is shown (container may have been hidden with 0 size at init)
    document.addEventListener('pageChanged', (e) => {
      if (e.detail?.page === 'dashboard' && this.map) {
        requestAnimationFrame(() => {
          this.map.resize();
        });
      }
    });
    
    // WebSocket listeners are set up in initializeMap()
  }

  /**
   * Switch map base style between street (OSM) and satellite (ESRI), matching Android app.
   * @param {'street'|'satellite'} type
   */
  setMapStyle(type) {
    if (!this.map || !this.mapInitializer) return;
    const style = this.mapInitializer.getStyleForType(type);
    if (!style) return;
    this.currentMapType = type;
    this.map.setStyle(style);
    const streetBtn = q('#map_style_street');
    const satelliteBtn = q('#map_style_satellite');
    if (streetBtn) {
      streetBtn.classList.toggle('active', type === 'street');
      streetBtn.setAttribute('aria-pressed', type === 'street' ? 'true' : 'false');
    }
    if (satelliteBtn) {
      satelliteBtn.classList.toggle('active', type === 'satellite');
      satelliteBtn.setAttribute('aria-pressed', type === 'satellite' ? 'true' : 'false');
    }
    // setStyle() replaces the style and removes all layers/sources. Re-add our layers and data when the new style is loaded.
    this.map.once('styledata', () => {
      this.setupMapSources();
      this.updateMapData();
    });
  }

  /**
   * Geocode a query via server proxy (avoids CORS; Nominatim is called server-side).
   * @param {string} query - Address, city, zip, or place name
   * @returns {Promise<{ lat: number, lon: number, bbox?: number[], display_name?: string }|null>}
   */
  async geocodeQuery(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) return null;
    try {
      const result = await get(`/api/admin/geocode?q=${encodeURIComponent(trimmed)}`);
      if (!result || result.lat == null || result.lon == null) return null;
      return {
        lat: Number(result.lat),
        lon: Number(result.lon),
        bbox: Array.isArray(result.bbox) && result.bbox.length >= 4 ? result.bbox : null,
        display_name: result.display_name
      };
    } catch (err) {
      logger.error('Geocoding failed', err);
      return null;
    }
  }

  /**
   * Run location search with a query string (e.g. from command palette).
   * @param {string} query - City, zip, or address to search
   */
  async runLocationSearchWithQuery(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      this.showFeedback('Enter a city, zip, or address', 3000);
      return;
    }
    this.showFeedback('Searching...', 2000);
    const result = await this.geocodeQuery(trimmed);
    if (!result || !this.map) {
      this.showFeedback('Location not found', 3000);
      return;
    }
    const { lat, lon, bbox } = result;
    if (bbox && bbox.length >= 4) {
      const [south, north, west, east] = bbox;
      this.boundsManager.fitBounds([[west, south], [east, north]], { duration: 1000 });
    } else {
      const zoom = DISPLAY_CONFIG.locationSearchZoom ?? 10;
      this.boundsManager.centerOnCoordinates(lon, lat, zoom);
    }
    this.showFeedback('Location found', 2000);
  }

  /**
   * Fetch geographical monitors and show/hide the "Monitor areas" toggle wrapper.
   */
  async loadGeographicalMonitorsForToggle() {
    try {
      const data = await get('/api/social-media/geographical-monitors');
      const monitors = data?.monitors || [];
      this.geographicalMonitors = monitors;
      const wrapper = this.showMonitorsWrapperEl || q('#map_show_monitors_wrapper');
      if (wrapper && monitors.length > 0) {
        wrapper.style.display = '';
      }
    } catch (err) {
      logger.debug('Could not load geographical monitors for toggle', err);
    }
  }

  /**
   * Set monitor areas layer visibility. Loads and geocodes monitor areas if needed.
   * @param {boolean} visible
   */
  async setMonitorAreasVisible(visible) {
    if (!this.layerManager || !this.map) return;
    if (visible) {
      await this.loadMonitorAreasData();
      this.layerManager.updateMonitorAreaVisibility(true);
    } else {
      this.layerManager.updateMonitorAreaVisibility(false);
    }
  }

  /**
   * Load geographical monitors, geocode each area, and update monitor-areas source.
   */
  async loadMonitorAreasData() {
    if (this.monitorAreasLoaded && this.geographicalMonitors.length > 0) {
      this.updateMonitorAreasSource();
      return;
    }
    let monitors = this.geographicalMonitors;
    if (monitors.length === 0) {
      try {
        const data = await get('/api/social-media/geographical-monitors');
        monitors = data?.monitors || [];
        this.geographicalMonitors = monitors;
      } catch (err) {
        logger.error('Failed to load geographical monitors', err);
        this.showFeedback('Could not load monitor areas', 3000);
        return;
      }
    }
    if (monitors.length === 0) {
      this.showFeedback('No geographical monitors configured', 3000);
      return;
    }
    this.showFeedback('Loading monitor areas...', 2000);
    const features = [];
    for (let i = 0; i < monitors.length; i++) {
      const area = monitors[i].geographical_area || monitors[i].name || '';
      if (!area) continue;
      const geo = await this.geocodeQuery(area);
      if (!geo) continue;
      const { lat, lon, bbox } = geo;
      let coords;
      if (bbox && bbox.length >= 4) {
        const [south, north, west, east] = bbox;
        coords = [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
      } else {
        const radiusDeg = 0.05;
        const points = 32;
        const ring = [];
        for (let k = 0; k <= points; k++) {
          const t = (k / points) * 2 * Math.PI;
          ring.push([lon + radiusDeg * Math.cos(t), lat + radiusDeg * Math.sin(t)]);
        }
        coords = [ring];
      }
      features.push({
        type: 'Feature',
        properties: { id: monitors[i].id, name: area },
        geometry: { type: 'Polygon', coordinates: coords }
      });
      if (i < monitors.length - 1) {
        await new Promise(r => setTimeout(r, 1100));
      }
    }
    this.monitorAreasData = features;
    this.monitorAreasLoaded = true;
    this.updateMonitorAreasSource();
    this.showFeedback(`${features.length} monitor area(s) shown`, 2000);
  }

  /**
   * Update the monitor-areas GeoJSON source from cached features.
   */
  updateMonitorAreasSource() {
    if (!this.map) return;
    const source = this.map.getSource(LAYER_CONFIG.sources.monitorAreas);
    if (!source) return;
    const features = this.monitorAreasData || [];
    source.setData({ type: 'FeatureCollection', features });
  }
  
  
  handleAnnotationUpdate(data) {
    if (!this.annotationManager) return;
    
    logger.info('[WS-UPDATE] Received annotation update from WebSocket', {
      id: data.id,
      type: data.type,
      dataKeys: data.data ? Object.keys(data.data) : [],
      hasPosition: !!(data.data?.position),
      hasPoints: !!(data.data?.points),
      hasCenter: !!(data.data?.center),
      incomingData: data.data
    });
    
    // Check if this annotation is relevant to current view
    if (this.state.getCurrentTeamId() && data.teamId !== this.state.getCurrentTeamId()) {
      logger.debug('[WS-UPDATE] Skipping update - not relevant to current team');
      return; // Not relevant to current team filter
    }
    
    // CRITICAL: Check if this is a self-update (we just updated this locally)
    // If we just updated it locally via updateAnnotation, the local version is already correct
    // and we should NOT overwrite it with potentially incomplete WebSocket data
    const existingAnnotation = this.annotationManager.findAnnotation(data.id);
    if (existingAnnotation) {
      // Check if existing annotation has complete data (has position/points/center)
      let existingData = existingAnnotation.data || {};
      if (typeof existingData === 'string') {
        try {
          existingData = JSON.parse(existingData);
        } catch (e) {
          existingData = {};
        }
      }
      
      const hasCompleteData = 
        (existingAnnotation.type === 'poi' && existingData.position) ||
        (existingAnnotation.type === 'line' && existingData.points && existingData.points.length > 0) ||
        (existingAnnotation.type === 'area' && existingData.center && existingData.radius) ||
        (existingAnnotation.type === 'polygon' && existingData.points && existingData.points.length > 0);
      
      // Check if incoming data is incomplete (missing critical fields)
      const incomingData = data.data || {};
      const incomingIsIncomplete = 
        (data.type === 'poi' && !incomingData.position) ||
        (data.type === 'line' && (!incomingData.points || incomingData.points.length === 0)) ||
        (data.type === 'area' && (!incomingData.center || !incomingData.radius)) ||
        (data.type === 'polygon' && (!incomingData.points || incomingData.points.length === 0));
      
      if (hasCompleteData && incomingIsIncomplete) {
        logger.warn('[WS-UPDATE] CRITICAL: Ignoring incomplete WebSocket update that would corrupt existing annotation', {
          annotationId: data.id,
          existingHasCompleteData: true,
          incomingIsIncomplete: true,
          existingDataKeys: Object.keys(existingData),
          incomingDataKeys: Object.keys(incomingData)
        });
        // Don't update - keep the existing complete annotation
        return;
      }
    }
    
    // Ensure data structure is correct
    // WebSocket events have: { id, teamId, type, data: {...}, userId, userName, createdBy, ... }
    // We need: { id, type, data: {...}, user_id, team_id, user_name (creator), ... }
    // Prefer createdBy for "created by" so edits don't overwrite with editor name
    const annotation = {
      id: data.id,
      type: data.type,
      user_id: data.userId || data.user_id,
      team_id: data.teamId || data.team_id,
      user_name: data.createdBy || data.userName || data.user_name,
      data: data.data || {},
      created_at: data.created_at,
      updated_at: data.updated_at
    };
    
    // Parse annotation.data if it's a string
    if (typeof annotation.data === 'string') {
      try {
        annotation.data = JSON.parse(annotation.data);
        logger.debug('[WS-UPDATE] Parsed annotation.data from string');
      } catch (e) {
        logger.warn('[WS-UPDATE] Failed to parse annotation.data as JSON:', e);
        annotation.data = {};
      }
    }
    
    // Add or update annotation in local data
    const existingIndex = this.annotationManager.getAnnotations().findIndex(a => a.id === annotation.id);
    if (existingIndex >= 0) {
      // Merge with existing annotation to preserve all fields
      const existing = this.annotationManager.getAnnotations()[existingIndex];
      
      // Parse existing.data if it's a string
      let existingData = existing.data || {};
      if (typeof existingData === 'string') {
        try {
          existingData = JSON.parse(existingData);
        } catch (e) {
          logger.warn('[WS-UPDATE] Failed to parse existing.data as JSON:', e);
          existingData = {};
        }
      }
      
      logger.info('[WS-UPDATE] Merging with existing annotation', {
        existingDataKeys: Object.keys(existingData),
        newDataKeys: Object.keys(annotation.data),
        existingHasPosition: !!existingData.position,
        existingHasPoints: !!existingData.points,
        existingHasCenter: !!existingData.center,
        existingData: existingData,
        incomingData: annotation.data
      });
      
      // CRITICAL: Only merge fields that exist in incoming data
      // Preserve ALL existing fields, only update fields that are in the incoming data
      const mergedData = { ...existingData };
      Object.keys(annotation.data).forEach(key => {
        mergedData[key] = annotation.data[key];
      });
      
      logger.info('[WS-UPDATE] Merged data result', {
        mergedDataKeys: Object.keys(mergedData),
        hasPosition: !!mergedData.position,
        hasPoints: !!mergedData.points,
        hasCenter: !!mergedData.center,
        mergedData: mergedData
      });
      
      // Verify merged data has required fields
      // Use existing.type instead of annotation.type since we're merging with existing data
      // and the WebSocket event might have incomplete type information
      const annotationType = existing.type || annotation.type;
      const hasRequiredFields = 
        (annotationType === 'poi' && mergedData.position) ||
        (annotationType === 'line' && mergedData.points && mergedData.points.length > 0) ||
        (annotationType === 'area' && mergedData.center && mergedData.radius) ||
        (annotationType === 'polygon' && mergedData.points && mergedData.points.length > 0);
      
      if (!hasRequiredFields) {
        logger.error('[WS-UPDATE] CRITICAL: Merged data missing required fields! Not updating annotation.', {
          existingType: existing.type,
          annotationType: annotation.type,
          annotationTypeUsed: annotationType,
          mergedDataKeys: Object.keys(mergedData),
          mergedData: mergedData
        });
        return; // Don't corrupt the annotation
      }
      
      // CRITICAL: Only update fields that are actually present in the annotation object
      // Don't spread annotation if it has undefined/incomplete fields that would corrupt existing data
      const updatedAnnotation = {
        ...existing,
        data: mergedData
      };
      
      // Only update specific fields from annotation if they're actually defined
      if (annotation.type) {
        updatedAnnotation.type = annotation.type;
      }
      if (annotation.user_id !== undefined) {
        updatedAnnotation.user_id = annotation.user_id;
      }
      if (annotation.team_id !== undefined) {
        updatedAnnotation.team_id = annotation.team_id;
      }
      if (annotation.user_name !== undefined) {
        updatedAnnotation.user_name = annotation.user_name; // createdBy / creator name
      }
      if (annotation.created_at) {
        updatedAnnotation.created_at = annotation.created_at;
      }
      if (annotation.updated_at) {
        updatedAnnotation.updated_at = annotation.updated_at;
      }
      
      this.annotationManager.getAnnotations()[existingIndex] = updatedAnnotation;
      
      logger.info('[WS-UPDATE] Successfully updated annotation in array', {
        annotationId: annotation.id,
        finalDataKeys: Object.keys(this.annotationManager.getAnnotations()[existingIndex].data || {})
      });
    } else {
      logger.debug('[WS-UPDATE] Adding new annotation (not found locally)');
      this.annotationManager.getAnnotations().unshift(annotation); // Add to beginning
    }
    
    // Update map immediately
    this.updateMapData();
    // Don't emit ANNOTATION_UPDATED here - it would create an infinite loop
    // The event is already emitted by updateAnnotationField or comes from WebSocket
    // Other components that need to know about updates should listen to MAP_DATA_UPDATED
    
    logger.debug(`[WS-UPDATE] Updated annotation ${annotation.id} on map`);
  }

  handleAnnotationDelete(data) {
    if (!this.annotationManager) return;

    // Handle both annotationId (from socket/admin) and id (from some payloads)
    const annotationId = data.annotationId || data.id;
    if (!annotationId) {
      logger.warn('[WS-DELETE] No annotationId in delete payload', data);
      return;
    }

    // Only skip if we have a team filter AND payload has teamId AND they differ (don't skip when teamId missing)
    if (this.state.getCurrentTeamId() && data.teamId != null && data.teamId !== this.state.getCurrentTeamId()) {
      logger.debug('[WS-DELETE] Skipping delete - not relevant to current team');
      return;
    }

    // Remove annotation from local data
    const annotations = this.annotationManager.getAnnotations();
    const existingIndex = annotations.findIndex(a => a.id === annotationId);
    if (existingIndex >= 0) {
      annotations.splice(existingIndex, 1);
      logger.debug(`Removed annotation ${annotationId} from map`);
    } else {
      logger.debug(`Annotation ${annotationId} not found in local data`);
    }
    
    // Update map immediately
    this.updateMapData();
    // Don't emit ANNOTATION_DELETED here - it would create an infinite loop
    // The event is already emitted by deleteAnnotationById or comes from WebSocket
    // Other components that need to know about deletions should listen to MAP_DATA_UPDATED
  }

  handleBulkAnnotationDelete(data) {
    if (!this.annotationManager) return;
    
    // Check if this deletion is relevant to current view
    if (this.state.getCurrentTeamId() && data.teamId !== this.state.getCurrentTeamId()) {
      return; // Not relevant to current team filter
    }
    
    // Remove multiple annotations from local data
    const annotations = this.annotationManager.getAnnotations();
    let removedCount = 0;
    data.annotationIds.forEach(annotationId => {
      const existingIndex = annotations.findIndex(a => a.id === annotationId);
      if (existingIndex >= 0) {
        annotations.splice(existingIndex, 1);
        removedCount++;
      }
    });
    
    logger.debug(`Removed ${removedCount} annotations from map (${data.annotationIds.length} requested)`);
    
    // Update map immediately
    this.updateMapData();
    // Note: Do not emit ANNOTATION_BULK_DELETED here - this is an event handler,
    // not an event source. The event should only be emitted from the action source
    // (e.g., clearAllAnnotations) to avoid infinite loops.
  }
  
  handleLocationUpdate(data) {
    if (!this.locationManager) return;
    
    // Check if this location is relevant to current view
    if (this.state.getCurrentTeamId() && data.teamId !== this.state.getCurrentTeamId()) {
      return; // Not relevant to current team filter
    }
    
    // Update location via location manager
    this.locationManager.updateLocation(data);
    
    // Update map immediately
    this.updateMapData();
  }
  
  updateLayerVisibility() {
    if (!this.layerManager) return;
    
    this.layerManager.updateAnnotationVisibility(this.state.getShowAnnotations());
    this.layerManager.updateLocationVisibility(this.state.getShowLocations());
  }
  
  async loadMapData(options = {}) {
    if (!this.map || !this.dataLoader) return;

    const { skipAutoCenter = false } = options;

    // Ensure map sources are set up
    if (!this.map.getSource(LAYER_CONFIG.sources.annotationsPoi)) {
      logger.debug('Map sources not ready, setting up...');
      this.setupMapSources();
    }

    logger.debug('Loading map data...');
    try {
      await this.dataLoader.loadAll({
        loadTeams: false, // Teams are loaded separately
        loadAnnotations: true,
        loadLocations: true
      });

      this.updateMapData();

      // Update popup manager with new annotations
      if (this.popupManager) {
        this.popupManager.setAnnotations(this.annotationManager.getAnnotations());
      }

      // Start expiration tick (refresh map every 1s when any annotation is expiring)
      if (!this.expirationTickInterval) {
        this.expirationTickInterval = setInterval(() => {
          if (this.annotationManager?.hasExpiringAnnotations()) {
            this.updateMapData();
          }
        }, 1000);
        document.addEventListener('visibilitychange', this._onVisibilityChange.bind(this));
      }

      // Center map on user location or data only when explicitly loading (e.g. refresh button), not on sync-activity refresh
      if (!skipAutoCenter) {
        await this.boundsManager.autoCenter(
          this.annotationManager.getAnnotations(),
          this.locationManager.getLocations()
        );
      }
    } catch (error) {
      logger.error('Failed to load map data:', error);
    }
  }
  
  _onVisibilityChange() {
    if (document.hidden) {
      if (this.expirationTickInterval) {
        clearInterval(this.expirationTickInterval);
        this.expirationTickInterval = null;
      }
    } else {
      if (!this.expirationTickInterval && this.annotationManager) {
        this.expirationTickInterval = setInterval(() => {
          if (this.annotationManager?.hasExpiringAnnotations()) {
            this.updateMapData();
          }
        }, 1000);
      }
    }
  }

  updateMapData() {
    if (!this.map || !this.dataLoader) return;
    
    // If style was replaced (e.g. satellite/street switch) or not loaded yet, sources/layers are missing.
    // Set them up and re-run updateMapData once the style is ready so client-created annotations paint immediately.
    if (!this.map.getSource(LAYER_CONFIG.sources.annotationsPoi)) {
      if (!this.map.isStyleLoaded()) {
        this.map.once('styledata', () => this.updateMapData());
        return;
      }
      this.setupMapSources();
      // After adding sources/layers, set data (sources now exist)
    }
    
    // Ensure POI icons exist before updating (in case new shape/color combinations were used)
    // All icons should be generated upfront, but this ensures they exist
    if (this.iconManager && this.annotationManager) {
      const annotations = this.annotationManager.getAnnotations();
      const poiAnnotations = annotations.filter(a => a.type === 'poi');
      
      if (poiAnnotations.length > 0) {
        const iconNames = new Set();
        poiAnnotations.forEach(annotation => {
          if (annotation.data) {
            const data = typeof annotation.data === 'string' 
              ? JSON.parse(annotation.data) 
              : annotation.data;
            const color = (data.color || 'green').toLowerCase();
            const shape = (data.shape || 'circle').toLowerCase();
            const iconName = `poi-${shape}-${color}`;
            iconNames.add(iconName);
          }
        });
        
        // Generate any missing icons
        iconNames.forEach(iconName => {
          // Parse icon name: poi-{shape}-{color}
          const match = iconName.match(/^poi-(.+?)-(.+)$/);
          if (match) {
            const [, shape, color] = match;
            if (!this.iconManager.hasIcon(shape, color)) {
              logger.debug(`Generating missing POI icon: ${iconName}`);
              this.iconManager.generateIcon(shape, color);
            }
          }
        });
      }
    }
    
    // Update all data on map via data loader
    this.dataLoader.updateMap();
    
    // Update popup manager with current annotations
    if (this.popupManager) {
      this.popupManager.setAnnotations(this.annotationManager.getAnnotations());
    }
    // Update on-map timer pills for expiring annotations (matches Android UX)
    if (this.timerPillOverlay) {
      this.timerPillOverlay.update(this.annotationManager.getAnnotations());
    }
    
    this.eventBus.emit(MAP_EVENTS.MAP_DATA_UPDATED);
  }
  
  
  
  async clearAllAnnotations() {
    // Show confirmation dialog
    const confirmed = confirm(
      'Are you sure you want to clear ALL annotations?\n\n' +
      'This will permanently delete all annotations from the map.\n' +
      'Note: Annotations linked to threat analyses will be skipped.\n' +
      'This action cannot be undone.\n\n' +
      'Click OK to continue or Cancel to abort.'
    );
    
    if (!confirmed) {
      return;
    }
    
    try {
      this.showFeedback('Clearing all annotations...', 3000);
      
      if (!this.annotationManager) return;
      
      // Get all annotation IDs, optionally filtered by team (support both teamId and team_id from API/WS)
      let annotations = this.annotationManager.getAnnotations();
      const currentTeamId = this.state.getCurrentTeamId();
      if (currentTeamId) {
        annotations = annotations.filter(ann => (ann.teamId || ann.team_id) === currentTeamId);
      }
      const annotationIds = annotations.map(annotation => annotation.id);

      if (annotationIds.length === 0) {
        this.showFeedback('No annotations to clear', 2000);
        // Refresh from server so any ghost annotations (e.g. deleted by client but not removed from map) disappear
        await this.loadMapData({ skipAutoCenter: true });
        return;
      }
      
      if (!this.annotationManager) return;
      
      // Call the bulk delete API
      const result = await this.annotationManager.bulkDeleteAnnotations(annotationIds);
      
      if (result.warning) {
        // Show warning if some annotations were skipped
        this.showFeedback(`${result.deletedCount} annotations cleared. ${result.warning}`, 8000);
      } else {
        // All annotations were cleared successfully
        this.showFeedback(`Successfully cleared ${result.deletedCount} annotations`, 3000);
      }
      
      // Update map immediately
      this.updateMapData();
      
      // Close any open popups
      if (this.popupManager) {
        this.popupManager.closeAllPopups();
      }
      
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_BULK_DELETED, result);
    } catch (error) {
      logger.error('Failed to clear annotations:', error);
      this.showFeedback(`Failed to clear annotations: ${error.message || 'Unknown error'}`, 5000);
    }
  }
  
  
  /**
   * Handle threat selection from map or panel
   */
  handleThreatSelection(data) {
    const { threat, lngLat } = data;
    
    // Show threat details in a popup or panel
    if (threat && this.popupManager) {
      const content = `
        <div style="max-width: 300px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #ef4444;">
            ${threat.threat_level} Threat
          </div>
          <div style="font-size: 14px; margin-bottom: 4px; color: #e6edf3;">
            <strong>Type:</strong> ${threat.threat_type || 'Unknown'}
          </div>
          <div style="font-size: 13px; margin-bottom: 4px; color: #8b97a7;">
            <strong>Confidence:</strong> ${(threat.confidence_score * 100).toFixed(1)}%
          </div>
          <div style="font-size: 12px; color: #8b97a7; margin-top: 8px;">
            ${threat.ai_summary || 'No summary available'}
          </div>
          <div style="margin-top: 12px;">
            <button onclick="window.threatsPage?.reviewThreat('${threat.id}', 'approved')" 
                    style="background: #22c55e; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; margin-right: 8px;">
              Approve & Send
            </button>
            <button onclick="window.threatsPage?.reviewThreat('${threat.id}', 'dismissed')" 
                    style="background: #6b7280; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
              Dismiss
            </button>
          </div>
        </div>
      `;
      
      new maplibregl.Popup({ closeOnClick: true })
        .setLngLat([lngLat.lng, lngLat.lat])
        .setHTML(content)
        .addTo(this.map);
    }
  }

  /**
   * Pan to threat location
   */
  panToThreat(threatId) {
    if (this.threatManager) {
      this.threatManager.panToThreat(threatId);
    }
  }

  // Cleanup method to prevent memory leaks
  cleanup() {
    // Disconnect WebSocket listeners
    if (this.webSocketManager) {
      this.webSocketManager.disconnect();
      this.webSocketManager.cleanupGlobalListeners();
    }
    
    // Close any open popups
    if (this.popupManager) {
      this.popupManager.closeAllPopups();
    }
    
    // Hide any open menus
    this.hideFanMenu();
    this.hideColorMenu();
    this.hideShapeMenu();
    this.hideEditForm();
    
    // Clean up drawing tools
    const currentDrawingTool = this.state.getCurrentDrawingTool();
    if (currentDrawingTool) {
      currentDrawingTool.cancel();
      this.state.setCurrentDrawingTool(null);
    }
    
    // Clean up long press handler
    if (this.longPressHandler) {
      this.longPressHandler.stop();
    }
    
    if (this._pendingMapDataRefreshTimeout) {
      clearTimeout(this._pendingMapDataRefreshTimeout);
      this._pendingMapDataRefreshTimeout = null;
    }
    if (this._wsAnnotationHandlers) {
      websocketService.off('annotation_update', this._wsAnnotationHandlers.annotation_update);
      websocketService.off('annotation_delete', this._wsAnnotationHandlers.annotation_delete);
      websocketService.off('annotation_bulk_delete', this._wsAnnotationHandlers.annotation_bulk_delete);
      websocketService.off('location_update', this._wsAnnotationHandlers.location_update);
      this._wsAnnotationHandlers = null;
    }
    
    // Clean up menu manager
    if (this.menuManager) {
      this.menuManager.cleanupAll();
    }
    
    // Clear event bus
    if (this.eventBus) {
      this.eventBus.clear();
    }
    
    logger.debug('AdminMap cleaned up');
  }
}

// Export for use in other modules
export { AdminMap };

// Initialize map when page loads
let adminMap = null;

// Make adminMap globally accessible
window.adminMap = null;

window.addEventListener('load', function() {
  logger.debug('Page loaded, checking libraries...');
  // Wait for both Socket.IO and MapLibre to load
  const checkLibraries = () => {
    logger.debug('Checking libraries - io:', typeof io, 'maplibregl:', typeof maplibregl);
    if (typeof io !== 'undefined' && typeof maplibregl !== 'undefined') {
      logger.info('Both libraries loaded, initializing map...');
      adminMap = new AdminMap();
      // Make adminMap globally accessible
      window.adminMap = adminMap;
    } else {
      logger.debug('Libraries not ready, retrying...');
      setTimeout(checkLibraries, TIMING.libraryCheckInterval);
    }
  };
  
  checkLibraries();
});

// Cleanup when page is unloaded
window.addEventListener('beforeunload', function() {
  if (adminMap) {
    adminMap.cleanup();
  }
});
