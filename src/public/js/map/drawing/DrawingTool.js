/**
 * Base Drawing Tool Class
 * Abstract base class for all drawing tools
 */

import { logger } from '../../utils/logger.js';

export class DrawingTool {
  /**
   * Create a drawing tool
   * @param {maplibregl.Map} map - Map instance
   * @param {Object} options - Tool options
   */
  constructor(map, options = {}) {
    this.map = map;
    this.isActive = false;
    this.options = options;
    this.handlers = new Map(); // Store event handlers for cleanup
  }

  /**
   * Start drawing (to be implemented by subclasses)
   * @param {maplibregl.LngLat} lngLat - Starting location
   * @param {string} color - Annotation color
   */
  start(lngLat, color) {
    this.isActive = true;
    this.currentColor = color;
    logger.debug(`${this.constructor.name} started`);
  }

  /**
   * Cancel drawing (to be implemented by subclasses)
   */
  cancel() {
    this.isActive = false;
    this.cleanup();
    logger.debug(`${this.constructor.name} cancelled`);
  }

  /**
   * Finish drawing (to be implemented by subclasses)
   * @returns {Object|null} Annotation data or null
   */
  finish() {
    this.isActive = false;
    this.cleanup();
    logger.debug(`${this.constructor.name} finished`);
    return null;
  }

  /**
   * Register event handler for cleanup
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {string} target - Target ('map' or 'document')
   */
  registerHandler(event, handler, target = 'map') {
    const key = `${target}:${event}`;
    if (this.handlers.has(key)) {
      this.unregisterHandler(event, target);
    }
    
    if (target === 'map') {
      this.map.on(event, handler);
    } else {
      document.addEventListener(event, handler);
    }
    
    this.handlers.set(key, { handler, target });
  }

  /**
   * Unregister event handler
   * @param {string} event - Event name
   * @param {string} target - Target ('map' or 'document')
   */
  unregisterHandler(event, target = 'map') {
    const key = `${target}:${event}`;
    const stored = this.handlers.get(key);
    if (stored) {
      if (target === 'map') {
        this.map.off(event, stored.handler);
      } else {
        document.removeEventListener(event, stored.handler);
      }
      this.handlers.delete(key);
    }
  }

  /**
   * Cleanup all handlers
   */
  cleanup() {
    this.handlers.forEach((stored, key) => {
      const [target, event] = key.split(':');
      if (target === 'map') {
        this.map.off(event, stored.handler);
      } else {
        document.removeEventListener(event, stored.handler);
      }
    });
    this.handlers.clear();
  }

  /**
   * Check if tool is active
   * @returns {boolean}
   */
  getIsActive() {
    return this.isActive;
  }
}
