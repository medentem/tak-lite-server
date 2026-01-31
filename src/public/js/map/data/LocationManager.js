/**
 * Location Manager
 * Manages location data loading, updates, and GeoJSON conversion
 */

import { logger } from '../../utils/logger.js';
import { get } from '../../utils/api.js';
import { extractCoordinates } from '../../utils/geography.js';
import { API_ENDPOINTS, DATA_LIMITS, DISPLAY_CONFIG, LAYER_CONFIG } from '../../config/mapConfig.js';

export class LocationManager {
  /**
   * Create a location manager
   * @param {maplibregl.Map} map - Map instance
   * @param {EventBus} eventBus - Event bus instance
   */
  constructor(map, eventBus) {
    this.map = map;
    this.eventBus = eventBus;
    this.locations = [];
  }

  /**
   * Load locations from API
   * @param {string|null} teamId - Optional team ID filter
   * @returns {Promise<Array>} Array of locations
   */
  async loadLocations(teamId = null) {
    try {
      let url;
      let params = new URLSearchParams();
      
      if (!teamId) {
        // Load locations from all teams
        params.append('limit', DATA_LIMITS.maxLocations.toString());
        url = `${API_ENDPOINTS.locations}?${params}`;
        logger.debug(`Loading locations from: ${url}`);
        
        this.locations = await get(url);
        logger.info(`Loaded ${this.locations.length} locations from all teams`);
      } else {
        // Use the latest endpoint for specific team
        params.append('teamId', teamId);
        url = `${API_ENDPOINTS.locationsLatest}?${params}`;
        logger.debug(`Loading latest locations from: ${url}`);
        
        this.locations = await get(url);
        logger.info(`Loaded ${this.locations.length} latest locations for team ${teamId}`);
      }
      
      this.eventBus.emit('locations:loaded', this.locations);
      return this.locations;
    } catch (error) {
      logger.error('Failed to load locations:', error);
      this.locations = [];
      return [];
    }
  }

  /**
   * Update location from WebSocket event
   * @param {Object} data - Location update data
   */
  updateLocation(data) {
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
        user_email: data.user_email ?? '',
        user_status: data.user_status || 'GREEN'
      };
      this.locations.unshift(newLocation); // Add to beginning of array
    }
    
    this.eventBus.emit('location:updated', {
      location: this.locations[existingIndex >= 0 ? existingIndex : 0],
      userId: data.userId
    });
    
    logger.debug(`Updated location for user ${data.userId}`);
  }

  /**
   * Convert locations to GeoJSON features
   * @returns {Array} Array of GeoJSON features
   */
  convertToGeoJSON() {
    const now = Date.now();
    const stalenessThresholdMs = DISPLAY_CONFIG.stalenessThresholdMs;
    
    return this.locations
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
  }

  /**
   * Update map with location data
   */
  updateMap() {
    if (!this.map) {
      logger.warn('Cannot update map: map not initialized');
      return;
    }
    
    const locationFeatures = this.convertToGeoJSON();
    
    if (this.map.getSource(LAYER_CONFIG.sources.locations)) {
      this.map.getSource(LAYER_CONFIG.sources.locations).setData({
        type: 'FeatureCollection',
        features: locationFeatures
      });
    }
    
    logger.debug(`Updated map with ${locationFeatures.length} locations`);
  }

  /**
   * Get locations array
   * @returns {Array} Locations array
   */
  getLocations() {
    return this.locations;
  }

  /**
   * Set locations array
   * @param {Array} locations - Locations array
   */
  setLocations(locations) {
    this.locations = locations;
  }

  /**
   * Filter locations by team ID
   * @param {string|null} teamId - Team ID to filter by
   * @returns {Array} Filtered locations
   */
  filterByTeam(teamId) {
    if (!teamId) {
      return this.locations;
    }
    return this.locations.filter(location => location.team_id === teamId);
  }

  /**
   * Clear all locations
   */
  clear() {
    this.locations = [];
    if (this.map && this.map.getSource(LAYER_CONFIG.sources.locations)) {
      this.map.getSource(LAYER_CONFIG.sources.locations).setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }
}
