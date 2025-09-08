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
      // Try to center map on user location or existing data
      this.autoCenterMap();
    });
    
    this.map.on('error', (e) => {
      console.error('Map error:', e);
    });
  }
  
  setupMapSources() {
    // Add annotation sources
    this.map.addSource('annotations-poi', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    
    this.map.addSource('annotations-line', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    
    this.map.addSource('annotations-area', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    
    this.map.addSource('annotations-polygon', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    
    // Add location source
    this.map.addSource('locations', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    
    this.addMapLayers();
  }
  
  
  addMapLayers() {
    // POI markers - use circle layer with proper sizing to match Android
    this.map.addLayer({
      id: 'annotations-poi',
      type: 'circle',
      source: 'annotations-poi',
      paint: {
        'circle-radius': 13, // Match Android effective radius (~27px / 2)
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF'
      }
    });
    
    // Lines
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
    
    // Areas (circles)
    this.map.addLayer({
      id: 'annotations-area',
      type: 'circle',
      source: 'annotations-area',
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.3,
        'circle-stroke-width': 2,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-opacity': 0.8
      }
    });
    
    // Polygons
    this.map.addLayer({
      id: 'annotations-polygon',
      type: 'fill',
      source: 'annotations-polygon',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.3
      }
    });
    
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
    
    // Location markers
    this.map.addLayer({
      id: 'locations',
      type: 'circle',
      source: 'locations',
      paint: {
        'circle-radius': 6,
        'circle-color': '#3b82f6',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });
    
    // Add click handlers
    this.setupClickHandlers();
  }
  
  setupClickHandlers() {
    // POI click handler
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
    
    // Change cursor on hover
    this.map.on('mouseenter', 'annotations-poi', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'annotations-poi', () => {
      this.map.getCanvas().style.cursor = '';
    });
    
    this.map.on('mouseenter', 'annotations-line', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'annotations-line', () => {
      this.map.getCanvas().style.cursor = '';
    });
    
    this.map.on('mouseenter', 'annotations-area', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'annotations-area', () => {
      this.map.getCanvas().style.cursor = '';
    });
    
    this.map.on('mouseenter', 'annotations-polygon', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'annotations-polygon', () => {
      this.map.getCanvas().style.cursor = '';
    });
    
    this.map.on('mouseenter', 'locations', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', 'locations', () => {
      this.map.getCanvas().style.cursor = '';
    });
  }
  
  showAnnotationPopup(feature, lngLat) {
    const properties = feature.properties;
    const popup = new maplibregl.Popup()
      .setLngLat(lngLat)
      .setHTML(`
        <div style="color: #e6edf3; font-family: ui-sans-serif, system-ui;">
          <h3 style="margin: 0 0 8px; color: #cbd5e1;">${properties.type.toUpperCase()}</h3>
          ${properties.label ? `<p style="margin: 0 0 8px;"><strong>Label:</strong> ${properties.label}</p>` : ''}
          <p style="margin: 0 0 8px;"><strong>Color:</strong> ${properties.color}</p>
          <p style="margin: 0 0 8px;"><strong>Created:</strong> ${new Date(properties.timestamp).toLocaleString()}</p>
          <p style="margin: 0 0 8px;"><strong>User:</strong> ${properties.creatorId}</p>
          ${properties.source ? `<p style="margin: 0;"><strong>Source:</strong> ${properties.source}</p>` : ''}
        </div>
      `)
      .addTo(this.map);
  }
  
  showLocationPopup(feature, lngLat) {
    const properties = feature.properties;
    const popup = new maplibregl.Popup()
      .setLngLat(lngLat)
      .setHTML(`
        <div style="color: #e6edf3; font-family: ui-sans-serif, system-ui;">
          <h3 style="margin: 0 0 8px; color: #cbd5e1;">Peer Location</h3>
          <p style="margin: 0 0 8px;"><strong>User:</strong> ${properties.user_name || properties.user_email}</p>
          <p style="margin: 0 0 8px;"><strong>Coordinates:</strong> ${properties.latitude.toFixed(6)}, ${properties.longitude.toFixed(6)}</p>
          ${properties.altitude ? `<p style="margin: 0 0 8px;"><strong>Altitude:</strong> ${properties.altitude.toFixed(1)}m</p>` : ''}
          ${properties.accuracy ? `<p style="margin: 0 0 8px;"><strong>Accuracy:</strong> ${properties.accuracy.toFixed(1)}m</p>` : ''}
          <p style="margin: 0;"><strong>Updated:</strong> ${new Date(properties.timestamp).toLocaleString()}</p>
        </div>
      `)
      .addTo(this.map);
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
      this.locations[existingIndex] = {
        ...this.locations[existingIndex],
        latitude: data.latitude,
        longitude: data.longitude,
        altitude: data.altitude,
        accuracy: data.accuracy,
        timestamp: data.timestamp
      };
    } else {
      // For new locations, we need to fetch user info
      this.loadLocations(); // This will get the latest data with user info
      return;
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
    
    console.log('Loading map data...');
    await Promise.all([
      this.loadAnnotations(),
      this.loadLocations()
    ]);
    
    this.updateMapData();
  }
  
  async loadAnnotations() {
    try {
      const params = new URLSearchParams();
      if (this.currentTeamId) {
        params.append('teamId', this.currentTeamId);
      }
      params.append('limit', '1000');
      
      const response = await fetch(`/api/admin/map/annotations?${params}`);
      if (response.ok) {
        this.annotations = await response.json();
        console.log(`Loaded ${this.annotations.length} annotations`);
      } else {
        console.error(`Failed to load annotations: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to load annotations:', error);
    }
  }
  
  async loadLocations() {
    try {
      // If no team is selected, load locations from all teams by using the regular locations endpoint
      if (!this.currentTeamId) {
        const params = new URLSearchParams();
        params.append('limit', '100');
        
        const response = await fetch(`/api/admin/map/locations?${params}`);
        if (response.ok) {
          this.locations = await response.json();
          console.log(`Loaded ${this.locations.length} locations from all teams`);
        } else {
          console.error(`Failed to load locations: ${response.status} ${response.statusText}`);
        }
      } else {
        // Use the latest endpoint for specific team
        const params = new URLSearchParams();
        params.append('teamId', this.currentTeamId);
        
        const response = await fetch(`/api/admin/map/locations/latest?${params}`);
        if (response.ok) {
          this.locations = await response.json();
          console.log(`Loaded ${this.locations.length} latest locations for team ${this.currentTeamId}`);
        } else {
          console.error(`Failed to load locations for team ${this.currentTeamId}: ${response.status} ${response.statusText}`);
        }
      }
    } catch (error) {
      console.error('Failed to load locations:', error);
    }
  }
  
  updateMapData() {
    if (!this.map) return;
    
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
          poiFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [data.position.lng, data.position.lt]
            },
            properties
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
          // Convert radius from meters to approximate degrees (rough conversion)
          const radiusDegrees = data.radius / 111320; // meters to degrees
          areaFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [data.center.lng, data.center.lt]
            },
            properties: {
              ...properties,
              radius: Math.max(radiusDegrees * 1000, 5) // Scale for visibility
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
    
    // Convert locations to GeoJSON
    const locationFeatures = this.locations.map(location => ({
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
        timestamp: location.timestamp
      }
    }));
    
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
  
  centerMap() {
    this.centerMapOnData();
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
