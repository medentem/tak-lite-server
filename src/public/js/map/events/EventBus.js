/**
 * Event Bus
 * Centralized event system for component communication
 */

import { logger } from '../../utils/logger.js';

export class EventBus {
  constructor() {
    this.listeners = new Map();
    this.onceListeners = new Map();
    logger.debug('EventBus initialized');
  }

  /**
   * Subscribe to an event
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    
    logger.debug(`Event listener added for: ${eventName}`);
    
    // Return unsubscribe function
    return () => {
      this.off(eventName, callback);
    };
  }

  /**
   * Subscribe to an event once
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  once(eventName, callback) {
    if (!this.onceListeners.has(eventName)) {
      this.onceListeners.set(eventName, new Set());
    }
    this.onceListeners.get(eventName).add(callback);
    
    logger.debug(`One-time event listener added for: ${eventName}`);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.onceListeners.get(eventName);
      if (callbacks) {
        callbacks.delete(callback);
      }
    };
  }

  /**
   * Unsubscribe from an event
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function (optional, removes all if not provided)
   */
  off(eventName, callback = null) {
    if (callback) {
      // Remove specific callback
      const callbacks = this.listeners.get(eventName);
      if (callbacks) {
        callbacks.delete(callback);
        logger.debug(`Event listener removed for: ${eventName}`);
      }
      
      const onceCallbacks = this.onceListeners.get(eventName);
      if (onceCallbacks) {
        onceCallbacks.delete(callback);
      }
    } else {
      // Remove all callbacks for this event
      this.listeners.delete(eventName);
      this.onceListeners.delete(eventName);
      logger.debug(`All event listeners removed for: ${eventName}`);
    }
  }

  /**
   * Emit an event
   * @param {string} eventName - Event name
   * @param {*} data - Event data
   */
  emit(eventName, data = null) {
    logger.debug(`Event emitted: ${eventName}`, data);
    
    // Call regular listeners
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          logger.error(`Error in event listener for ${eventName}:`, error);
        }
      });
    }
    
    // Call once listeners and remove them
    const onceCallbacks = this.onceListeners.get(eventName);
    if (onceCallbacks) {
      onceCallbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          logger.error(`Error in one-time event listener for ${eventName}:`, error);
        }
      });
      onceCallbacks.clear();
    }
  }

  /**
   * Remove all listeners
   */
  clear() {
    this.listeners.clear();
    this.onceListeners.clear();
    logger.debug('EventBus cleared');
  }

  /**
   * Get listener count for an event
   * @param {string} eventName - Event name
   * @returns {number}
   */
  listenerCount(eventName) {
    const regular = this.listeners.get(eventName)?.size || 0;
    const once = this.onceListeners.get(eventName)?.size || 0;
    return regular + once;
  }

  /**
   * Get all event names with listeners
   * @returns {Array<string>}
   */
  getEventNames() {
    const regular = Array.from(this.listeners.keys());
    const once = Array.from(this.onceListeners.keys());
    return [...new Set([...regular, ...once])];
  }
}

// Event name constants for type safety and consistency
export const MAP_EVENTS = {
  // Annotation events
  ANNOTATION_CREATED: 'annotation:created',
  ANNOTATION_UPDATED: 'annotation:updated',
  ANNOTATION_DELETED: 'annotation:deleted',
  ANNOTATION_BULK_DELETED: 'annotation:bulk_deleted',
  ANNOTATIONS_LOADED: 'annotations:loaded',
  
  // Drawing events
  DRAWING_STARTED: 'drawing:started',
  DRAWING_FINISHED: 'drawing:finished',
  DRAWING_CANCELLED: 'drawing:cancelled',
  
  // Menu events
  MENU_OPENED: 'menu:opened',
  MENU_CLOSED: 'menu:closed',
  FAN_MENU_OPENED: 'fan_menu:opened',
  FAN_MENU_CLOSED: 'fan_menu:closed',
  COLOR_MENU_OPENED: 'color_menu:opened',
  COLOR_MENU_CLOSED: 'color_menu:closed',
  
  // Location events
  LOCATION_UPDATED: 'location:updated',
  LOCATIONS_LOADED: 'locations:loaded',
  
  // Team events
  TEAM_SELECTED: 'team:selected',
  TEAMS_LOADED: 'teams:loaded',
  
  // Map events
  MAP_LOADED: 'map:loaded',
  MAP_DATA_UPDATED: 'map:data_updated',
  MAP_CENTERED: 'map:centered',
  
  // UI events
  POPUP_OPENED: 'popup:opened',
  POPUP_CLOSED: 'popup:closed',
  EDIT_FORM_OPENED: 'edit_form:opened',
  EDIT_FORM_CLOSED: 'edit_form:closed',
  FEEDBACK_SHOWN: 'feedback:shown',
  
  // Interaction events
  LONG_PRESS_STARTED: 'long_press:started',
  LONG_PRESS_ENDED: 'long_press:ended',
  LONG_PRESS_CANCELLED: 'long_press:cancelled'
};
