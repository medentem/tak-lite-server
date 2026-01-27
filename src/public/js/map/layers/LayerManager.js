/**
 * Layer Manager
 * Manages map layer creation, configuration, and visibility
 */

import { logger } from '../../utils/logger.js';
import { LAYER_CONFIG, DISPLAY_CONFIG } from '../../config/mapConfig.js';

export class LayerManager {
  /**
   * Create a layer manager
   * @param {maplibregl.Map} map - Map instance
   */
  constructor(map) {
    this.map = map;
    this.layers = new Map(); // Track created layers
  }

  /**
   * Setup all map sources
   */
  setupSources() {
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
        logger.debug(`Added source: ${sourceId}`);
      }
    });
  }

  /**
   * Add all map layers
   */
  addAllLayers() {
    // IMPORTANT: Layer order matters for click handling!
    // Areas and polygons should be at the bottom (rendered first)
    // POIs, lines, and locations should be on top (rendered last)
    
    const layers = LAYER_CONFIG.annotationLayers;
    
    // 1. Areas (fill) - bottom layer
    this.addAreaFillLayer(layers.area);
    
    // 2. Areas (stroke) - on top of area fill
    this.addAreaStrokeLayer(layers.areaStroke);
    
    // 3. Polygons (fill) - on top of areas
    this.addPolygonFillLayer(layers.polygon);
    
    // 4. Polygons (stroke) - on top of polygon fill
    this.addPolygonStrokeLayer(layers.polygonStroke);
    
    // 5. Lines - on top of areas and polygons
    this.addLineLayer(layers.line);
    
    // 6. POI markers - on top of everything (most important for clicking)
    this.addPoiLayer(layers.poi);
    
    // 7. Location markers - top layer (most important for clicking)
    this.addLocationLayer(LAYER_CONFIG.locationLayer);
  }

  /**
   * Add area fill layer
   */
  addAreaFillLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      logger.debug(`Layer ${layerId} already exists`);
      return;
    }
    
    this.map.addLayer({
      id: layerId,
      type: 'fill',
      source: LAYER_CONFIG.sources.annotationsArea,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['get', 'fillOpacity']
      }
    });
    
    this.layers.set(layerId, { type: 'fill', category: 'annotation' });
    logger.debug(`Added layer: ${layerId}`);
  }

  /**
   * Add area stroke layer
   */
  addAreaStrokeLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      logger.debug(`Layer ${layerId} already exists`);
      return;
    }
    
    this.map.addLayer({
      id: layerId,
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
    
    this.layers.set(layerId, { type: 'line', category: 'annotation' });
    logger.debug(`Added layer: ${layerId}`);
  }

  /**
   * Add polygon fill layer
   */
  addPolygonFillLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      logger.debug(`Layer ${layerId} already exists`);
      return;
    }
    
    this.map.addLayer({
      id: layerId,
      type: 'fill',
      source: LAYER_CONFIG.sources.annotationsPolygon,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.3
      }
    });
    
    this.layers.set(layerId, { type: 'fill', category: 'annotation' });
    logger.debug(`Added layer: ${layerId}`);
  }

  /**
   * Add polygon stroke layer
   */
  addPolygonStrokeLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      logger.debug(`Layer ${layerId} already exists`);
      return;
    }
    
    this.map.addLayer({
      id: layerId,
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
    
    this.layers.set(layerId, { type: 'line', category: 'annotation' });
    logger.debug(`Added layer: ${layerId}`);
  }

  /**
   * Add line layer
   */
  addLineLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      logger.debug(`Layer ${layerId} already exists`);
      return;
    }
    
    this.map.addLayer({
      id: layerId,
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
    
    this.layers.set(layerId, { type: 'line', category: 'annotation' });
    logger.debug(`Added layer: ${layerId}`);
  }

  /**
   * Add POI layer
   */
  addPoiLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      logger.debug(`Layer ${layerId} already exists`);
      return;
    }
    
    this.map.addLayer({
      id: layerId,
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
    
    this.layers.set(layerId, { type: 'symbol', category: 'annotation' });
    logger.debug(`Added layer: ${layerId}`);
  }

  /**
   * Add location layer
   */
  addLocationLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      logger.debug(`Layer ${layerId} already exists`);
      return;
    }
    
    this.map.addLayer({
      id: layerId,
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
    
    this.layers.set(layerId, { type: 'circle', category: 'location' });
    logger.debug(`Added layer: ${layerId}`);
  }

  /**
   * Update layer visibility
   * @param {string} category - Layer category ('annotation' or 'location')
   * @param {boolean} visible - Whether to show layers
   */
  updateVisibility(category, visible) {
    const visibility = visible ? 'visible' : 'none';
    
    this.layers.forEach((layerInfo, layerId) => {
      if (layerInfo.category === category) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
        logger.debug(`Set ${layerId} visibility to ${visibility}`);
      }
    });
  }

  /**
   * Update annotation layer visibility
   * @param {boolean} visible - Whether to show annotation layers
   */
  updateAnnotationVisibility(visible) {
    this.updateVisibility('annotation', visible);
  }

  /**
   * Update location layer visibility
   * @param {boolean} visible - Whether to show location layers
   */
  updateLocationVisibility(visible) {
    this.updateVisibility('location', visible);
  }

  /**
   * Get layer by ID
   * @param {string} layerId - Layer ID
   * @returns {Object|null} Layer object or null
   */
  getLayer(layerId) {
    return this.map.getLayer(layerId);
  }

  /**
   * Check if layer exists
   * @param {string} layerId - Layer ID
   * @returns {boolean}
   */
  hasLayer(layerId) {
    return !!this.map.getLayer(layerId);
  }

  /**
   * Remove layer
   * @param {string} layerId - Layer ID
   */
  removeLayer(layerId) {
    if (this.map.getLayer(layerId)) {
      this.map.removeLayer(layerId);
      this.layers.delete(layerId);
      logger.debug(`Removed layer: ${layerId}`);
    }
  }

  /**
   * Remove all layers
   */
  removeAllLayers() {
    this.layers.forEach((layerInfo, layerId) => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });
    this.layers.clear();
    logger.debug('Removed all layers');
  }
}
