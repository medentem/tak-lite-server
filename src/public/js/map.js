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

// Import map components
import {
  MapInitializer,
  AnnotationManager,
  PoiDrawingTool,
  LineDrawingTool,
  AreaDrawingTool,
  FanMenu,
  ColorMenu,
  MenuManager,
  PopupManager,
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
  MapBoundsManager
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
    this.webSocketManager = null; // Will be initialized after map is created
    this.menuManager = new MenuManager();
    this.feedbackDisplay = new FeedbackDisplay();
    this.popupManager = null; // Will be initialized after map is created
    this.fanMenu = null; // Will be initialized after map is created
    this.colorMenu = null; // Will be initialized after map is created
    this.longPressHandler = null; // Will be initialized after map is created
    
    // Drawing tools
    this.poiDrawingTool = null;
    this.lineDrawingTool = null;
    this.areaDrawingTool = null;
    
    // UI elements
    this.editForm = null;
    this.modalOverlay = null;
    
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
    
    // Initialize layer and rendering managers
    this.layerManager = new LayerManager(this.map);
    this.iconManager = new IconManager(this.map);
    this.boundsManager = new MapBoundsManager(this.map);
    
    // Initialize WebSocket manager
    this.webSocketManager = new MapWebSocketManager(this.eventBus, () => {
      this.loadMapData();
    });
    this.webSocketManager.setupGlobalListeners();
      
      // Initialize UI components
      this.popupManager = new PopupManager(this.map, this.annotationManager.getAnnotations());
      this.fanMenu = new FanMenu('fan_menu', this.map, this.menuManager);
      this.colorMenu = new ColorMenu('color_menu', this.menuManager);
      
      // Initialize long press handler
      this.longPressHandler = new LongPressHandler(this.map, {
        onLongPress: (e) => {
          this.state.setIsLongPressing(true);
          
          // Check for existing annotation at long press location
          const layers = [
            LAYER_CONFIG.annotationLayers.poi,
            LAYER_CONFIG.annotationLayers.line,
            LAYER_CONFIG.annotationLayers.area,
            LAYER_CONFIG.annotationLayers.polygon
          ];
          
          const features = this.map.queryRenderedFeatures(e.point, {
            layers: layers
          });
          
          if (features.length > 0) {
            // Show edit menu for existing annotation
            const feature = features[0];
            this.showEditFanMenu(feature, e.point);
            this.showFeedback('Long press detected - edit annotation');
          } else {
            // Show create menu for new annotation
            this.showFanMenu(e.point);
            this.showFeedback('Long press detected - choose annotation type');
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
      this.map.on('load', () => {
        this.setupMapSources();
        this.initializeAnnotationUI();
        this.setupMapInteractionHandlers();
        this.setupMapMovementHandlers();
        this.eventBus.emit(MAP_EVENTS.MAP_LOADED);
      });
      
    } catch (error) {
      logger.error('Failed to initialize map:', error);
    }
  }
  
  /**
   * Setup WebSocket event handlers via EventBus
   */
  setupWebSocketEventHandlers() {
    // Handle annotation updates
    this.eventBus.on(MAP_EVENTS.ANNOTATION_UPDATED, (data) => {
      this.handleAnnotationUpdate(data);
    });
    
    // Handle annotation deletions
    this.eventBus.on(MAP_EVENTS.ANNOTATION_DELETED, (data) => {
      this.handleAnnotationDelete(data);
    });
    
    // Handle bulk annotation deletions
    this.eventBus.on(MAP_EVENTS.ANNOTATION_BULK_DELETED, (data) => {
      this.handleBulkAnnotationDelete(data);
    });
    
    // Handle location updates
    this.eventBus.on(MAP_EVENTS.LOCATION_UPDATED, (data) => {
      this.handleLocationUpdate(data);
    });
  }
  
  /**
   * Handle drawing tool finish
   */
  async handleDrawingFinish(annotationData) {
    if (!annotationData) return;
    
    annotationData.teamId = this.state.getCurrentTeamId();
    try {
      await this.annotationManager.createAnnotation(annotationData);
      this.feedbackDisplay.show('Annotation created successfully', 2000);
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
    logger.debug('Fan menu made visible with', options.length, 'options');
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
  
  getEditModeOptions(annotationType) {
    const options = [
      { type: 'edit-label', iconClass: 'edit', label: 'Edit Label' },
      { type: 'edit-note', iconClass: 'note', label: 'Add Note' }
    ];
    
    // Add color option for all annotation types
    options.push({ type: 'change-color', iconClass: 'color', label: 'Color' });
    
    // Add shape option only for POIs
    if (annotationType === 'poi') {
      options.push({ type: 'change-shape', iconClass: 'shape', label: 'Shape' });
    }
    
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
      logger.error('Annotation not found:', annotationId);
      return;
    }
    
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
    
    // Define options based on annotation type
    const options = this.getEditModeOptions(annotation.type);
    
    // Position fan menu at click point relative to map container
    fanMenuElement.style.left = (point.x - 100) + 'px';
    fanMenuElement.style.top = (point.y - 100) + 'px';
    fanMenuElement.style.position = 'absolute';
    
    // Create donut ring segments
    this.createDonutRingSegments(options, point);
    
    // Show fan menu
    fanMenuElement.classList.add('visible');
    logger.debug('Edit fan menu made visible with', options.length, 'options');
  }
  
  updateEditFanMenuCenterText(annotation) {
    const coordsEl = document.getElementById('fan_menu_coords');
    const distanceEl = document.getElementById('fan_menu_distance');
    
    if (coordsEl) {
      const data = annotation.data;
      let coords = '';
      if (annotation.type === 'poi' && data.position) {
        coords = `${data.position.lt.toFixed(5)}, ${data.position.lng.toFixed(5)}`;
      } else if (annotation.type === 'line' && data.points && data.points.length > 0) {
        const firstPoint = data.points[0];
        coords = `${firstPoint.lt.toFixed(5)}, ${firstPoint.lng.toFixed(5)}`;
      } else if (annotation.type === 'area' && data.center) {
        coords = `${data.center.lt.toFixed(5)}, ${data.center.lng.toFixed(5)}`;
      } else if (annotation.type === 'polygon' && data.points && data.points.length > 0) {
        const firstPoint = data.points[0];
        coords = `${firstPoint.lt.toFixed(5)}, ${firstPoint.lng.toFixed(5)}`;
      }
      coordsEl.textContent = coords || 'N/A';
    }
    
    if (distanceEl) {
      const label = annotation.data.label || annotation.type.toUpperCase();
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
      pathElement.style.fill = 'rgba(0, 0, 0, 0.8)';
      pathElement.style.stroke = 'white';
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
        pathElement.style.fill = 'rgba(0, 0, 0, 0.9)';
        pathElement.style.stroke = 'rgba(255, 255, 255, 0.9)';
      });
      
      pathElement.addEventListener('mouseleave', () => {
        pathElement.style.fill = 'rgba(0, 0, 0, 0.8)';
        pathElement.style.stroke = 'white';
      });
      
      svgElement.appendChild(pathElement);
      
      // Create icon element
      const iconElement = document.createElement('div');
      iconElement.className = `fan-menu-segment-icon ${option.iconClass}`;
      iconElement.style.position = 'absolute';
      iconElement.style.left = `${iconX}px`;
      iconElement.style.top = `${iconY}px`;
      iconElement.style.transform = 'translate(-50%, -50%)';
      iconElement.style.pointerEvents = 'none';
      
      svgContainer.appendChild(iconElement);
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
    
    // Show shape selection menu
    const shapes = [
      { type: 'circle', label: 'Circle' },
      { type: 'square', label: 'Square' },
      { type: 'triangle', label: 'Triangle' },
      { type: 'exclamation', label: 'Exclamation' }
    ];
    
    const shapeOptions = shapes.map(s => s.label).join('\n');
    const choice = prompt(`Select shape:\n1. Circle\n2. Square\n3. Triangle\n4. Exclamation\n\nCurrent: ${currentEditing.data.shape || 'circle'}`, '1');
    
    if (choice !== null) {
      const shapeIndex = parseInt(choice) - 1;
      if (shapeIndex >= 0 && shapeIndex < shapes.length) {
        this.updateAnnotationField('shape', shapes[shapeIndex].type);
      }
    }
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
    if (!currentEditing) return;
    
    const editForm = q('#edit_annotation_form');
    if (!editForm) return;
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
    
    if (!this.annotationManager) return;
    if (!currentEditing) return;
    
    try {
      const result = await this.annotationManager.updateAnnotation(currentEditing.id, updateData);
      this.showFeedback('Annotation updated successfully', 2000);
      this.updateMapData();
      this.hideEditForm();
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_UPDATED, result);
    } catch (error) {
      logger.error('Failed to update annotation:', error);
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
    
    // WebSocket listeners are set up in initializeMap()
  }
  
  
  handleAnnotationUpdate(data) {
    if (!this.annotationManager) return;
    
    // Check if this annotation is relevant to current view
    if (this.state.getCurrentTeamId() && data.teamId !== this.state.getCurrentTeamId()) {
      return; // Not relevant to current team filter
    }
    
    // Ensure data structure is correct
    // WebSocket events have: { id, teamId, type, data: {...}, userId, ... }
    // We need: { id, type, data: {...}, user_id, team_id, ... }
    const annotation = {
      id: data.id,
      type: data.type,
      user_id: data.userId || data.user_id,
      team_id: data.teamId || data.team_id,
      data: data.data || {},
      created_at: data.created_at,
      updated_at: data.updated_at
    };
    
    // Add or update annotation in local data
    const existingIndex = this.annotationManager.getAnnotations().findIndex(a => a.id === annotation.id);
    if (existingIndex >= 0) {
      // Merge with existing annotation to preserve all fields
      const existing = this.annotationManager.getAnnotations()[existingIndex];
      this.annotationManager.getAnnotations()[existingIndex] = {
        ...existing,
        ...annotation,
        data: { ...existing.data, ...annotation.data }
      };
    } else {
      this.annotationManager.getAnnotations().unshift(annotation); // Add to beginning
    }
    
    // Update map immediately
    this.updateMapData();
    // Don't emit ANNOTATION_UPDATED here - it would create an infinite loop
    // The event is already emitted by updateAnnotationField or comes from WebSocket
    // Other components that need to know about updates should listen to MAP_DATA_UPDATED
    
    logger.debug(`Updated annotation ${annotation.id} on map`);
  }

  handleAnnotationDelete(data) {
    if (!this.annotationManager) return;
    
    // Check if this annotation is relevant to current view
    if (this.state.getCurrentTeamId() && data.teamId !== this.state.getCurrentTeamId()) {
      return; // Not relevant to current team filter
    }
    
    // Remove annotation from local data
    const annotations = this.annotationManager.getAnnotations();
    // Handle both annotationId (from local delete) and id (from WebSocket)
    const annotationId = data.annotationId || data.id;
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
  
  async loadMapData() {
    if (!this.map || !this.dataLoader) return;
    
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
      
      // Try to center map on user location or existing data after loading
      await this.boundsManager.autoCenter(
        this.annotationManager.getAnnotations(),
        this.locationManager.getLocations()
      );
    } catch (error) {
      logger.error('Failed to load map data:', error);
    }
  }
  
  updateMapData() {
    if (!this.map || !this.dataLoader) return;
    
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
      
      // Get all annotation IDs, optionally filtered by team
      let annotations = this.annotationManager.getAnnotations();
      const currentTeamId = this.state.getCurrentTeamId();
      if (currentTeamId) {
        annotations = annotations.filter(ann => ann.teamId === currentTeamId);
      }
      const annotationIds = annotations.map(annotation => annotation.id);
      
      if (annotationIds.length === 0) {
        this.showFeedback('No annotations to clear', 2000);
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
