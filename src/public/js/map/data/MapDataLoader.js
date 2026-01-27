/**
 * Map Data Loader
 * Coordinates loading of all map data (annotations, locations, teams)
 */

import { logger } from '../../utils/logger.js';
import { AnnotationManager } from '../annotation/AnnotationManager.js';
import { LocationManager } from './LocationManager.js';
import { TeamManager } from './TeamManager.js';

export class MapDataLoader {
  /**
   * Create a map data loader
   * @param {maplibregl.Map} map - Map instance
   * @param {EventBus} eventBus - Event bus instance
   * @param {MapStateManager} state - State manager instance
   */
  constructor(map, eventBus, state) {
    this.map = map;
    this.eventBus = eventBus;
    this.state = state;
    
    // Initialize managers
    this.annotationManager = new AnnotationManager(map);
    this.locationManager = new LocationManager(map, eventBus);
    this.teamManager = new TeamManager(eventBus);
    
    // Loading state
    this.isLoading = false;
    this.loadError = null;
  }

  /**
   * Load all map data
   * @param {Object} options - Loading options
   * @param {boolean} options.loadTeams - Whether to load teams (default: true)
   * @param {boolean} options.loadAnnotations - Whether to load annotations (default: true)
   * @param {boolean} options.loadLocations - Whether to load locations (default: true)
   * @returns {Promise<Object>} Loaded data
   */
  async loadAll(options = {}) {
    const {
      loadTeams = true,
      loadAnnotations = true,
      loadLocations = true
    } = options;
    
    if (this.isLoading) {
      logger.warn('Data load already in progress');
      return;
    }
    
    this.isLoading = true;
    this.loadError = null;
    
    try {
      logger.debug('Starting map data load...');
      
      const loadPromises = [];
      
      // Load teams first (needed for filtering)
      if (loadTeams) {
        loadPromises.push(this.teamManager.loadTeams());
      }
      
      // Load annotations and locations in parallel
      const currentTeamId = this.state.getCurrentTeamId();
      
      if (loadAnnotations) {
        loadPromises.push(
          this.annotationManager.loadAnnotations(currentTeamId)
            .then(() => {
              this.eventBus.emit('annotations:loaded', this.annotationManager.getAnnotations());
            })
        );
      }
      
      if (loadLocations) {
        loadPromises.push(
          this.locationManager.loadLocations(currentTeamId)
        );
      }
      
      await Promise.all(loadPromises);
      
      logger.info('Map data loaded successfully');
      
      return {
        teams: this.teamManager.getTeams(),
        annotations: this.annotationManager.getAnnotations(),
        locations: this.locationManager.getLocations()
      };
    } catch (error) {
      this.loadError = error;
      logger.error('Failed to load map data:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Reload all data
   * @returns {Promise<Object>} Reloaded data
   */
  async reload() {
    logger.debug('Reloading all map data...');
    return this.loadAll();
  }

  /**
   * Load only annotations
   * @returns {Promise<Array>} Annotations
   */
  async loadAnnotations() {
    const currentTeamId = this.state.getCurrentTeamId();
    await this.annotationManager.loadAnnotations(currentTeamId);
    this.eventBus.emit('annotations:loaded', this.annotationManager.getAnnotations());
    return this.annotationManager.getAnnotations();
  }

  /**
   * Load only locations
   * @returns {Promise<Array>} Locations
   */
  async loadLocations() {
    const currentTeamId = this.state.getCurrentTeamId();
    await this.locationManager.loadLocations(currentTeamId);
    return this.locationManager.getLocations();
  }

  /**
   * Load only teams
   * @returns {Promise<Array>} Teams
   */
  async loadTeams() {
    await this.teamManager.loadTeams();
    return this.teamManager.getTeams();
  }

  /**
   * Update map with current data
   */
  updateMap() {
    this.annotationManager.updateMap();
    this.locationManager.updateMap();
  }

  /**
   * Get annotation manager
   * @returns {AnnotationManager}
   */
  getAnnotationManager() {
    return this.annotationManager;
  }

  /**
   * Get location manager
   * @returns {LocationManager}
   */
  getLocationManager() {
    return this.locationManager;
  }

  /**
   * Get team manager
   * @returns {TeamManager}
   */
  getTeamManager() {
    return this.teamManager;
  }

  /**
   * Check if currently loading
   * @returns {boolean}
   */
  getIsLoading() {
    return this.isLoading;
  }

  /**
   * Get last load error
   * @returns {Error|null}
   */
  getLoadError() {
    return this.loadError;
  }
}
