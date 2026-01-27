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
  FeedbackDisplay
} from './map/index.js';

class AdminMap {
  constructor() {
    logger.debug('AdminMap constructor called');
    this.map = null;
    this.locations = [];
    this.teams = [];
    this.currentTeamId = null;
    this.showAnnotations = true;
    this.showLocations = true;
    
    // Initialize components (will be fully initialized after map is created)
    this.mapInitializer = new MapInitializer();
    this.annotationManager = null; // Will be initialized after map is created
    this.menuManager = new MenuManager();
    this.feedbackDisplay = new FeedbackDisplay();
    this.popupManager = null; // Will be initialized after map is created
    this.fanMenu = null; // Will be initialized after map is created
    this.colorMenu = null; // Will be initialized after map is created
    
    // Drawing tools
    this.poiDrawingTool = null;
    this.lineDrawingTool = null;
    this.areaDrawingTool = null;
    this.currentDrawingTool = null;
    
    // UI state
    this.editForm = null;
    this.modalOverlay = null;
    this.pendingAnnotation = null;
    this.currentEditingAnnotation = null;
    this.currentColor = 'green';
    this.currentShape = 'circle';
    
    // Interaction state
    this.longPressTimer = null;
    this.longPressThreshold = INTERACTION_CONFIG.longPressThreshold;
    this.isLongPressing = false;
    
    logger.debug('Calling init() method...');
    this.init();
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
    this.setupEventListeners();
    
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
    try {
      this.teams = await get(API_ENDPOINTS.teams);
      this.populateTeamSelect();
    } catch (error) {
      logger.error('Failed to load teams:', error);
    }
  }
  
  populateTeamSelect() {
    const select = q('#map_team_select');
    if (!select) return;
    
    // Clear existing options except "All Teams"
    select.innerHTML = '<option value="">All Teams</option>';
    
    this.teams.forEach(team => {
      const option = document.createElement('option');
      option.value = team.id;
      option.textContent = team.name;
      select.appendChild(option);
    });
  }
  
  async initializeMap() {
    try {
      // Use MapInitializer to create map
      this.map = await this.mapInitializer.initialize();
      
      // Initialize components that depend on map
      this.annotationManager = new AnnotationManager(this.map);
      this.popupManager = new PopupManager(this.map, this.annotationManager.getAnnotations());
      this.fanMenu = new FanMenu('fan_menu', this.map, this.menuManager);
      this.colorMenu = new ColorMenu('color_menu', this.menuManager);
      
      // Initialize drawing tools
      this.poiDrawingTool = new PoiDrawingTool(this.map);
      this.lineDrawingTool = new LineDrawingTool(this.map, {
        onFinish: (annotationData) => this.handleDrawingFinish(annotationData),
        onCancel: () => this.handleDrawingCancel()
      });
      this.areaDrawingTool = new AreaDrawingTool(this.map, {
        onFinish: (annotationData) => this.handleDrawingFinish(annotationData),
        onCancel: () => this.handleDrawingCancel()
      });
      
      // Wait for map to load
      this.map.on('load', () => {
        this.setupMapSources();
        this.initializeAnnotationUI();
        this.setupMapInteractionHandlers();
        this.setupMapMovementHandlers();
      });
      
    } catch (error) {
      logger.error('Failed to initialize map:', error);
    }
  }
  
  /**
   * Handle drawing tool finish
   */
  async handleDrawingFinish(annotationData) {
    if (!annotationData) return;
    
    annotationData.teamId = this.currentTeamId;
    try {
      await this.annotationManager.createAnnotation(annotationData);
      this.feedbackDisplay.show('Annotation created successfully', 2000);
      this.updateMapData();
    } catch (error) {
      this.feedbackDisplay.show(`Failed to create annotation: ${error.message || 'Unknown error'}`, 5000);
    }
    this.currentDrawingTool = null;
  }
  
  /**
   * Handle drawing tool cancel
   */
  handleDrawingCancel() {
    this.feedbackDisplay.show('Drawing cancelled', 2000);
    this.currentDrawingTool = null;
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
    
    // Generate Canvas-based POI icons for all shape-color combinations
    this.generateCanvasPoiIcons();
    
    // Add annotation sources (only if they don't exist)
    const sources = LAYER_CONFIG.sources;
    const sourceIds = [
      sources.annotationsPoi,
      sources.annotationsLine,
      sources.annotationsArea,
      sources.annotationsPolygon,
      sources.locations
    ];
    
    sourceIds.forEach(sourceId => {
      if (!this.map.getSource(sourceId)) {
        this.map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }
    });
    
    this.addMapLayers();
  }
  
  // Generate Canvas-based POI icons (matching Android app exactly)
  generateCanvasPoiIcons() {
    const shapes = ['circle', 'square', 'triangle', 'exclamation'];
    const colors = ['green', 'yellow', 'red', 'black', 'white'];
    
    shapes.forEach(shape => {
      colors.forEach(color => {
        const iconName = `poi-${shape}-${color}`;
        try {
          // Check if icon already exists to prevent duplicates
          if (this.map.getImage(iconName)) {
            logger.debug(`Icon ${iconName} already exists, skipping`);
            return;
          }
          
          const imageData = this.createCanvasPoiIcon(shape, color);
          this.map.addImage(iconName, imageData);
          logger.debug(`Generated Canvas POI icon: ${iconName}`);
        } catch (error) {
          logger.error(`Failed to create Canvas icon ${iconName}:`, error);
        }
      });
    });
  }
  
  // Create Canvas POI icon (matching Android app exactly)
  createCanvasPoiIcon(shape, color) {
    const size = POI_CONFIG.iconSize;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = POI_CONFIG.iconRadius;
    const colorHex = getColorHex(color);
    
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Set up drawing styles
    ctx.fillStyle = colorHex;
    ctx.strokeStyle = POI_CONFIG.strokeColor;
    ctx.lineWidth = POI_CONFIG.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    switch (shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'square':
        const squareSize = radius * 2;
        const squareOffset = (size - squareSize) / 2;
        ctx.beginPath();
        ctx.rect(squareOffset, squareOffset, squareSize, squareSize);
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'triangle':
        const height = radius * 2;
        const topY = centerY - height / 2;
        const leftX = centerX - radius;
        const leftY = centerY + height / 2;
        const rightX = centerX + radius;
        const rightY = centerY + height / 2;
        
        ctx.beginPath();
        ctx.moveTo(centerX, topY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'exclamation':
        // Triangle base
        const exHeight = radius * 2;
        const exTopY = centerY - exHeight / 2;
        const exLeftX = centerX - radius;
        const exLeftY = centerY + exHeight / 2;
        const exRightX = centerX + radius;
        const exRightY = centerY + exHeight / 2;
        
        // Draw triangle
        ctx.beginPath();
        ctx.moveTo(centerX, exTopY);
        ctx.lineTo(exLeftX, exLeftY);
        ctx.lineTo(exRightX, exRightY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Draw exclamation mark
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 4;
        const exMarkTop = centerY - exHeight / 6;
        const exMarkBottom = centerY + exHeight / 6;
        
        ctx.beginPath();
        ctx.moveTo(centerX, exMarkTop);
        ctx.lineTo(centerX, exMarkBottom);
        ctx.stroke();
        
        // Draw dot
        ctx.fillStyle = '#FFFFFF';
        const dotRadius = 3;
        const dotCenterY = exMarkBottom + dotRadius * 2;
        ctx.beginPath();
        ctx.arc(centerX, dotCenterY, dotRadius, 0, 2 * Math.PI);
        ctx.fill();
        break;
    }
    
    // Convert canvas to ImageData format that MapLibre expects
    return {
      width: size,
      height: size,
      data: ctx.getImageData(0, 0, size, size).data
    };
  }
  
  
  
  addMapLayers() {
    // IMPORTANT: Layer order matters for click handling!
    // Areas and polygons should be at the bottom (rendered first)
    // POIs, lines, and locations should be on top (rendered last)
    
    const layers = LAYER_CONFIG.annotationLayers;
    
    // 1. Areas (fill) - bottom layer
    if (!this.map.getLayer(layers.area)) {
      this.map.addLayer({
        id: layers.area,
        type: 'fill',
        source: LAYER_CONFIG.sources.annotationsArea,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['get', 'fillOpacity']
        }
      });
    }

    // 2. Areas (stroke) - on top of area fill
    if (!this.map.getLayer(layers.areaStroke)) {
      this.map.addLayer({
        id: layers.areaStroke,
        type: 'line',
        source: LAYER_CONFIG.sources.annotationsArea,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'strokeWidth'],
          'line-opacity': 1.0
        }
      });
    }
    
    // 3. Polygons (fill) - on top of areas
    if (!this.map.getLayer(layers.polygon)) {
      this.map.addLayer({
        id: layers.polygon,
        type: 'fill',
        source: LAYER_CONFIG.sources.annotationsPolygon,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.3
        }
      });
    }
    
    // 4. Polygons (stroke) - on top of polygon fill
    if (!this.map.getLayer(layers.polygonStroke)) {
      this.map.addLayer({
        id: layers.polygonStroke,
        type: 'line',
        source: LAYER_CONFIG.sources.annotationsPolygon,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8
        }
      });
    }
    
    // 5. Lines - on top of areas and polygons
    if (!this.map.getLayer(layers.line)) {
      this.map.addLayer({
        id: layers.line,
        type: 'line',
        source: LAYER_CONFIG.sources.annotationsLine,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.8
        }
      });
    }
    
    // 6. POI markers - on top of everything (most important for clicking)
    if (!this.map.getLayer(layers.poi)) {
      this.map.addLayer({
        id: layers.poi,
        type: 'symbol',
        source: LAYER_CONFIG.sources.annotationsPoi,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8, 0.5,   // Very small when zoomed out
            12, 0.8,  // Medium size at mid zoom
            16, 1.2   // Larger when zoomed in
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
          // Removed text-field configuration to avoid glyphs requirement
          // Labels can still be viewed in popups when clicking on annotations
        }
      });
    }
    
    // 7. Location markers - top layer (most important for clicking)
    if (!this.map.getLayer(LAYER_CONFIG.locationLayer)) {
      this.map.addLayer({
        id: LAYER_CONFIG.locationLayer,
        type: 'circle',
        source: LAYER_CONFIG.sources.locations,
        paint: {
          'circle-radius': 5, // Match Android app size
          'circle-color': [
            'case',
            ['get', 'isStale'], '#BDBDBD', // Gray for stale locations
            ['==', ['get', 'user_status'], 'RED'], '#F44336',
            ['==', ['get', 'user_status'], 'YELLOW'], '#FFC107',
            ['==', ['get', 'user_status'], 'BLUE'], '#2196F3',
            ['==', ['get', 'user_status'], 'ORANGE'], '#FF9800',
            ['==', ['get', 'user_status'], 'VIOLET'], '#9C27B0',
            ['==', ['get', 'user_status'], 'GREEN'], '#4CAF50',
            '#4CAF50' // Default green
          ],
          'circle-stroke-width': 3, // Match Android app stroke width
          'circle-stroke-color': [
            'case',
            ['get', 'isStale'], [
              'case',
              ['==', ['get', 'user_status'], 'RED'], '#F44336',
              ['==', ['get', 'user_status'], 'YELLOW'], '#FFC107',
              ['==', ['get', 'user_status'], 'BLUE'], '#2196F3',
              ['==', ['get', 'user_status'], 'ORANGE'], '#FF9800',
              ['==', ['get', 'user_status'], 'VIOLET'], '#9C27B0',
              ['==', ['get', 'user_status'], 'GREEN'], '#4CAF50',
              '#4CAF50' // Default green
            ],
            '#FFFFFF' // White for fresh locations
          ]
        },
        filter: ['>=', ['zoom'], DISPLAY_CONFIG.minLocationZoomLevel] // Only show at zoom level 7+ (match Android app)
      });
    }
    
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
    
    if (!this.map) {
      logger.error('Map not initialized, cannot setup interaction handlers');
      return;
    }
    
    // Long press detection for annotation creation
    let longPressTimer = null;
    let longPressTriggered = false;
    let longPressEvent = null;
    
    this.map.on('mousedown', (e) => {
      // Only handle if not clicking on existing annotations or UI elements
      if (e.originalEvent.target.closest('.maplibregl-popup') || 
          e.originalEvent.target.closest('.fan-menu') ||
          e.originalEvent.target.closest('.color-menu') ||
          e.originalEvent.target.closest('.annotation-edit-form') ||
          e.originalEvent.target.closest('.modal-overlay')) {
        return;
      }
      
      longPressTriggered = false;
      
      longPressTimer = setTimeout(() => {
        logger.debug('Long press detected, showing fan menu');
        longPressTriggered = true;
        longPressEvent = e; // Store the event that triggered the long press
        this.showFanMenu(e.point);
        this.showFeedback('Long press detected - choose annotation type');
      }, this.longPressThreshold);
    });
    
    this.map.on('mouseup', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      
      // If long press was triggered, prevent the click event from dismissing the menu
      if (longPressTriggered) {
        logger.debug('Long press completed, preventing click dismissal');
        // Mark this specific event as handled to prevent click-outside dismissal
        e.originalEvent._longPressHandled = true;
        e._longPressHandled = true; // Also mark the main event
        longPressTriggered = false;
        longPressEvent = null;
      }
    });
    
    this.map.on('mouseleave', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressTriggered = false;
      longPressEvent = null;
    });
    
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
  
  startLongPress(e) {
    // Store the original event for later use
    this.longPressStartEvent = e;
    
    logger.debug('Starting long press detection at:', e.point);
    
    this.longPressTimer = setTimeout(() => {
      this.isLongPressing = true;
      console.log('Long press detected, showing fan menu');
      this.showFanMenu(e.point);
      this.showFeedback('Long press detected - choose annotation type');
    }, this.longPressThreshold);
  }
  
  endLongPress(e) {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      logger.debug('Long press cancelled');
    }
    
    if (this.isLongPressing) {
      this.isLongPressing = false;
      logger.debug('Long press completed');
      // Long press was handled by fan menu - prevent default click behavior
      e.preventDefault();
      return false;
    }
    
    // Regular click - allow normal map behavior
    logger.debug('Regular click detected');
    return true;
  }
  
  cancelLongPress() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.isLongPressing = false;
    this.longPressStartEvent = null;
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
    
    // Clear existing segments but keep center hole
    const centerHole = this.fanMenu.querySelector('.fan-menu-center');
    const existingSegments = this.fanMenu.querySelector('.fan-menu-segments-container');
    
    this.fanMenu.innerHTML = '';
    if (centerHole) {
      this.fanMenu.appendChild(centerHole);
    }
    if (existingSegments) {
      existingSegments.remove();
    }
    
    // Get map coordinates for center text
    const lngLat = this.map.unproject(point);
    this.pendingAnnotation = lngLat;
    
    // Update center text with coordinates
    this.updateFanMenuCenterText(lngLat);
    
    // Define options based on mode
    const options = isEditMode ? this.getEditModeOptions() : this.getCreateModeOptions();
    
    // Position fan menu at click point relative to map container
    this.fanMenu.style.left = (point.x - 100) + 'px'; // Center the donut ring (200px diameter)
    this.fanMenu.style.top = (point.y - 100) + 'px';
    this.fanMenu.style.position = 'absolute';
    
    // Create donut ring segments
    this.createDonutRingSegments(options, point);
    
    // Show fan menu
    this.fanMenu.classList.add('visible');
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
  
  getEditModeOptions() {
    return [
      { type: 'edit', iconClass: 'edit', label: 'Edit' },
      { type: 'delete', iconClass: 'delete', label: 'Delete' }
    ];
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
    
    this.fanMenu.appendChild(svgContainer);
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
      this.fanMenu.classList.remove('visible');
      // Clear segments but keep center hole structure
      const centerHole = this.fanMenu.querySelector('.fan-menu-center');
      const segmentsContainer = this.fanMenu.querySelector('.fan-menu-segments-container');
      
      this.fanMenu.innerHTML = '';
      if (centerHole) {
        this.fanMenu.appendChild(centerHole);
      }
      if (segmentsContainer) {
        segmentsContainer.remove();
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
      if (this.fanMenu && !this.fanMenu.contains(e.target)) {
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
      this.currentShape = optionType;
      this.showColorMenu(point, 'poi');
    } else if (optionType === 'area') {
      // Show color menu for area (two-step flow)
      this.currentShape = 'area';
      this.showColorMenu(point, 'area');
    } else if (optionType === 'line') {
      // Show color menu for line (two-step flow)
      this.currentShape = 'line';
      this.showColorMenu(point, 'line');
    } else if (optionType === 'edit') {
      // Handle edit mode
      this.handleEditAnnotation();
    } else if (optionType === 'delete') {
      // Handle delete mode
      this.handleDeleteAnnotation();
    }
  }
  
  handleEditAnnotation() {
    // This would be called when editing an existing annotation
    // For now, just show feedback
    this.showFeedback('Edit functionality not yet implemented', 3000);
  }
  
  handleDeleteAnnotation() {
    // This would be called when deleting an existing annotation
    // For now, just show feedback
    this.showFeedback('Delete functionality not yet implemented', 3000);
  }
  
  showColorMenu(point, annotationType) {
    if (!this.colorMenu) return;
    
    this.colorMenu.show(point, annotationType, (color, annotationType) => {
      this.handleColorSelection(color, annotationType);
    });
  }
  
  hideColorMenu() {
    if (this.colorMenu) {
      this.colorMenu.hide();
    }
  }
  
  handleColorSelection(color, annotationType) {
    if (this.colorMenu) {
      this.colorMenu.hide();
    }
    this.currentColor = color;
    
    if (annotationType === 'poi') {
      this.createPOI();
    } else if (annotationType === 'area') {
      this.startAreaDrawing();
    } else if (annotationType === 'line') {
      this.startLineDrawing();
    }
  }
  
  createPOI() {
    if (!this.pendingAnnotation) {
      this.showFeedback('No location selected', 3000);
      return;
    }
    
    if (!this.poiDrawingTool) return;
    
    const annotationData = this.poiDrawingTool.createPOI(
      this.pendingAnnotation,
      this.currentColor,
      this.currentShape
    );
    
    annotationData.teamId = this.currentTeamId;
    this.createAnnotation(annotationData);
    this.pendingAnnotation = null;
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
    
    this.currentEditingAnnotation = annotation;
    this.showEditForm(annotation);
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
    this.currentEditingAnnotation = null;
  }
  
  async saveAnnotationEdit() {
    if (!this.currentEditingAnnotation) return;
    
    const editForm = q('#edit_annotation_form');
    if (!editForm) return;
    const formData = new FormData(editForm);
    const updateData = {
      label: formData.get('label') || '',
      color: formData.get('color') || 'green'
    };
    
    // Add type-specific fields
    if (this.currentEditingAnnotation.type === 'poi') {
      updateData.shape = formData.get('shape') || 'circle';
    } else if (this.currentEditingAnnotation.type === 'area') {
      updateData.radius = parseFloat(formData.get('radius')) || 100;
    }
    
    if (!this.annotationManager) return;
    try {
      await this.annotationManager.updateAnnotation(this.currentEditingAnnotation.id, updateData);
      this.showFeedback('Annotation updated successfully', 2000);
      this.updateMapData();
      this.hideEditForm();
    } catch (error) {
      logger.error('Failed to update annotation:', error);
      this.showFeedback(`Failed to update annotation: ${error.message || 'Unknown error'}`, 5000);
    }
  }
  
  async deleteCurrentAnnotation() {
    if (!this.currentEditingAnnotation) return;
    
    if (confirm('Are you sure you want to delete this annotation?')) {
      await this.deleteAnnotationById(this.currentEditingAnnotation.id);
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
    } catch (error) {
      logger.error('Failed to delete annotation:', error);
      this.showFeedback(`Failed to delete annotation: ${error.message || 'Unknown error'}`, 5000);
    }
  }
  
  
  startLineDrawing() {
    if (!this.pendingAnnotation || !this.lineDrawingTool) {
      this.showFeedback('No location selected', 3000);
      return;
    }
    
    this.currentDrawingTool = this.lineDrawingTool;
    this.lineDrawingTool.start(this.pendingAnnotation, this.currentColor);
    this.pendingAnnotation = null;
    
    this.showFeedback('Click to add more points, use check mark to finish or X to cancel', 5000);
  }
  
  
  async createAnnotation(annotationData) {
    if (!this.annotationManager) return;
    try {
      await this.annotationManager.createAnnotation(annotationData);
      this.showFeedback('Annotation created successfully', 2000);
      this.updateMapData();
    } catch (error) {
      logger.error('Failed to create annotation:', error);
      this.showFeedback(`Failed to create annotation: ${error.message || 'Unknown error'}`, 5000);
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
  
  
  setupEventListeners() {
    // Team selection
    const teamSelect = document.getElementById('map_team_select');
    if (teamSelect) {
      teamSelect.addEventListener('change', (e) => {
        this.currentTeamId = e.target.value || null;
        this.loadMapData();
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
        this.centerMap();
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
      showAnnotations.addEventListener('change', (e) => {
        this.showAnnotations = e.target.checked;
        this.updateLayerVisibility();
      });
    }
    
    const showLocations = q('#map_show_locations');
    if (showLocations) {
      showLocations.addEventListener('change', (e) => {
        this.showLocations = e.target.checked;
        this.updateLayerVisibility();
      });
    }
    
    // Setup WebSocket listeners for real-time updates
    this.setupWebSocketListeners();
  }
  
  setupWebSocketListeners() {
    // Listen for global socket events
    document.addEventListener('socketConnected', () => {
      this.connectToWebSocket();
    });
    
    document.addEventListener('socketDisconnected', () => {
      this.disconnectFromWebSocket();
    });
    
    // If socket is already connected, set up listeners immediately
    if (window.socket && window.socket.connected) {
      this.connectToWebSocket();
    }
  }
  
  connectToWebSocket() {
    if (!window.socket) return;
    
    logger.debug('Setting up map WebSocket listeners...');
    
    // Listen for annotation updates
    window.socket.on('admin:annotation_update', (data) => {
      logger.debug('Received annotation update:', data);
      this.handleAnnotationUpdate(data);
    });
    
    // Listen for annotation deletions
    window.socket.on('admin:annotation_delete', (data) => {
      logger.debug('Received annotation deletion:', data);
      this.handleAnnotationDelete(data);
    });
    
    // Listen for bulk annotation deletions
    window.socket.on('admin:annotation_bulk_delete', (data) => {
      logger.debug('Received bulk annotation deletion:', data);
      this.handleBulkAnnotationDelete(data);
    });
    
    // Listen for location updates
    window.socket.on('admin:location_update', (data) => {
      logger.debug('Received location update:', data);
      this.handleLocationUpdate(data);
    });
    
    // Listen for sync activity that might affect map data
    window.socket.on('admin:sync_activity', (data) => {
      if (data.type === 'annotation_update' || data.type === 'annotation_delete' || data.type === 'annotation_bulk_delete' || data.type === 'location_update') {
        logger.debug('Sync activity affecting map:', data);
        // Refresh map data after a short delay to allow server to process
        setTimeout(() => {
          this.loadMapData();
        }, TIMING.syncActivityRefreshDelay);
      }
    });
  }
  
  disconnectFromWebSocket() {
    if (!window.socket) return;
    
    logger.debug('Disconnecting map WebSocket listeners...');
    
    // Remove specific listeners
    window.socket.off('admin:annotation_update');
    window.socket.off('admin:annotation_delete');
    window.socket.off('admin:annotation_bulk_delete');
    window.socket.off('admin:location_update');
    window.socket.off('admin:sync_activity');
  }
  
  handleAnnotationUpdate(data) {
    if (!this.annotationManager) return;
    
    // Check if this annotation is relevant to current view
    if (this.currentTeamId && data.teamId !== this.currentTeamId) {
      return; // Not relevant to current team filter
    }
    
    // Add or update annotation in local data
    const existingIndex = this.annotationManager.getAnnotations().findIndex(a => a.id === data.id);
    if (existingIndex >= 0) {
      this.annotationManager.getAnnotations()[existingIndex] = data;
    } else {
      this.annotationManager.getAnnotations().unshift(data); // Add to beginning
    }
    
    // Update map immediately
    this.updateMapData();
    
    logger.debug(`Updated annotation ${data.id} on map`);
  }

  handleAnnotationDelete(data) {
    if (!this.annotationManager) return;
    
    // Check if this annotation is relevant to current view
    if (this.currentTeamId && data.teamId !== this.currentTeamId) {
      return; // Not relevant to current team filter
    }
    
    // Remove annotation from local data
    const annotations = this.annotationManager.getAnnotations();
    const existingIndex = annotations.findIndex(a => a.id === data.annotationId);
    if (existingIndex >= 0) {
      annotations.splice(existingIndex, 1);
      logger.debug(`Removed annotation ${data.annotationId} from map`);
    } else {
      logger.debug(`Annotation ${data.annotationId} not found in local data`);
    }
    
    // Update map immediately
    this.updateMapData();
  }

  handleBulkAnnotationDelete(data) {
    if (!this.annotationManager) return;
    
    // Check if this deletion is relevant to current view
    if (this.currentTeamId && data.teamId !== this.currentTeamId) {
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
  }
  
  handleLocationUpdate(data) {
    // Check if this location is relevant to current view
    if (this.currentTeamId && data.teamId !== this.currentTeamId) {
      return; // Not relevant to current team filter
    }
    
    // Add or update location in local data
    const existingIndex = this.locations.findIndex(l => l.user_id === data.userId);
    if (existingIndex >= 0) {
      // Update existing location
      this.locations[existingIndex] = {
        ...this.locations[existingIndex],
        latitude: data.latitude,
        longitude: data.longitude,
        altitude: data.altitude,
        accuracy: data.accuracy,
        timestamp: data.timestamp
      };
    } else {
      // Add new location with user info from the event data
      const newLocation = {
        id: `temp-${data.userId}-${Date.now()}`, // Temporary ID for new locations
        user_id: data.userId,
        team_id: data.teamId,
        latitude: data.latitude,
        longitude: data.longitude,
        altitude: data.altitude,
        accuracy: data.accuracy,
        timestamp: data.timestamp,
        created_at: new Date().toISOString(),
        user_name: data.user_name || 'Unknown User',
        user_email: data.user_email || 'unknown@example.com',
        user_status: data.user_status || 'GREEN'
      };
      this.locations.unshift(newLocation); // Add to beginning of array
    }
    
    // Update map immediately
    this.updateMapData();
    
    logger.debug(`Updated location for user ${data.userId} on map`);
  }
  
  updateLayerVisibility() {
    if (!this.map) return;
    
    const layers = LAYER_CONFIG.annotationLayers;
    const visibility = this.showAnnotations ? 'visible' : 'none';
    this.map.setLayoutProperty(layers.poi, 'visibility', visibility);
    this.map.setLayoutProperty(layers.line, 'visibility', visibility);
    this.map.setLayoutProperty(layers.area, 'visibility', visibility);
    this.map.setLayoutProperty(layers.polygon, 'visibility', visibility);
    this.map.setLayoutProperty(layers.polygonStroke, 'visibility', visibility);
    
    const locationVisibility = this.showLocations ? 'visible' : 'none';
    this.map.setLayoutProperty(LAYER_CONFIG.locationLayer, 'visibility', locationVisibility);
  }
  
  async loadMapData() {
    if (!this.map) return;
    
    // Ensure map sources are set up
    if (!this.map.getSource('annotations-poi')) {
      console.log('Map sources not ready, setting up...');
      this.setupMapSources();
    }
    
    console.log('Loading map data...');
    await Promise.all([
      this.loadAnnotations(),
      this.loadLocations()
    ]);
    
    this.updateMapData();
    
    // Try to center map on user location or existing data after loading
    this.autoCenterMap();
  }
  
  async loadAnnotations() {
    if (!this.annotationManager) return;
    await this.annotationManager.loadAnnotations(this.currentTeamId);
    // Update popup manager with new annotations
    if (this.popupManager) {
      this.popupManager.setAnnotations(this.annotationManager.getAnnotations());
    }
  }
  
  async loadLocations() {
    try {
      // If no team is selected, load locations from all teams by using the regular locations endpoint
      if (!this.currentTeamId) {
        const params = new URLSearchParams();
        params.append('limit', DATA_LIMITS.maxLocations.toString());
        
        const url = `${API_ENDPOINTS.locations}?${params}`;
        logger.debug(`Loading locations from: ${url}`);
        
        this.locations = await get(url);
        logger.info(`Loaded ${this.locations.length} locations from all teams`);
      } else {
        // Use the latest endpoint for specific team
        const params = new URLSearchParams();
        params.append('teamId', this.currentTeamId);
        
        const url = `${API_ENDPOINTS.locationsLatest}?${params}`;
        logger.debug(`Loading latest locations from: ${url}`);
        
        this.locations = await get(url);
        logger.info(`Loaded ${this.locations.length} latest locations for team ${this.currentTeamId}`);
      }
    } catch (error) {
      logger.error('Failed to load locations:', error);
      this.locations = [];
    }
  }
  
  updateMapData() {
    if (!this.map || !this.annotationManager) return;
    
    // Update annotations on map
    this.annotationManager.updateMap();
    
    // Update locations on map
    this.updateLocationsOnMap();
    
    // Update popup manager with current annotations
    if (this.popupManager) {
      this.popupManager.setAnnotations(this.annotationManager.getAnnotations());
    }
  }
  
  /**
   * Update locations on map
   */
  updateLocationsOnMap() {
    if (!this.map) return;
    
    const now = Date.now();
    const stalenessThresholdMs = DISPLAY_CONFIG.stalenessThresholdMs;
    
    const locationFeatures = this.locations
      .map(location => {
        const locationCoords = extractCoordinates(location);
        if (!locationCoords) {
          logger.warn('Skipping location with invalid coordinates:', {
            id: location.id,
            user_id: location.user_id,
            latitude: location.latitude,
            longitude: location.longitude
          });
          return null;
        }
        
        const locationAge = now - new Date(location.timestamp).getTime();
        const isStale = locationAge > stalenessThresholdMs;
        
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: locationCoords
          },
          properties: {
            id: location.id,
            user_id: location.user_id,
            user_name: location.user_name,
            user_email: location.user_email,
            latitude: location.latitude,
            longitude: location.longitude,
            altitude: location.altitude,
            accuracy: location.accuracy,
            timestamp: location.timestamp,
            user_status: location.user_status || 'GREEN',
            isStale: isStale,
            ageMinutes: Math.round(locationAge / (60 * 1000))
          }
        };
      })
      .filter(feature => feature !== null);
    
    if (this.map.getSource(LAYER_CONFIG.sources.locations)) {
      this.map.getSource(LAYER_CONFIG.sources.locations).setData({
        type: 'FeatureCollection',
        features: locationFeatures
      });
    }
    
    logger.debug(`Updated map with ${locationFeatures.length} locations`);
  }
  
  
  // Auto-center map based on user location or existing data
  async autoCenterMap() {
    if (!this.map) return;
    
    // First try to get user's current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          logger.debug('Centering map on user location:', latitude, longitude);
          this.map.flyTo({
            center: [longitude, latitude],
            zoom: DISPLAY_CONFIG.userLocationZoom,
            duration: 1000
          });
        },
        (error) => {
          // Only log non-permission errors to reduce noise
          if (error.code !== error.PERMISSION_DENIED) {
            logger.debug('Geolocation failed:', error.message);
          }
          // Fall back to centering on existing data
          this.centerMapOnData();
        },
        {
          enableHighAccuracy: true,
          timeout: TIMING.geolocationTimeout,
          maximumAge: TIMING.geolocationMaxAge
        }
      );
    } else {
      logger.debug('Geolocation not supported');
      // Fall back to centering on existing data
      this.centerMapOnData();
    }
  }
  

  // Center map on existing annotations and locations
  centerMapOnData() {
    if (!this.map) return;
    
    if (!this.annotationManager) return;
    
    // Calculate bounds of all features
    const allFeatures = [];
    
    // Add annotation features
    this.annotationManager.getAnnotations().forEach(annotation => {
      const data = annotation.data;
      switch (annotation.type) {
        case 'poi':
          const poiCoords = extractCoordinates(data.position);
          if (poiCoords) {
            allFeatures.push(poiCoords);
          }
          break;
        case 'line':
          if (data.points && Array.isArray(data.points)) {
            data.points.forEach(p => {
              const lineCoords = extractCoordinates(p);
              if (lineCoords) {
                allFeatures.push(lineCoords);
              }
            });
          }
          break;
        case 'area':
          const areaCoords = extractCoordinates(data.center);
          if (areaCoords) {
            allFeatures.push(areaCoords);
          }
          break;
        case 'polygon':
          if (data.points && Array.isArray(data.points)) {
            data.points.forEach(p => {
              const polyCoords = extractCoordinates(p);
              if (polyCoords) {
                allFeatures.push(polyCoords);
              }
            });
          }
          break;
      }
    });
    
    // Add location features
    this.locations.forEach(location => {
      const locCoords = extractCoordinates(location);
      if (locCoords) {
        allFeatures.push(locCoords);
      }
    });
    
    if (allFeatures.length > 0) {
      try {
        const bounds = allFeatures.reduce((bounds, coord) => {
          return bounds.extend(coord);
        }, new maplibregl.LngLatBounds(allFeatures[0], allFeatures[0]));
        
        this.map.fitBounds(bounds, { padding: DISPLAY_CONFIG.fitBoundsPadding, duration: 1000 });
        logger.debug(`Centered map on ${allFeatures.length} valid coordinates`);
      } catch (error) {
        logger.error('Error centering map on data:', error);
        logger.debug('Problematic coordinates:', allFeatures.slice(0, 5)); // Log first 5 for debugging
        // Fall back to default center
        this.map.flyTo({ center: DISPLAY_CONFIG.defaultCenter, zoom: DISPLAY_CONFIG.defaultZoom, duration: 1000 });
        logger.debug('Fell back to default US center due to bounds error');
      }
    } else {
      // Default to US center if no data
      this.map.flyTo({ center: DISPLAY_CONFIG.defaultCenter, zoom: DISPLAY_CONFIG.defaultZoom, duration: 1000 });
      logger.debug('No valid coordinates found, using default US center');
    }
  }
  
  
  centerMap() {
    this.centerMapOnData();
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
      
      // Get all annotation IDs
      const annotationIds = this.annotationManager.getAnnotations().map(annotation => annotation.id);
      
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
      this.closeAllPopups();
    } catch (error) {
      logger.error('Failed to clear annotations:', error);
      this.showFeedback(`Failed to clear annotations: ${error.message || 'Unknown error'}`, 5000);
    }
  }
  
  
  // Cleanup method to prevent memory leaks
  cleanup() {
    // Disconnect WebSocket listeners
    this.disconnectFromWebSocket();
    
    // Close any open popups
    this.closeAllPopups();
    
    // Hide any open menus
    this.hideFanMenu();
    this.hideColorMenu();
    this.hideEditForm();
    
    // Clean up drawing tools
    if (this.currentDrawingTool) {
      this.currentDrawingTool.cancel();
      this.currentDrawingTool = null;
    }
    
    // Clean up menu manager
    if (this.menuManager) {
      this.menuManager.cleanupAll();
    }
    
    // Clear any timers
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
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
