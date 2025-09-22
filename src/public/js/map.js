// Map functionality for TAK Lite Admin Dashboard
class AdminMap {
  constructor() {
    console.log('AdminMap constructor called');
    this.map = null;
    this.annotations = [];
    this.locations = [];
    this.teams = [];
    this.currentTeamId = null;
    this.showAnnotations = true;
    this.showLocations = true;
    this.annotationSources = {};
    this.locationSources = {};
    this.currentPopup = null;
    this.ageUpdateInterval = null;
    
    // Annotation management state
    this.isEditingMode = false;
    this.pendingAnnotation = null;
    this.fanMenu = null;
    this.colorMenu = null;
    this.editForm = null;
    this.modalOverlay = null;
    this.feedback = null;
    this.longPressTimer = null;
    this.longPressThreshold = 500; // ms
    this.isLongPressing = false;
    this.tempLinePoints = [];
    this.tempAreaCenter = null;
    this.tempAreaRadius = 0;
    this.tempAreaRadiusPixels = 0;
    this.currentColor = 'green';
    this.currentShape = 'circle';
    
    console.log('Calling init() method...');
    this.init();
  }
  
  async init() {
    console.log('AdminMap init() method called');
    // Wait for MapLibre to load
    if (typeof maplibregl === 'undefined') {
      console.log('MapLibre not ready, retrying in 100ms...');
      setTimeout(() => this.init(), 100);
      return;
    }
    
    console.log('Initializing admin map...');
    await this.initializeMap();
    this.setupEventListeners();
    
    // Only load data if we have authentication
    if (this.isAuthenticated()) {
      console.log('User is authenticated, loading data...');
      await this.loadTeams();
      await this.loadMapData();
    } else {
      console.log('Not authenticated yet, waiting for login...');
      // Wait for authentication
      this.waitForAuthentication();
    }
  }
  
  isAuthenticated() {
    const token = localStorage.getItem('taklite:token');
    return token && token.length > 0;
  }
  
  async waitForAuthentication() {
    // Check every 500ms for authentication
    const checkAuth = () => {
      if (this.isAuthenticated()) {
        console.log('Authentication detected, loading map data...');
        this.loadTeams().then(() => this.loadMapData());
      } else {
        setTimeout(checkAuth, 500);
      }
    };
    checkAuth();
  }
  
  async loadTeams() {
    try {
      const token = localStorage.getItem('taklite:token');
      const response = await fetch('/api/admin/teams', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        this.teams = await response.json();
        this.populateTeamSelect();
      } else {
        console.error('Failed to load teams:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to load teams:', error);
    }
  }
  
  populateTeamSelect() {
    const select = document.getElementById('map_team_select');
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
    const container = document.getElementById('map_container');
    if (!container) {
      console.error('Map container not found');
      return;
    }
    
    console.log('Map container found, initializing map...');
    console.log('Map container dimensions:', {
      width: container.offsetWidth,
      height: container.offsetHeight,
      clientWidth: container.clientWidth,
      clientHeight: container.clientHeight
    });
    
    // Check if container is visible
    const containerStyle = window.getComputedStyle(container);
    console.log('Map container visibility:', {
      display: containerStyle.display,
      visibility: containerStyle.visibility,
      opacity: containerStyle.opacity,
      position: containerStyle.position
    });
    
    // Remove loading text but preserve annotation UI elements
    const fanMenu = container.querySelector('#fan_menu');
    const colorMenu = container.querySelector('#color_menu');
    const feedback = container.querySelector('#map_feedback');
    
    container.innerHTML = '';
    
    // Restore annotation UI elements
    if (fanMenu) container.appendChild(fanMenu);
    if (colorMenu) container.appendChild(colorMenu);
    if (feedback) container.appendChild(feedback);
    
    // Dark mode style configuration (matching Android app)
    const darkStyle = {
      version: 8,
      name: 'Dark',
      sources: {
        'osm': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm',
          paint: {
            'raster-opacity': 0.7
          }
        }
      ]
      // Removed glyphs configuration to prevent 404 errors from fonts.openmaptiles.org
      // Since this is a simple raster style, custom fonts are not needed
    };
    
    try {
      this.map = new maplibregl.Map({
        container: 'map_container',
        style: darkStyle,
        center: [0, 0], // Default center, will be updated based on data or user location
        zoom: 2,
        attributionControl: false
      });
      
      console.log('Map instance created:', this.map);
      
      // Map loaded successfully
      
      // Add navigation controls
      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
      
      // Add fullscreen control
      this.map.addControl(new maplibregl.FullscreenControl(), 'top-right');
      
      // Wait for map to load
      this.map.on('load', () => {
        console.log('Map loaded successfully');
        console.log('Map dimensions after load:', {
          width: this.map.getContainer().offsetWidth,
          height: this.map.getContainer().offsetHeight
        });
        
        // Check if map canvas exists
        const canvas = this.map.getCanvas();
        console.log('Map canvas:', canvas);
        console.log('Canvas dimensions:', {
          width: canvas.width,
          height: canvas.height,
          offsetWidth: canvas.offsetWidth,
          offsetHeight: canvas.offsetHeight
        });
        
        // Canvas click test removed to avoid conflicts
        
        // Test if canvas is interactive
        canvas.style.pointerEvents = 'auto';
        console.log('Canvas pointer events set to auto');
        
        // Check for any overlaying elements
        const container = this.map.getContainer();
        const elements = container.querySelectorAll('*');
        console.log('Elements in map container:', elements.length);
        elements.forEach((el, i) => {
          if (i < 5) { // Only log first 5 elements
            const style = window.getComputedStyle(el);
            console.log(`Element ${i}:`, {
              tagName: el.tagName,
              className: el.className,
              pointerEvents: style.pointerEvents,
              position: style.position,
              zIndex: style.zIndex
            });
          }
        });
        
        // Ensure map is properly sized
        this.map.resize();
        
        this.setupMapSources();
        // Initialize annotation UI after map is loaded and DOM is ready
        this.initializeAnnotationUI();
        // Setup interaction handlers after map is loaded
        this.setupMapInteractionHandlers();
      });
      
      this.map.on('error', (e) => {
        console.error('Map error:', e);
      });
      
      // Add basic interaction test
      this.map.on('click', (e) => {
        console.log('Map clicked at:', e.lngLat);
      });
      
      
      // Test if map is interactive (simplified)
      this.map.on('mousemove', (e) => {
        // Only log occasionally to avoid spam
        if (Math.random() < 0.01) {
          console.log('Map mousemove:', e.lngLat);
        }
      });
      
    } catch (error) {
      console.error('Failed to create map:', error);
    }
  }
  
  initializeAnnotationUI() {
    console.log('Initializing annotation UI...');
    console.log('Document ready state:', document.readyState);
    
    // Get references to UI elements
    this.fanMenu = document.getElementById('fan_menu');
    this.colorMenu = document.getElementById('color_menu');
    this.editForm = document.getElementById('annotation_edit_form');
    this.modalOverlay = document.getElementById('modal_overlay');
    this.feedback = document.getElementById('map_feedback');
    
    console.log('Annotation UI elements found:');
    console.log('fanMenu:', this.fanMenu);
    console.log('colorMenu:', this.colorMenu);
    console.log('editForm:', this.editForm);
    console.log('modalOverlay:', this.modalOverlay);
    console.log('feedback:', this.feedback);
    
    // Elements should now be found since they're preserved during map initialization
    
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
      console.log('Map style not loaded yet, waiting...');
      this.map.once('styledata', () => {
        this.setupMapSources();
      });
      return;
    }
    
    // Generate Canvas-based POI icons for all shape-color combinations
    this.generateCanvasPoiIcons();
    
    // Add annotation sources (only if they don't exist)
    if (!this.map.getSource('annotations-poi')) {
      this.map.addSource('annotations-poi', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    
    if (!this.map.getSource('annotations-line')) {
      this.map.addSource('annotations-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    
    if (!this.map.getSource('annotations-area')) {
      this.map.addSource('annotations-area', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    
    if (!this.map.getSource('annotations-polygon')) {
      this.map.addSource('annotations-polygon', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    
    // Add location source
    if (!this.map.getSource('locations')) {
      this.map.addSource('locations', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    
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
            console.log(`Icon ${iconName} already exists, skipping`);
            return;
          }
          
          const imageData = this.createCanvasPoiIcon(shape, color);
          this.map.addImage(iconName, imageData);
          console.log(`Generated Canvas POI icon: ${iconName}`);
        } catch (error) {
          console.error(`Failed to create Canvas icon ${iconName}:`, error);
        }
      });
    });
  }
  
  // Create Canvas POI icon (matching Android app exactly)
  createCanvasPoiIcon(shape, color) {
    const size = 32; // Smaller size for better performance and visibility
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 3; // Match Android radius calculation
    const colorHex = this.getColorHex(color);
    
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Set up drawing styles
    ctx.fillStyle = colorHex;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
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
    
    // 1. Areas (fill) - bottom layer
    if (!this.map.getLayer('annotations-area')) {
      this.map.addLayer({
        id: 'annotations-area',
        type: 'fill',
        source: 'annotations-area',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['get', 'fillOpacity']
        }
      });
    }

    // 2. Areas (stroke) - on top of area fill
    if (!this.map.getLayer('annotations-area-stroke')) {
      this.map.addLayer({
        id: 'annotations-area-stroke',
        type: 'line',
        source: 'annotations-area',
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
    if (!this.map.getLayer('annotations-polygon')) {
      this.map.addLayer({
        id: 'annotations-polygon',
        type: 'fill',
        source: 'annotations-polygon',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.3
        }
      });
    }
    
    // 4. Polygons (stroke) - on top of polygon fill
    if (!this.map.getLayer('annotations-polygon-stroke')) {
      this.map.addLayer({
        id: 'annotations-polygon-stroke',
        type: 'line',
        source: 'annotations-polygon',
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
    if (!this.map.getLayer('annotations-line')) {
      this.map.addLayer({
        id: 'annotations-line',
        type: 'line',
        source: 'annotations-line',
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
    if (!this.map.getLayer('annotations-poi')) {
      this.map.addLayer({
        id: 'annotations-poi',
        type: 'symbol',
        source: 'annotations-poi',
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
    if (!this.map.getLayer('locations')) {
      this.map.addLayer({
        id: 'locations',
        type: 'circle',
        source: 'locations',
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
        filter: ['>=', ['zoom'], 7] // Only show at zoom level 7+ (match Android app)
      });
    }
    
    // Add click handlers
    this.setupClickHandlers();
  }
  
  setupClickHandlers() {
    console.log('Setting up click handlers...');
    
    // POI click handler (symbol layer) - single click for popup
    this.map.on('click', 'annotations-poi', (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Line click handler
    this.map.on('click', 'annotations-line', (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Area click handler
    this.map.on('click', 'annotations-area', (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Polygon click handler
    this.map.on('click', 'annotations-polygon', (e) => {
      const feature = e.features[0];
      this.showAnnotationPopup(feature, e.lngLat);
    });
    
    // Location click handler
    this.map.on('click', 'locations', (e) => {
      const feature = e.features[0];
      this.showLocationPopup(feature, e.lngLat);
    });
    
    // Change cursor on hover for all layers
    const layers = ['annotations-poi', 'annotations-line', 'annotations-area', 'annotations-polygon', 'locations'];
    layers.forEach(layerId => {
      this.map.on('mouseenter', layerId, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', layerId, () => {
        this.map.getCanvas().style.cursor = '';
      });
    });
  }
  
  setupMapInteractionHandlers() {
    console.log('Setting up map interaction handlers...');
    
    if (!this.map) {
      console.error('Map not initialized, cannot setup interaction handlers');
      return;
    }
    
    // Simple long press detection for annotation creation
    let longPressTimer = null;
    
    this.map.on('mousedown', (e) => {
      // Only handle if not clicking on existing annotations or UI elements
      if (e.originalEvent.target.closest('.maplibregl-popup') || 
          e.originalEvent.target.closest('.fan-menu') ||
          e.originalEvent.target.closest('.color-menu') ||
          e.originalEvent.target.closest('.annotation-edit-form') ||
          e.originalEvent.target.closest('.modal-overlay')) {
        return;
      }
      
      longPressTimer = setTimeout(() => {
        console.log('Long press detected, showing fan menu');
        this.showFanMenu(e.point);
        this.showFeedback('Long press detected - choose annotation type');
      }, this.longPressThreshold);
    });
    
    this.map.on('mouseup', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    this.map.on('mouseleave', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    console.log('Map interaction handlers setup complete');
  }
  
  startLongPress(e) {
    // Store the original event for later use
    this.longPressStartEvent = e;
    
    console.log('Starting long press detection at:', e.point);
    
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
      console.log('Long press cancelled');
    }
    
    if (this.isLongPressing) {
      this.isLongPressing = false;
      console.log('Long press completed');
      // Long press was handled by fan menu - prevent default click behavior
      e.preventDefault();
      return false;
    }
    
    // Regular click - allow normal map behavior
    console.log('Regular click detected');
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
    if (!this.feedback) return;
    
    this.feedback.textContent = message;
    this.feedback.classList.add('visible');
    
    // Also log to console for debugging
    console.log('Map feedback:', message);
    
    setTimeout(() => {
      this.feedback.classList.remove('visible');
    }, duration);
  }
  
  showFanMenu(point) {
    console.log('showFanMenu called with point:', point);
    console.log('fanMenu element:', this.fanMenu);
    
    if (!this.fanMenu) {
      console.error('fanMenu element not found! Attempting to re-initialize...');
      this.initializeAnnotationUI();
      
      if (!this.fanMenu) {
        console.error('fanMenu element still not found after re-initialization!');
        return;
      }
    }
    
    // Clear existing options
    this.fanMenu.innerHTML = '';
    
    // Create shape options (matching Android app)
    const shapes = [
      { type: 'circle', icon: '●', class: 'shape-circle' },
      { type: 'square', icon: '■', class: 'shape-square' },
      { type: 'triangle', icon: '▲', class: 'shape-triangle' },
      { type: 'exclamation', icon: '!', class: 'shape-exclamation' }
    ];
    
    // Create area and line options
    const otherOptions = [
      { type: 'area', icon: '◯', class: 'area' },
      { type: 'line', icon: '━', class: 'line' }
    ];
    
    const allOptions = [...shapes, ...otherOptions];
    
    // Get map container position for relative positioning
    const mapContainer = document.getElementById('map_container');
    const containerRect = mapContainer.getBoundingClientRect();
    
    // Position fan menu at click point relative to map container
    this.fanMenu.style.left = point.x + 'px';
    this.fanMenu.style.top = point.y + 'px';
    this.fanMenu.style.position = 'absolute';
    
    // Create option elements
    allOptions.forEach((option, index) => {
      const optionEl = document.createElement('div');
      optionEl.className = `fan-menu-option ${option.class}`;
      optionEl.innerHTML = `<span class="icon">${option.icon}</span>`;
      
      // Position options in a fan pattern
      const angle = (index * 360) / allOptions.length;
      const radius = 80;
      const x = Math.cos(angle * Math.PI / 180) * radius;
      const y = Math.sin(angle * Math.PI / 180) * radius;
      
      optionEl.style.left = x + 'px';
      optionEl.style.top = y + 'px';
      
      optionEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleFanMenuOption(option.type, point);
      });
      
      this.fanMenu.appendChild(optionEl);
    });
    
    // Show fan menu
    this.fanMenu.classList.add('visible');
    console.log('Fan menu made visible, classes:', this.fanMenu.className);
    
    // Store the map coordinates for later use
    this.pendingAnnotation = this.map.unproject(point);
  }
  
  hideFanMenu() {
    if (this.fanMenu) {
      this.fanMenu.classList.remove('visible');
      this.fanMenu.innerHTML = '';
    }
  }
  
  handleFanMenuOption(optionType, point) {
    this.hideFanMenu();
    
    if (['circle', 'square', 'triangle', 'exclamation'].includes(optionType)) {
      // Show color menu for POI shapes
      this.currentShape = optionType;
      this.showColorMenu(point, 'poi');
    } else if (optionType === 'area') {
      // Start area drawing
      this.startAreaDrawing(point);
    } else if (optionType === 'line') {
      // Start line drawing
      this.startLineDrawing(point);
    }
  }
  
  showColorMenu(point, annotationType) {
    if (!this.colorMenu) return;
    
    // Clear existing options
    this.colorMenu.innerHTML = '';
    
    const colors = ['green', 'yellow', 'red', 'black', 'white'];
    
    // Position color menu at click point relative to map container
    this.colorMenu.style.left = point.x + 'px';
    this.colorMenu.style.top = point.y + 'px';
    this.colorMenu.style.position = 'absolute';
    
    // Create color options
    colors.forEach((color, index) => {
      const colorEl = document.createElement('div');
      colorEl.className = `color-option ${color}`;
      
      // Position colors in a smaller fan pattern
      const angle = (index * 360) / colors.length;
      const radius = 60;
      const x = Math.cos(angle * Math.PI / 180) * radius;
      const y = Math.sin(angle * Math.PI / 180) * radius;
      
      colorEl.style.left = x + 'px';
      colorEl.style.top = y + 'px';
      
      colorEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleColorSelection(color, annotationType);
      });
      
      this.colorMenu.appendChild(colorEl);
    });
    
    // Show color menu
    this.colorMenu.classList.add('visible');
  }
  
  hideColorMenu() {
    if (this.colorMenu) {
      this.colorMenu.classList.remove('visible');
      this.colorMenu.innerHTML = '';
    }
  }
  
  handleColorSelection(color, annotationType) {
    this.hideColorMenu();
    this.currentColor = color;
    
    if (annotationType === 'poi') {
      this.createPOI();
    } else if (annotationType === 'area') {
      this.createArea();
    } else if (annotationType === 'line') {
      this.createLine();
    }
  }
  
  createPOI() {
    if (!this.pendingAnnotation) {
      this.showFeedback('No location selected', 3000);
      return;
    }
    
    const annotationData = {
      teamId: this.currentTeamId, // Can be null for global annotations
      type: 'poi',
      data: {
        position: {
          lng: this.pendingAnnotation.lng,
          lt: this.pendingAnnotation.lat
        },
        color: this.currentColor,
        shape: this.currentShape,
        label: '',
        timestamp: Date.now()
      }
    };
    
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
    const annotationId = feature.properties.id;
    const annotation = this.annotations.find(a => a.id === annotationId);
    
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
    
    document.getElementById('edit_label').value = data.label || '';
    document.getElementById('edit_color').value = data.color || 'green';
    
    // Show/hide relevant fields based on annotation type
    const shapeGroup = document.getElementById('edit_shape_group');
    const radiusGroup = document.getElementById('edit_radius_group');
    
    if (annotation.type === 'poi') {
      shapeGroup.style.display = 'block';
      document.getElementById('edit_shape').value = data.shape || 'circle';
      radiusGroup.style.display = 'none';
    } else if (annotation.type === 'area') {
      shapeGroup.style.display = 'none';
      radiusGroup.style.display = 'block';
      document.getElementById('edit_radius').value = data.radius || 100;
    } else {
      shapeGroup.style.display = 'none';
      radiusGroup.style.display = 'none';
    }
    
    // Update form title
    document.getElementById('edit_form_title').textContent = `Edit ${annotation.type.toUpperCase()} Annotation`;
    
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
    
    const formData = new FormData(document.getElementById('edit_annotation_form'));
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
    
    try {
      const response = await fetch(`/api/admin/map/annotations/${this.currentEditingAnnotation.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('taklite:token')}`
        },
        body: JSON.stringify({ data: updateData })
      });
      
      if (response.ok) {
        this.showFeedback('Annotation updated successfully', 2000);
        
        // Update local annotation
        const index = this.annotations.findIndex(a => a.id === this.currentEditingAnnotation.id);
        if (index >= 0) {
          this.annotations[index].data = { ...this.annotations[index].data, ...updateData };
          this.updateMapData();
        }
        
        this.hideEditForm();
      } else {
        const error = await response.json();
        this.showFeedback(`Failed to update annotation: ${error.error}`, 5000);
      }
    } catch (error) {
      console.error('Failed to update annotation:', error);
      this.showFeedback('Failed to update annotation', 5000);
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
    try {
      const response = await fetch(`/api/admin/map/annotations/${annotationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('taklite:token')}`
        }
      });
      
      if (response.ok) {
        this.showFeedback('Annotation deleted successfully', 2000);
        
        // Remove from local annotations array
        this.annotations = this.annotations.filter(a => a.id !== annotationId);
        this.updateMapData();
      } else {
        const error = await response.json();
        this.showFeedback(`Failed to delete annotation: ${error.error}`, 5000);
      }
    } catch (error) {
      console.error('Failed to delete annotation:', error);
      this.showFeedback('Failed to delete annotation', 5000);
    }
  }
  
  startAreaDrawing(point) {
    this.tempAreaCenter = this.map.unproject(point);
    this.tempAreaRadiusPixels = 0;
    this.tempAreaRadius = 0;
    this.isEditingMode = true;
    
    this.showFeedback('Click to set area radius', 3000);
  }
  
  updateAreaRadius(lngLat) {
    if (!this.tempAreaCenter) return;
    
    // Calculate radius in meters
    const radius = this.calculateDistance(this.tempAreaCenter, lngLat);
    this.tempAreaRadius = radius;
    
    // Show color menu for area
    const point = this.map.project(lngLat);
    this.showColorMenu(point, 'area');
  }
  
  createArea() {
    if (!this.tempAreaCenter) {
      this.showFeedback('No area center selected', 3000);
      return;
    }
    
    const annotationData = {
      teamId: this.currentTeamId, // Can be null for global annotations
      type: 'area',
      data: {
        center: {
          lng: this.tempAreaCenter.lng,
          lt: this.tempAreaCenter.lat
        },
        radius: this.tempAreaRadius,
        color: this.currentColor,
        label: '',
        timestamp: Date.now()
      }
    };
    
    this.createAnnotation(annotationData);
    this.finishAreaDrawing();
  }
  
  finishAreaDrawing() {
    this.tempAreaCenter = null;
    this.tempAreaRadius = 0;
    this.tempAreaRadiusPixels = 0;
    this.isEditingMode = false;
  }
  
  startLineDrawing(point) {
    this.tempLinePoints = [this.map.unproject(point)];
    this.isEditingMode = true;
    
    this.showFeedback('Click to add line points, right-click to finish', 3000);
  }
  
  addLinePoint(lngLat) {
    this.tempLinePoints.push(lngLat);
    
    if (this.tempLinePoints.length >= 2) {
      // Show color menu for line
      const point = this.map.project(lngLat);
      this.showColorMenu(point, 'line');
    }
  }
  
  createLine() {
    if (!this.tempLinePoints.length || this.tempLinePoints.length < 2) {
      this.showFeedback('Need at least 2 points for a line', 3000);
      return;
    }
    
    const annotationData = {
      teamId: this.currentTeamId, // Can be null for global annotations
      type: 'line',
      data: {
        points: this.tempLinePoints.map(p => ({
          lng: p.lng,
          lt: p.lat
        })),
        color: this.currentColor,
        label: '',
        timestamp: Date.now()
      }
    };
    
    this.createAnnotation(annotationData);
    this.finishLineDrawing();
  }
  
  finishLineDrawing() {
    this.tempLinePoints = [];
    this.isEditingMode = false;
  }
  
  async createAnnotation(annotationData) {
    try {
      const response = await fetch('/api/admin/map/annotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('taklite:token')}`
        },
        body: JSON.stringify(annotationData)
      });
      
      if (response.ok) {
        const result = await response.json();
        this.showFeedback('Annotation created successfully', 2000);
        
        // Add to local annotations array
        this.annotations.unshift(result);
        this.updateMapData();
      } else {
        const error = await response.json();
        this.showFeedback(`Failed to create annotation: ${error.error}`, 5000);
      }
    } catch (error) {
      console.error('Failed to create annotation:', error);
      this.showFeedback('Failed to create annotation', 5000);
    }
  }
  
  showAnnotationPopup(feature, lngLat) {
    // Close any existing popups first
    this.closeAllPopups();
    
    const properties = feature.properties;
    // Find the full annotation data for more detailed calculations
    const fullAnnotation = this.annotations.find(ann => ann.id === properties.id);
    const popupContent = this.buildAnnotationPopupContent(properties, lngLat, fullAnnotation);
    
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'enhanced-popup'
    })
      .setLngLat(lngLat)
      .setHTML(popupContent)
      .addTo(this.map);
    
    // Store reference to current popup for cleanup
    this.currentPopup = popup;
    
    // Start age updates for this popup
    this.startAgeUpdates(popup);
  }
  
  showLocationPopup(feature, lngLat) {
    // Close any existing popups first
    this.closeAllPopups();
    
    const properties = feature.properties;
    const popupContent = this.buildLocationPopupContent(properties, lngLat);
    
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'enhanced-popup'
    })
      .setLngLat(lngLat)
      .setHTML(popupContent)
      .addTo(this.map);
    
    // Store reference to current popup for cleanup
    this.currentPopup = popup;
    
    // Start age updates for this popup
    this.startAgeUpdates(popup);
  }
  
  // Build enhanced popover content for annotations (matching Android app style)
  buildAnnotationPopupContent(properties, lngLat, fullAnnotation = null) {
    const type = properties.type;
    const lines = [];
    
    // Title line - use label if available, otherwise use type
    const title = properties.label || this.capitalizeFirst(type);
    lines.push(title);
    
    // Add type-specific information
    switch (type) {
      case 'poi':
        this.addPoiInfo(lines, properties, lngLat, fullAnnotation);
        break;
      case 'line':
        this.addLineInfo(lines, properties, lngLat, fullAnnotation);
        break;
      case 'area':
        this.addAreaInfo(lines, properties, lngLat, fullAnnotation);
        break;
      case 'polygon':
        this.addPolygonInfo(lines, properties, lngLat, fullAnnotation);
        break;
    }
    
    // Add common information
    this.addCommonInfo(lines, properties, lngLat);
    
    return this.buildPopupHTML(lines, properties);
  }
  
  // Build enhanced popover content for peer locations
  buildLocationPopupContent(properties, lngLat) {
    const lines = [];
    
    // Title - use user name or email
    const title = properties.user_name || properties.user_email || 'Peer Location';
    lines.push(title);
    
    // Add status information
    if (properties.user_status && properties.user_status !== 'GREEN') {
      lines.push(`Status: ${properties.user_status}`);
    }
    
    // Add staleness indicator
    if (properties.isStale) {
      lines.push(`⚠️ Stale (${properties.ageMinutes}m old)`);
    }
    
    // Add location-specific information
    // Age (will be updated dynamically)
    lines.push({ type: 'age', timestamp: properties.timestamp });
    
    // Coordinates
    const coords = `${properties.latitude.toFixed(5)}, ${properties.longitude.toFixed(5)}`;
    lines.push(coords);
    
    // Distance from user location (if available)
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${this.formatDistance(distance)} away`);
    }
    
    // Additional location details
    if (properties.altitude !== null && properties.altitude !== undefined) {
      lines.push(`Altitude: ${properties.altitude.toFixed(1)}m`);
    }
    if (properties.accuracy !== null && properties.accuracy !== undefined) {
      lines.push(`Accuracy: ${properties.accuracy.toFixed(1)}m`);
    }
    
    return this.buildPopupHTML(lines, properties);
  }
  
  // Add POI-specific information
  addPoiInfo(lines, properties, lngLat) {
    // Age (will be updated dynamically)
    lines.push({ type: 'age', timestamp: properties.timestamp });
    
    // Coordinates
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    
    // Distance from user location
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${this.formatDistance(distance)} away`);
    }
  }
  
  // Add line-specific information
  addLineInfo(lines, properties, lngLat, fullAnnotation = null) {
    // Calculate line length (approximate)
    const length = this.calculateLineLength(properties, fullAnnotation);
    if (length !== null) {
      lines.push(this.formatDistance(length));
    }
    
    // Age (will be updated dynamically)
    lines.push({ type: 'age', timestamp: properties.timestamp });
    
    // Coordinates (center of line)
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    
    // Distance from user location
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${this.formatDistance(distance)} away`);
    }
  }
  
  // Add area-specific information
  addAreaInfo(lines, properties, lngLat, fullAnnotation = null) {
    // Calculate area (approximate)
    const area = this.calculateAreaSize(properties, fullAnnotation);
    if (area !== null) {
      lines.push(this.formatArea(area));
    }
    
    // Age (will be updated dynamically)
    lines.push({ type: 'age', timestamp: properties.timestamp });
    
    // Coordinates (center of area)
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    
    // Distance from user location
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${this.formatDistance(distance)} away`);
    }
  }
  
  // Add polygon-specific information
  addPolygonInfo(lines, properties, lngLat, fullAnnotation = null) {
    // Calculate area (approximate)
    const area = this.calculatePolygonArea(properties, fullAnnotation);
    if (area !== null) {
      lines.push(this.formatArea(area));
    }
    
    // Age (will be updated dynamically)
    lines.push({ type: 'age', timestamp: properties.timestamp });
    
    // Coordinates (center of polygon)
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    
    // Distance from user location
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${this.formatDistance(distance)} away`);
    }
  }
  
  // Add common information for all annotations
  addCommonInfo(lines, properties, lngLat) {
    // Creator information
    if (properties.creatorId) {
      lines.push(`Created by: ${properties.creatorId}`);
    }
    
    // Source information
    if (properties.source) {
      lines.push(`Source: ${properties.source}`);
    }
  }
  
  // Build the HTML for the popup (matching Android app styling)
  buildPopupHTML(lines, properties) {
    if (lines.length === 0) return '';
    
    const title = lines[0];
    const content = lines.slice(1);
    
    // Process content lines, handling age objects specially
    const processedContent = content.map(line => {
      if (typeof line === 'object' && line.type === 'age') {
        return `<span class="age-text" data-timestamp="${line.timestamp}">${this.formatAge(line.timestamp)}</span>`;
      } else {
        return this.escapeHtml(line);
      }
    });
    
    return `
      <div class="popup-container">
        <div class="popup-title">${this.escapeHtml(title)}</div>
        ${processedContent.length > 0 ? `<div class="popup-content">${processedContent.join('<br>')}</div>` : ''}
        ${properties.status ? `<div class="popup-status">${this.getStatusDescription(properties.status)}</div>` : ''}
      </div>
    `;
  }
  
  // Utility functions
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Calculate distance from user location (if available)
  calculateDistanceFromUser(lngLat) {
    // For now, return null since we don't have user location in admin interface
    // This could be enhanced to use browser geolocation API
    return null;
  }
  
  // Calculate line length (approximate)
  calculateLineLength(properties, fullAnnotation = null) {
    if (!fullAnnotation || !fullAnnotation.data || !fullAnnotation.data.points) {
      return null;
    }
    
    const points = fullAnnotation.data.points;
    if (points.length < 2) return null;
    
    let totalLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      totalLength += this.haversineDistance(p1.lt, p1.lng, p2.lt, p2.lng);
    }
    
    return totalLength;
  }
  
  // Calculate area size (approximate)
  calculateAreaSize(properties, fullAnnotation = null) {
    if (!fullAnnotation || !fullAnnotation.data || !fullAnnotation.data.radius) {
      return null;
    }
    
    const radius = fullAnnotation.data.radius;
    // Calculate area of circle: π * r²
    return Math.PI * radius * radius;
  }
  
  // Calculate polygon area (approximate)
  calculatePolygonArea(properties, fullAnnotation = null) {
    if (!fullAnnotation || !fullAnnotation.data || !fullAnnotation.data.points) {
      return null;
    }
    
    const points = fullAnnotation.data.points;
    if (points.length < 3) return null;
    
    // Use the shoelace formula for polygon area
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].lng * points[j].lt;
      area -= points[j].lng * points[i].lt;
    }
    area = Math.abs(area) / 2;
    
    // Convert from square degrees to square meters (approximate)
    // This is a rough approximation - for more accuracy, we'd need proper projection
    const lat = points[0].lt;
    const metersPerDegreeLat = 111320; // meters per degree latitude
    const metersPerDegreeLng = 111320 * Math.cos(lat * Math.PI / 180); // meters per degree longitude at this latitude
    
    return area * metersPerDegreeLat * metersPerDegreeLng;
  }
  
  // Format distance for display
  formatDistance(meters) {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else if (meters < 1609.344) {
      return `${(meters / 1000).toFixed(1)}km`;
    } else {
      const miles = meters / 1609.344;
      return `${miles.toFixed(1)}mi`;
    }
  }
  
  // Format area for display
  formatArea(squareMeters) {
    if (squareMeters < 10000) {
      return `${Math.round(squareMeters)}m²`;
    } else if (squareMeters < 2589988.11) {
      return `${(squareMeters / 10000).toFixed(1)}ha`;
    } else {
      const acres = squareMeters / 4046.86;
      return `${acres.toFixed(1)}ac`;
    }
  }
  
  // Get status description
  getStatusDescription(status) {
    const statusMap = {
      'sending': 'Sending...',
      'sent': 'Sent',
      'delivered': 'Delivered',
      'failed': 'Failed',
      'retrying': 'Retrying...'
    };
    return statusMap[status.toLowerCase()] || status;
  }
  
  // Calculate distance between two points using Haversine formula
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  // Convert degrees to radians
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
  
  // Close all existing popups
  closeAllPopups() {
    if (this.currentPopup) {
      this.currentPopup.remove();
      this.currentPopup = null;
    }
    
    // Also close any other popups that might exist
    const popups = document.querySelectorAll('.maplibregl-popup');
    popups.forEach(popup => {
      if (popup._popup) {
        popup._popup.remove();
      }
    });
    
    // Clear any age update intervals
    if (this.ageUpdateInterval) {
      clearInterval(this.ageUpdateInterval);
      this.ageUpdateInterval = null;
    }
  }
  
  // Format age with dynamic updates (e.g., "1d 2h 3m ago", "45m 10s ago")
  formatAge(timestamp) {
    const now = Date.now();
    const ageMs = now - new Date(timestamp).getTime();
    
    if (ageMs < 0) return 'Just now';
    
    const seconds = Math.floor(ageMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    const parts = [];
    
    if (days > 0) {
      parts.push(`${days}d`);
    }
    if (hours % 24 > 0) {
      parts.push(`${hours % 24}h`);
    }
    if (minutes % 60 > 0) {
      parts.push(`${minutes % 60}m`);
    }
    if (seconds % 60 > 0 && days === 0 && hours === 0) {
      parts.push(`${seconds % 60}s`);
    }
    
    if (parts.length === 0) {
      return 'Just now';
    }
    
    return parts.join(' ') + ' ago';
  }
  
  // Start age update interval for current popup
  startAgeUpdates(popup) {
    if (this.ageUpdateInterval) {
      clearInterval(this.ageUpdateInterval);
    }
    
    this.ageUpdateInterval = setInterval(() => {
      if (this.currentPopup && this.currentPopup.isOpen()) {
        // Update the popup content with new age
        this.updatePopupAge();
      } else {
        // Popup is closed, stop updating
        clearInterval(this.ageUpdateInterval);
        this.ageUpdateInterval = null;
      }
    }, 1000); // Update every second
  }
  
  // Update age in current popup
  updatePopupAge() {
    if (!this.currentPopup || !this.currentPopup.isOpen()) return;
    
    const popupContent = this.currentPopup.getElement();
    if (!popupContent) return;
    
    // Find all age elements and update them
    const ageElements = popupContent.querySelectorAll('.age-text');
    ageElements.forEach(element => {
      const timestamp = element.dataset.timestamp;
      if (timestamp) {
        element.textContent = this.formatAge(timestamp);
      }
    });
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
    const refreshBtn = document.getElementById('map_refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadMapData();
      });
    }
    
    // Center map button
    const centerBtn = document.getElementById('map_center');
    if (centerBtn) {
      centerBtn.addEventListener('click', () => {
        this.centerMap();
      });
    }
    
    // Clear all annotations button
    const clearAllBtn = document.getElementById('map_clear_all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        this.clearAllAnnotations();
      });
    }
    
    // Show/hide toggles
    const showAnnotations = document.getElementById('map_show_annotations');
    if (showAnnotations) {
      showAnnotations.addEventListener('change', (e) => {
        this.showAnnotations = e.target.checked;
        this.updateLayerVisibility();
      });
    }
    
    const showLocations = document.getElementById('map_show_locations');
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
    
    console.log('Setting up map WebSocket listeners...');
    
    // Listen for annotation updates
    window.socket.on('admin:annotation_update', (data) => {
      console.log('Received annotation update:', data);
      this.handleAnnotationUpdate(data);
    });
    
    // Listen for annotation deletions
    window.socket.on('admin:annotation_delete', (data) => {
      console.log('Received annotation deletion:', data);
      this.handleAnnotationDelete(data);
    });
    
    // Listen for bulk annotation deletions
    window.socket.on('admin:annotation_bulk_delete', (data) => {
      console.log('Received bulk annotation deletion:', data);
      this.handleBulkAnnotationDelete(data);
    });
    
    // Listen for location updates
    window.socket.on('admin:location_update', (data) => {
      console.log('Received location update:', data);
      this.handleLocationUpdate(data);
    });
    
    // Listen for sync activity that might affect map data
    window.socket.on('admin:sync_activity', (data) => {
      if (data.type === 'annotation_update' || data.type === 'annotation_delete' || data.type === 'annotation_bulk_delete' || data.type === 'location_update') {
        console.log('Sync activity affecting map:', data);
        // Refresh map data after a short delay to allow server to process
        setTimeout(() => {
          this.loadMapData();
        }, 1000);
      }
    });
  }
  
  disconnectFromWebSocket() {
    if (!window.socket) return;
    
    console.log('Disconnecting map WebSocket listeners...');
    
    // Remove specific listeners
    window.socket.off('admin:annotation_update');
    window.socket.off('admin:annotation_delete');
    window.socket.off('admin:annotation_bulk_delete');
    window.socket.off('admin:location_update');
    window.socket.off('admin:sync_activity');
  }
  
  handleAnnotationUpdate(data) {
    // Check if this annotation is relevant to current view
    if (this.currentTeamId && data.teamId !== this.currentTeamId) {
      return; // Not relevant to current team filter
    }
    
    // Add or update annotation in local data
    const existingIndex = this.annotations.findIndex(a => a.id === data.id);
    if (existingIndex >= 0) {
      this.annotations[existingIndex] = data;
    } else {
      this.annotations.unshift(data); // Add to beginning
    }
    
    // Update map immediately
    this.updateMapData();
    
    console.log(`Updated annotation ${data.id} on map`);
  }

  handleAnnotationDelete(data) {
    // Check if this annotation is relevant to current view
    if (this.currentTeamId && data.teamId !== this.currentTeamId) {
      return; // Not relevant to current team filter
    }
    
    // Remove annotation from local data
    const existingIndex = this.annotations.findIndex(a => a.id === data.annotationId);
    if (existingIndex >= 0) {
      this.annotations.splice(existingIndex, 1);
      console.log(`Removed annotation ${data.annotationId} from map`);
    } else {
      console.log(`Annotation ${data.annotationId} not found in local data`);
    }
    
    // Update map immediately
    this.updateMapData();
  }

  handleBulkAnnotationDelete(data) {
    // Check if this deletion is relevant to current view
    if (this.currentTeamId && data.teamId !== this.currentTeamId) {
      return; // Not relevant to current team filter
    }
    
    // Remove multiple annotations from local data
    let removedCount = 0;
    data.annotationIds.forEach(annotationId => {
      const existingIndex = this.annotations.findIndex(a => a.id === annotationId);
      if (existingIndex >= 0) {
        this.annotations.splice(existingIndex, 1);
        removedCount++;
      }
    });
    
    console.log(`Removed ${removedCount} annotations from map (${data.annotationIds.length} requested)`);
    
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
    
    console.log(`Updated location for user ${data.userId} on map`);
  }
  
  updateLayerVisibility() {
    if (!this.map) return;
    
    const visibility = this.showAnnotations ? 'visible' : 'none';
    this.map.setLayoutProperty('annotations-poi', 'visibility', visibility);
    this.map.setLayoutProperty('annotations-line', 'visibility', visibility);
    this.map.setLayoutProperty('annotations-area', 'visibility', visibility);
    this.map.setLayoutProperty('annotations-polygon', 'visibility', visibility);
    this.map.setLayoutProperty('annotations-polygon-stroke', 'visibility', visibility);
    
    const locationVisibility = this.showLocations ? 'visible' : 'none';
    this.map.setLayoutProperty('locations', 'visibility', locationVisibility);
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
    try {
      const token = localStorage.getItem('taklite:token');
      const params = new URLSearchParams();
      if (this.currentTeamId) {
        params.append('teamId', this.currentTeamId);
      }
      params.append('limit', '1000');
      
      const url = `/api/admin/map/annotations?${params}`;
      console.log(`Loading annotations from: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        this.annotations = await response.json();
        console.log(`Loaded ${this.annotations.length} annotations`);
      } else {
        console.error(`Failed to load annotations: ${response.status} ${response.statusText}`);
        this.annotations = [];
      }
    } catch (error) {
      console.error('Failed to load annotations:', error);
      this.annotations = [];
    }
  }
  
  async loadLocations() {
    try {
      const token = localStorage.getItem('taklite:token');
      const headers = {
        'Authorization': `Bearer ${token}`
      };
      
      // If no team is selected, load locations from all teams by using the regular locations endpoint
      if (!this.currentTeamId) {
        const params = new URLSearchParams();
        params.append('limit', '100');
        
        const url = `/api/admin/map/locations?${params}`;
        console.log(`Loading locations from: ${url}`);
        
        const response = await fetch(url, { headers });
        if (response.ok) {
          this.locations = await response.json();
          console.log(`Loaded ${this.locations.length} locations from all teams`);
        } else {
          console.error(`Failed to load locations: ${response.status} ${response.statusText}`);
          this.locations = [];
        }
      } else {
        // Use the latest endpoint for specific team
        const params = new URLSearchParams();
        params.append('teamId', this.currentTeamId);
        
        const url = `/api/admin/map/locations/latest?${params}`;
        console.log(`Loading latest locations from: ${url}`);
        
        const response = await fetch(url, { headers });
        if (response.ok) {
          this.locations = await response.json();
          console.log(`Loaded ${this.locations.length} latest locations for team ${this.currentTeamId}`);
        } else {
          console.error(`Failed to load locations for team ${this.currentTeamId}: ${response.status} ${response.statusText}`);
          this.locations = [];
        }
      }
    } catch (error) {
      console.error('Failed to load locations:', error);
      this.locations = [];
    }
  }
  
  updateMapData() {
    if (!this.map) return;
    
    console.log(`updateMapData called with ${this.annotations?.length || 0} annotations and ${this.locations?.length || 0} locations`);
    
    // Ensure all sources exist
    const requiredSources = ['annotations-poi', 'annotations-line', 'annotations-area', 'annotations-polygon', 'locations'];
    for (const sourceId of requiredSources) {
      if (!this.map.getSource(sourceId)) {
        console.error(`Map source '${sourceId}' not found`);
        return;
      }
    }
    
    // Convert annotations to GeoJSON
    const poiFeatures = [];
    const lineFeatures = [];
    const areaFeatures = [];
    const polygonFeatures = [];
    
    this.annotations.forEach(annotation => {
      const data = annotation.data;
      const properties = {
        id: annotation.id,
        type: annotation.type,
        color: this.getColorHex(data.color),
        label: data.label,
        timestamp: data.timestamp,
        creatorId: data.creatorId,
        source: data.source
      };
      
      switch (annotation.type) {
        case 'poi':
          // Use consistent coordinate extraction logic
          const poiCoords = this.extractCoordinates(data.position);
          if (poiCoords) {
            // Create icon name based on shape and color (matching Android app pattern)
            const iconName = `poi-${(data.shape || 'circle').toLowerCase()}-${data.color.toLowerCase()}`;
            poiFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: poiCoords
              },
              properties: {
                ...properties,
                icon: iconName
              }
            });
          } else {
            console.warn('Skipping POI annotation with invalid coordinates:', {
              id: annotation.id,
              position: data.position
            });
          }
          break;
          
        case 'line':
          // Use consistent coordinate extraction logic
          const linePoints = data.points.map(p => this.extractCoordinates(p)).filter(coord => coord !== null);
          if (linePoints.length >= 2) {
            lineFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: linePoints
              },
              properties
            });
          } else {
            console.warn('Skipping line annotation with insufficient valid coordinates:', {
              id: annotation.id,
              validPoints: linePoints.length,
              totalPoints: data.points.length
            });
          }
          break;
          
        case 'area':
          // Use consistent coordinate extraction logic
          const areaCoords = this.extractCoordinates(data.center);
          if (areaCoords && data.radius && data.radius > 0) {
            const areaPolygon = this.generateCirclePolygon(areaCoords[0], areaCoords[1], data.radius);
            areaFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [areaPolygon]
              },
              properties: {
                ...properties,
                fillOpacity: 0.3,
                strokeWidth: 3
              }
            });
          } else {
            console.warn('Skipping area annotation with invalid coordinates or radius:', {
              id: annotation.id,
              center: data.center,
              radius: data.radius
            });
          }
          break;
          
        case 'polygon':
          // Use consistent coordinate extraction logic
          const polygonPoints = data.points.map(p => this.extractCoordinates(p)).filter(coord => coord !== null);
          if (polygonPoints.length >= 3) {
            polygonFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [polygonPoints]
              },
              properties
            });
          } else {
            console.warn('Skipping polygon annotation with insufficient valid coordinates:', {
              id: annotation.id,
              validPoints: polygonPoints.length,
              totalPoints: data.points.length
            });
          }
          break;
      }
    });
    
    // Convert locations to GeoJSON with staleness detection
    const now = Date.now();
    const stalenessThresholdMs = 10 * 60 * 1000; // 10 minutes (configurable)
    
    const locationFeatures = this.locations
      .map(location => {
        const locationCoords = this.extractCoordinates(location);
        if (!locationCoords) {
          console.warn('Skipping location with invalid coordinates:', {
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
    
    // Update map sources
    this.map.getSource('annotations-poi').setData({
      type: 'FeatureCollection',
      features: poiFeatures
    });
    
    this.map.getSource('annotations-line').setData({
      type: 'FeatureCollection',
      features: lineFeatures
    });
    
    this.map.getSource('annotations-area').setData({
      type: 'FeatureCollection',
      features: areaFeatures
    });
    
    this.map.getSource('annotations-polygon').setData({
      type: 'FeatureCollection',
      features: polygonFeatures
    });
    
    this.map.getSource('locations').setData({
      type: 'FeatureCollection',
      features: locationFeatures
    });
    
    console.log(`Updated map with ${poiFeatures.length} POIs, ${lineFeatures.length} lines, ${areaFeatures.length} areas, ${polygonFeatures.length} polygons, ${locationFeatures.length} locations`);
  }
  
  
  // Auto-center map based on user location or existing data
  async autoCenterMap() {
    if (!this.map) return;
    
    // First try to get user's current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          console.log('Centering map on user location:', latitude, longitude);
          this.map.flyTo({
            center: [longitude, latitude],
            zoom: 12,
            duration: 1000
          });
        },
        (error) => {
          // Only log non-permission errors to reduce noise
          if (error.code !== error.PERMISSION_DENIED) {
            console.log('Geolocation failed:', error.message);
          }
          // Fall back to centering on existing data
          this.centerMapOnData();
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 300000 // 5 minutes
        }
      );
    } else {
      console.log('Geolocation not supported');
      // Fall back to centering on existing data
      this.centerMapOnData();
    }
  }
  
  // Helper method to extract coordinates from different formats
  extractCoordinates(coordObj) {
    if (!coordObj) return null;
    
    // Handle different coordinate formats:
    // Android format: { lt: number, lng: number }
    // Server format: { lat: number, lng: number }
    // Location format: { latitude: number, longitude: number }
    const lat = coordObj.lat ?? coordObj.lt ?? coordObj.latitude;
    const lng = coordObj.lng ?? coordObj.longitude;
    
    // Validate coordinates
    if (typeof lng === 'number' && typeof lat === 'number' && 
        !isNaN(lng) && !isNaN(lat) && 
        isFinite(lng) && isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
      return [lng, lat];
    }
    return null;
  }

  // Center map on existing annotations and locations
  centerMapOnData() {
    if (!this.map) return;
    
    // Calculate bounds of all features
    const allFeatures = [];
    
    // Helper function to validate coordinates
    const isValidCoordinate = (lng, lat) => {
      return typeof lng === 'number' && typeof lat === 'number' && 
             !isNaN(lng) && !isNaN(lat) && 
             isFinite(lng) && isFinite(lat) &&
             lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
    };
    
    // Use class method for coordinate extraction
    
    // Add annotation features
    this.annotations.forEach(annotation => {
      const data = annotation.data;
      switch (annotation.type) {
        case 'poi':
          const poiCoords = this.extractCoordinates(data.position);
          if (poiCoords) {
            allFeatures.push(poiCoords);
          }
          break;
        case 'line':
          if (data.points && Array.isArray(data.points)) {
            data.points.forEach(p => {
              const lineCoords = this.extractCoordinates(p);
              if (lineCoords) {
                allFeatures.push(lineCoords);
              }
            });
          }
          break;
        case 'area':
          const areaCoords = this.extractCoordinates(data.center);
          if (areaCoords) {
            allFeatures.push(areaCoords);
          }
          break;
        case 'polygon':
          if (data.points && Array.isArray(data.points)) {
            data.points.forEach(p => {
              const polyCoords = this.extractCoordinates(p);
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
      const locCoords = this.extractCoordinates(location);
      if (locCoords) {
        allFeatures.push(locCoords);
      }
    });
    
    if (allFeatures.length > 0) {
      try {
        const bounds = allFeatures.reduce((bounds, coord) => {
          return bounds.extend(coord);
        }, new maplibregl.LngLatBounds(allFeatures[0], allFeatures[0]));
        
        this.map.fitBounds(bounds, { padding: 50, duration: 1000 });
        console.log(`Centered map on ${allFeatures.length} valid coordinates`);
      } catch (error) {
        console.error('Error centering map on data:', error);
        console.error('Problematic coordinates:', allFeatures.slice(0, 5)); // Log first 5 for debugging
        // Fall back to default center
        this.map.flyTo({ center: [-98.5795, 39.8283], zoom: 4, duration: 1000 });
        console.log('Fell back to default US center due to bounds error');
      }
    } else {
      // Default to US center if no data
      this.map.flyTo({ center: [-98.5795, 39.8283], zoom: 4, duration: 1000 });
      console.log('No valid coordinates found, using default US center');
    }
  }
  
  getColorHex(color) {
    // Match Android app color values exactly
    const colorMap = {
      'green': '#4CAF50',
      'yellow': '#FBC02D', 
      'red': '#F44336',
      'black': '#000000',
      'white': '#FFFFFF'
    };
    return colorMap[color] || '#3b82f6';
  }

  // Generate circle polygon points (matching Android app logic)
  generateCirclePolygon(centerLng, centerLat, radiusMeters, numPoints = 32) {
    const points = [];
    const earthRadius = 6371000; // meters
    const angularDistance = radiusMeters / earthRadius;
    const centerLatRad = this.toRadians(centerLat);
    const centerLonRad = this.toRadians(centerLng);

    for (let i = 0; i < numPoints; i++) {
      const bearingRad = this.toRadians((i * 360.0 / numPoints));
      const latRad = Math.asin(Math.sin(centerLatRad) * Math.cos(angularDistance) + 
                              Math.cos(centerLatRad) * Math.sin(angularDistance) * Math.cos(bearingRad));
      const lonRad = centerLonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(centerLatRad), 
                                               Math.cos(angularDistance) - Math.sin(centerLatRad) * Math.sin(latRad));
      points.push([this.toDegrees(lonRad), this.toDegrees(latRad)]);
    }
    points.push(points[0]); // Close the polygon
    return points;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  toDegrees(radians) {
    return radians * (180 / Math.PI);
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
      
      // Get all annotation IDs
      const annotationIds = this.annotations.map(annotation => annotation.id);
      
      if (annotationIds.length === 0) {
        this.showFeedback('No annotations to clear', 2000);
        return;
      }
      
      // Call the bulk delete API
      const response = await fetch('/api/admin/map/annotations/bulk-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('taklite:token')}`
        },
        body: JSON.stringify({ annotationIds })
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.warning) {
          // Show warning if some annotations were skipped
          this.showFeedback(`${result.deletedCount} annotations cleared. ${result.warning}`, 8000);
        } else {
          // All annotations were cleared successfully
          this.showFeedback(`Successfully cleared ${result.deletedCount} annotations`, 3000);
        }
        
        // Remove only the successfully deleted annotations from local array
        this.annotations = this.annotations.filter(annotation => 
          !result.annotationIds.includes(annotation.id)
        );
        
        // Update map immediately
        this.updateMapData();
        
        // Close any open popups
        this.closeAllPopups();
      } else {
        const error = await response.json();
        this.showFeedback(`Failed to clear annotations: ${error.error}`, 5000);
      }
    } catch (error) {
      console.error('Failed to clear annotations:', error);
      this.showFeedback('Failed to clear annotations', 5000);
    }
  }
  
  // Calculate distance between two points using Haversine formula
  calculateDistance(point1, point2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(point2.lat - point1.lat);
    const dLon = this.toRadians(point2.lng - point1.lng);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(point1.lat)) * Math.cos(this.toRadians(point2.lat)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  // Convert degrees to radians
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
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
    
    // Clear any timers
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
    }
    
    console.log('AdminMap cleaned up');
  }
}

// Initialize map when page loads
let adminMap = null;

window.addEventListener('load', function() {
  console.log('Page loaded, checking libraries...');
  // Wait for both Socket.IO and MapLibre to load
  const checkLibraries = () => {
    console.log('Checking libraries - io:', typeof io, 'maplibregl:', typeof maplibregl);
    if (typeof io !== 'undefined' && typeof maplibregl !== 'undefined') {
      console.log('Both libraries loaded, initializing map...');
      adminMap = new AdminMap();
      // Make adminMap globally accessible
      window.adminMap = adminMap;
    } else {
      console.log('Libraries not ready, retrying...');
      setTimeout(checkLibraries, 100);
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
