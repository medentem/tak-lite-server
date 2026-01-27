/**
 * Map State Manager
 * Centralized state management for the map application
 */

import { logger } from '../../utils/logger.js';

export class MapStateManager {
  constructor() {
    // Team and filter state
    this.currentTeamId = null;
    this.teams = [];
    
    // Visibility state
    this.showAnnotations = true;
    this.showLocations = true;
    
    // Drawing state
    this.currentDrawingTool = null;
    this.pendingAnnotation = null;
    this.currentColor = 'green';
    this.currentShape = 'circle';
    
    // UI state
    this.currentEditingAnnotation = null;
    this.isLongPressing = false;
    
    // Listeners for state changes
    this.listeners = new Map();
    
    logger.debug('MapStateManager initialized');
  }

  /**
   * Subscribe to state changes
   * @param {string} key - State key to watch
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(key);
      if (callbacks) {
        callbacks.delete(callback);
      }
    };
  }

  /**
   * Notify listeners of state change
   * @param {string} key - State key that changed
   * @param {*} oldValue - Previous value
   * @param {*} newValue - New value
   */
  notify(key, oldValue, newValue) {
    const callbacks = this.listeners.get(key);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(newValue, oldValue, key);
        } catch (error) {
          logger.error(`Error in state listener for ${key}:`, error);
        }
      });
    }
  }

  /**
   * Get current team ID
   * @returns {string|null}
   */
  getCurrentTeamId() {
    return this.currentTeamId;
  }

  /**
   * Set current team ID
   * @param {string|null} teamId
   */
  setCurrentTeamId(teamId) {
    const oldValue = this.currentTeamId;
    this.currentTeamId = teamId;
    this.notify('currentTeamId', oldValue, teamId);
    logger.debug('Current team ID changed:', teamId);
  }

  /**
   * Get teams array
   * @returns {Array}
   */
  getTeams() {
    return this.teams;
  }

  /**
   * Set teams array
   * @param {Array} teams
   */
  setTeams(teams) {
    const oldValue = [...this.teams];
    this.teams = teams;
    this.notify('teams', oldValue, teams);
    logger.debug('Teams updated:', teams.length);
  }

  /**
   * Get show annotations flag
   * @returns {boolean}
   */
  getShowAnnotations() {
    return this.showAnnotations;
  }

  /**
   * Set show annotations flag
   * @param {boolean} show
   */
  setShowAnnotations(show) {
    const oldValue = this.showAnnotations;
    this.showAnnotations = show;
    this.notify('showAnnotations', oldValue, show);
    logger.debug('Show annotations changed:', show);
  }

  /**
   * Get show locations flag
   * @returns {boolean}
   */
  getShowLocations() {
    return this.showLocations;
  }

  /**
   * Set show locations flag
   * @param {boolean} show
   */
  setShowLocations(show) {
    const oldValue = this.showLocations;
    this.showLocations = show;
    this.notify('showLocations', oldValue, show);
    logger.debug('Show locations changed:', show);
  }

  /**
   * Get current drawing tool
   * @returns {Object|null}
   */
  getCurrentDrawingTool() {
    return this.currentDrawingTool;
  }

  /**
   * Set current drawing tool
   * @param {Object|null} tool
   */
  setCurrentDrawingTool(tool) {
    const oldValue = this.currentDrawingTool;
    this.currentDrawingTool = tool;
    this.notify('currentDrawingTool', oldValue, tool);
    logger.debug('Current drawing tool changed:', tool?.constructor?.name || null);
  }

  /**
   * Get pending annotation
   * @returns {maplibregl.LngLat|null}
   */
  getPendingAnnotation() {
    return this.pendingAnnotation;
  }

  /**
   * Set pending annotation
   * @param {maplibregl.LngLat|null} lngLat
   */
  setPendingAnnotation(lngLat) {
    const oldValue = this.pendingAnnotation;
    this.pendingAnnotation = lngLat;
    this.notify('pendingAnnotation', oldValue, lngLat);
    logger.debug('Pending annotation changed:', lngLat);
  }

  /**
   * Get current color
   * @returns {string}
   */
  getCurrentColor() {
    return this.currentColor;
  }

  /**
   * Set current color
   * @param {string} color
   */
  setCurrentColor(color) {
    const oldValue = this.currentColor;
    this.currentColor = color;
    this.notify('currentColor', oldValue, color);
    logger.debug('Current color changed:', color);
  }

  /**
   * Get current shape
   * @returns {string}
   */
  getCurrentShape() {
    return this.currentShape;
  }

  /**
   * Set current shape
   * @param {string} shape
   */
  setCurrentShape(shape) {
    const oldValue = this.currentShape;
    this.currentShape = shape;
    this.notify('currentShape', oldValue, shape);
    logger.debug('Current shape changed:', shape);
  }

  /**
   * Get current editing annotation
   * @returns {Object|null}
   */
  getCurrentEditingAnnotation() {
    return this.currentEditingAnnotation;
  }

  /**
   * Set current editing annotation
   * @param {Object|null} annotation
   */
  setCurrentEditingAnnotation(annotation) {
    const oldValue = this.currentEditingAnnotation;
    this.currentEditingAnnotation = annotation;
    this.notify('currentEditingAnnotation', oldValue, annotation);
    logger.debug('Current editing annotation changed:', annotation?.id || null);
  }

  /**
   * Get is long pressing flag
   * @returns {boolean}
   */
  getIsLongPressing() {
    return this.isLongPressing;
  }

  /**
   * Set is long pressing flag
   * @param {boolean} isPressing
   */
  setIsLongPressing(isPressing) {
    const oldValue = this.isLongPressing;
    this.isLongPressing = isPressing;
    this.notify('isLongPressing', oldValue, isPressing);
    logger.debug('Is long pressing changed:', isPressing);
  }

  /**
   * Reset all state to initial values
   */
  reset() {
    this.setCurrentTeamId(null);
    this.setTeams([]);
    this.setShowAnnotations(true);
    this.setShowLocations(true);
    this.setCurrentDrawingTool(null);
    this.setPendingAnnotation(null);
    this.setCurrentColor('green');
    this.setCurrentShape('circle');
    this.setCurrentEditingAnnotation(null);
    this.setIsLongPressing(false);
    logger.debug('MapStateManager reset');
  }

  /**
   * Get all state as an object (for debugging)
   * @returns {Object}
   */
  getState() {
    return {
      currentTeamId: this.currentTeamId,
      teams: this.teams,
      showAnnotations: this.showAnnotations,
      showLocations: this.showLocations,
      currentDrawingTool: this.currentDrawingTool,
      pendingAnnotation: this.pendingAnnotation,
      currentColor: this.currentColor,
      currentShape: this.currentShape,
      currentEditingAnnotation: this.currentEditingAnnotation,
      isLongPressing: this.isLongPressing
    };
  }
}
