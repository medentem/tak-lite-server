/**
 * Map Initialization Module
 * Handles map instance creation, style configuration, and basic setup
 */

import { logger } from '../utils/logger.js';
import { q } from '../utils/dom.js';
import { DISPLAY_CONFIG } from '../config/mapConfig.js';

export class MapInitializer {
  /**
   * Create a map initializer
   * @param {string} containerId - ID of the map container element
   */
  constructor(containerId = 'map_container') {
    this.containerId = containerId;
    this.map = null;
  }

  /**
   * Initialize the map instance
   * @returns {Promise<maplibregl.Map>} The initialized map instance
   */
  async initialize() {
    const container = q(`#${this.containerId}`);
    if (!container) {
      logger.error('Map container not found');
      throw new Error(`Map container #${this.containerId} not found`);
    }
    
    logger.debug('Map container found, initializing map...');
    logger.debug('Map container dimensions:', {
      width: container.offsetWidth,
      height: container.offsetHeight,
      clientWidth: container.clientWidth,
      clientHeight: container.clientHeight
    });
    
    // Check if container is visible
    const containerStyle = window.getComputedStyle(container);
    logger.debug('Map container visibility:', {
      display: containerStyle.display,
      visibility: containerStyle.visibility,
      opacity: containerStyle.opacity,
      position: containerStyle.position
    });
    
    // Preserve annotation UI elements
    this.preserveUIElements(container);
    
    // Create map style
    const darkStyle = this.createMapStyle();
    
    // Create map instance
    this.map = this.createMapInstance(this.containerId, darkStyle);
    
    // Setup controls
    this.setupControls();
    
    return this.map;
  }

  /**
   * Preserve UI elements when clearing container
   * @param {HTMLElement} container - Map container element
   */
  preserveUIElements(container) {
    const fanMenu = container.querySelector('#fan_menu');
    const colorMenu = container.querySelector('#color_menu');
    const feedback = container.querySelector('#map_feedback');
    
    container.innerHTML = '';
    
    // Restore annotation UI elements
    if (fanMenu) container.appendChild(fanMenu);
    if (colorMenu) container.appendChild(colorMenu);
    if (feedback) container.appendChild(feedback);
  }

  /**
   * Create map style configuration
   * @returns {Object} Map style object
   */
  createMapStyle() {
    return {
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
  }

  /**
   * Create map instance
   * @param {string} containerId - Container ID
   * @param {Object} style - Map style configuration
   * @returns {maplibregl.Map} Map instance
   */
  createMapInstance(containerId, style) {
    try {
      const map = new maplibregl.Map({
        container: containerId,
        style: style,
        center: [0, 0], // Default center, will be updated based on data or user location
        zoom: 2,
        attributionControl: false
      });
      
      logger.debug('Map instance created:', map);
      
      // Setup map load handler
      map.on('load', () => {
        this.onMapLoad(map);
      });
      
      map.on('error', (e) => {
        logger.error('Map error:', e);
      });
      
      // Add basic interaction test
      map.on('click', (e) => {
        logger.debug('Map clicked at:', e.lngLat);
      });
      
      // Test if map is interactive (simplified)
      map.on('mousemove', (e) => {
        // Only log occasionally to avoid spam
        if (Math.random() < 0.01) {
          logger.debug('Map mousemove:', e.lngLat);
        }
      });
      
      return map;
    } catch (error) {
      logger.error('Failed to create map:', error);
      throw error;
    }
  }

  /**
   * Handle map load event
   * @param {maplibregl.Map} map - Map instance
   */
  onMapLoad(map) {
    logger.info('Map loaded successfully');
    logger.debug('Map dimensions after load:', {
      width: map.getContainer().offsetWidth,
      height: map.getContainer().offsetHeight
    });
    
    // Check if map canvas exists
    const canvas = map.getCanvas();
    logger.debug('Map canvas:', canvas);
    logger.debug('Canvas dimensions:', {
      width: canvas.width,
      height: canvas.height,
      offsetWidth: canvas.offsetWidth,
      offsetHeight: canvas.offsetHeight
    });
    
    // Test if canvas is interactive
    canvas.style.pointerEvents = 'auto';
    logger.debug('Canvas pointer events set to auto');
    
    // Check for any overlaying elements
    const container = map.getContainer();
    const elements = container.querySelectorAll('*');
    logger.debug('Elements in map container:', elements.length);
    elements.forEach((el, i) => {
      if (i < 5) { // Only log first 5 elements
        const style = window.getComputedStyle(el);
        logger.debug(`Element ${i}:`, {
          tagName: el.tagName,
          className: el.className,
          pointerEvents: style.pointerEvents,
          position: style.position,
          zIndex: style.zIndex
        });
      }
    });
    
    // Ensure map is properly sized
    map.resize();
  }

  /**
   * Setup map controls (navigation, fullscreen, etc.)
   */
  setupControls() {
    if (!this.map) {
      logger.warn('Cannot setup controls: map not initialized');
      return;
    }
    
    // Add navigation controls
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    // Add fullscreen control
    this.map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  }

  /**
   * Get the map instance
   * @returns {maplibregl.Map|null} Map instance
   */
  getMap() {
    return this.map;
  }
}
