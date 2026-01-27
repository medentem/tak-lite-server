/**
 * Map Bounds Manager
 * Handles map bounds calculation and centering
 */

import { logger } from '../../utils/logger.js';
import { extractCoordinates } from '../../utils/geography.js';
import { DISPLAY_CONFIG, TIMING } from '../../config/mapConfig.js';

export class MapBoundsManager {
  /**
   * Create a map bounds manager
   * @param {maplibregl.Map} map - Map instance
   */
  constructor(map) {
    this.map = map;
  }

  /**
   * Auto-center map based on user location or existing data
   * @param {Array} annotations - Annotations array
   * @param {Array} locations - Locations array
   * @returns {Promise<void>}
   */
  async autoCenter(annotations = [], locations = []) {
    if (!this.map) return;
    
    // First try to get user's current location
    if (navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            logger.debug('Centering map on user location:', latitude, longitude);
            this.map.flyTo({
              center: [longitude, latitude],
              zoom: DISPLAY_CONFIG.userLocationZoom,
              duration: 1000
            });
            resolve();
          },
          (error) => {
            // Only log non-permission errors to reduce noise
            if (error.code !== error.PERMISSION_DENIED) {
              logger.debug('Geolocation failed:', error.message);
            }
            // Fall back to centering on existing data
            this.centerOnData(annotations, locations);
            resolve();
          },
          {
            enableHighAccuracy: true,
            timeout: TIMING.geolocationTimeout,
            maximumAge: TIMING.geolocationMaxAge
          }
        );
      });
    } else {
      // Geolocation not available, center on data
      this.centerOnData(annotations, locations);
    }
  }

  /**
   * Center map on data (annotations and locations)
   * @param {Array} annotations - Annotations array
   * @param {Array} locations - Locations array
   */
  centerOnData(annotations = [], locations = []) {
    if (!this.map) return;
    
    // Calculate bounds of all features
    const allFeatures = [];
    
    // Add annotation features
    annotations.forEach(annotation => {
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
              const polygonCoords = extractCoordinates(p);
              if (polygonCoords) {
                allFeatures.push(polygonCoords);
              }
            });
          }
          break;
      }
    });
    
    // Add location features
    locations.forEach(location => {
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
        
        this.map.fitBounds(bounds, { 
          padding: DISPLAY_CONFIG.fitBoundsPadding, 
          duration: 1000 
        });
        logger.debug(`Centered map on ${allFeatures.length} valid coordinates`);
      } catch (error) {
        logger.error('Error centering map on data:', error);
        logger.debug('Problematic coordinates:', allFeatures.slice(0, 5)); // Log first 5 for debugging
        // Fall back to default center
        this.centerOnDefault();
      }
    } else {
      // Default to US center if no data
      this.centerOnDefault();
    }
  }

  /**
   * Center map on default location
   */
  centerOnDefault() {
    if (!this.map) return;
    
    this.map.flyTo({ 
      center: DISPLAY_CONFIG.defaultCenter, 
      zoom: DISPLAY_CONFIG.defaultZoom, 
      duration: 1000 
    });
    logger.debug('Fell back to default center due to no data or bounds error');
  }

  /**
   * Center map on specific coordinates
   * @param {number} longitude - Longitude
   * @param {number} latitude - Latitude
   * @param {number} zoom - Zoom level (optional)
   */
  centerOnCoordinates(longitude, latitude, zoom = null) {
    if (!this.map) return;
    
    const options = {
      center: [longitude, latitude],
      duration: 1000
    };
    
    if (zoom !== null) {
      options.zoom = zoom;
    }
    
    this.map.flyTo(options);
    logger.debug(`Centered map on coordinates: ${latitude}, ${longitude}`);
  }

  /**
   * Fit bounds to coordinates
   * @param {Array<Array<number>>} coordinates - Array of [lng, lat] coordinates
   * @param {Object} options - Fit bounds options
   */
  fitBounds(coordinates, options = {}) {
    if (!this.map || !coordinates || coordinates.length === 0) return;
    
    try {
      const bounds = coordinates.reduce((bounds, coord) => {
        return bounds.extend(coord);
      }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
      
      this.map.fitBounds(bounds, {
        padding: DISPLAY_CONFIG.fitBoundsPadding,
        duration: 1000,
        ...options
      });
      
      logger.debug(`Fitted bounds to ${coordinates.length} coordinates`);
    } catch (error) {
      logger.error('Error fitting bounds:', error);
      this.centerOnDefault();
    }
  }

  /**
   * Get current map bounds
   * @returns {maplibregl.LngLatBounds|null} Current bounds or null
   */
  getBounds() {
    if (!this.map) return null;
    return this.map.getBounds();
  }

  /**
   * Get current map center
   * @returns {maplibregl.LngLat|null} Current center or null
   */
  getCenter() {
    if (!this.map) return null;
    return this.map.getCenter();
  }

  /**
   * Get current zoom level
   * @returns {number|null} Current zoom or null
   */
  getZoom() {
    if (!this.map) return null;
    return this.map.getZoom();
  }
}
