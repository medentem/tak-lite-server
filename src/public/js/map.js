// Map functionality for TAK Lite Admin Dashboard
class AdminMap {
  constructor() {
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
    
    this.init();
  }
  
  async init() {
    // Wait for MapLibre to load
    if (typeof maplibregl === 'undefined') {
      setTimeout(() => this.init(), 100);
      return;
    }
    
    console.log('Initializing admin map...');
    await this.loadTeams();
    await this.initializeMap();
    this.setupEventListeners();
    await this.loadMapData();
  }
  
  async loadTeams() {
    try {
      const response = await fetch('/api/admin/teams');
      if (response.ok) {
        this.teams = await response.json();
        this.populateTeamSelect();
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
    
    // Remove loading text
    container.innerHTML = '';
    
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
      ],
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
    };
    
    this.map = new maplibregl.Map({
      container: 'map_container',
      style: darkStyle,
      center: [0, 0], // Default center, will be updated based on data or user location
      zoom: 2,
      attributionControl: false
    });
    
    // Add navigation controls
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    // Add fullscreen control
    this.map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    
    // Wait for map to load
    this.map.on('load', () => {
      console.log('Map loaded successfully');
      this.setupMapSources();
    });
    
    this.map.on('error', (e) => {
      console.error('Map error:', e);
    });
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
          'icon-ignore-placement': true,
          'text-field': ['get', 'label'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8, 8,     // Small text when zoomed out
            12, 10,   // Medium text at mid zoom
            16, 12    // Larger text when zoomed in
          ],
          'text-offset': [0, -2],
          'text-allow-overlap': true,
          'text-ignore-placement': false
        },
        paint: {
          'text-color': '#FFFFFF'
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
    // POI click handler (symbol layer)
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
    
    // Listen for location updates
    window.socket.on('admin:location_update', (data) => {
      console.log('Received location update:', data);
      this.handleLocationUpdate(data);
    });
    
    // Listen for sync activity that might affect map data
    window.socket.on('admin:sync_activity', (data) => {
      if (data.type === 'annotation_update' || data.type === 'location_update') {
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
      const params = new URLSearchParams();
      if (this.currentTeamId) {
        params.append('teamId', this.currentTeamId);
      }
      params.append('limit', '1000');
      
      const url = `/api/admin/map/annotations?${params}`;
      console.log(`Loading annotations from: ${url}`);
      
      const response = await fetch(url);
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
      // If no team is selected, load locations from all teams by using the regular locations endpoint
      if (!this.currentTeamId) {
        const params = new URLSearchParams();
        params.append('limit', '100');
        
        const url = `/api/admin/map/locations?${params}`;
        console.log(`Loading locations from: ${url}`);
        
        const response = await fetch(url);
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
        
        const response = await fetch(url);
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
          // Create icon name based on shape and color (matching Android app pattern)
          const iconName = `poi-${(data.shape || 'circle').toLowerCase()}-${data.color.toLowerCase()}`;
          poiFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [data.position.lng, data.position.lt]
            },
            properties: {
              ...properties,
              icon: iconName
            }
          });
          break;
          
        case 'line':
          lineFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: data.points.map(p => [p.lng, p.lt])
            },
            properties
          });
          break;
          
        case 'area':
          // Generate polygon points for area (matching Android app approach)
          const areaPolygon = this.generateCirclePolygon(data.center.lng, data.center.lt, data.radius);
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
          break;
          
        case 'polygon':
          polygonFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [data.points.map(p => [p.lng, p.lt])]
            },
            properties
          });
          break;
      }
    });
    
    // Convert locations to GeoJSON with staleness detection
    const now = Date.now();
    const stalenessThresholdMs = 10 * 60 * 1000; // 10 minutes (configurable)
    
    const locationFeatures = this.locations.map(location => {
      const locationAge = now - new Date(location.timestamp).getTime();
      const isStale = locationAge > stalenessThresholdMs;
      
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [location.longitude, location.latitude]
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
    });
    
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
          console.log('Geolocation failed:', error.message);
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
  
  // Center map on existing annotations and locations
  centerMapOnData() {
    if (!this.map) return;
    
    // Calculate bounds of all features
    const allFeatures = [];
    
    // Add annotation features
    this.annotations.forEach(annotation => {
      const data = annotation.data;
      switch (annotation.type) {
        case 'poi':
          allFeatures.push([data.position.lng, data.position.lt]);
          break;
        case 'line':
          data.points.forEach(p => allFeatures.push([p.lng, p.lt]));
          break;
        case 'area':
          allFeatures.push([data.center.lng, data.center.lt]);
          break;
        case 'polygon':
          data.points.forEach(p => allFeatures.push([p.lng, p.lt]));
          break;
      }
    });
    
    // Add location features
    this.locations.forEach(location => {
      allFeatures.push([location.longitude, location.latitude]);
    });
    
    if (allFeatures.length > 0) {
      const bounds = allFeatures.reduce((bounds, coord) => {
        return bounds.extend(coord);
      }, new maplibregl.LngLatBounds(allFeatures[0], allFeatures[0]));
      
      this.map.fitBounds(bounds, { padding: 50, duration: 1000 });
      console.log('Centered map on existing data');
    } else {
      // Default to US center if no data
      this.map.flyTo({ center: [-98.5795, 39.8283], zoom: 4, duration: 1000 });
      console.log('No data found, using default US center');
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
  
  // Cleanup method to prevent memory leaks
  cleanup() {
    // Disconnect WebSocket listeners
    this.disconnectFromWebSocket();
    
    // Close any open popups
    this.closeAllPopups();
    
    console.log('AdminMap cleaned up');
  }
}

// Initialize map when page loads
let adminMap = null;

window.addEventListener('load', function() {
  // Wait for both Socket.IO and MapLibre to load
  const checkLibraries = () => {
    if (typeof io !== 'undefined' && typeof maplibregl !== 'undefined') {
      console.log('Both libraries loaded, initializing map...');
      adminMap = new AdminMap();
    } else {
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
