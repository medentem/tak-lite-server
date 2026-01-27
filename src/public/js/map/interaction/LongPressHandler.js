/**
 * Long Press Handler
 * Handles long press detection on the map
 */

import { logger } from '../../utils/logger.js';
import { INTERACTION_CONFIG } from '../../config/mapConfig.js';

export class LongPressHandler {
  /**
   * Create a long press handler
   * @param {maplibregl.Map} map - Map instance
   * @param {Object} options - Options
   * @param {Function} options.onLongPress - Callback when long press is detected
   * @param {Function} options.onCancel - Callback when long press is cancelled
   * @param {number} options.threshold - Long press threshold in milliseconds
   */
  constructor(map, options = {}) {
    this.map = map;
    this.onLongPress = options.onLongPress || null;
    this.onCancel = options.onCancel || null;
    this.threshold = options.threshold || INTERACTION_CONFIG.longPressThreshold;
    
    this.longPressTimer = null;
    this.longPressTriggered = false;
    this.longPressStartEvent = null;
    this.isActive = false;
    
    logger.debug('LongPressHandler initialized with threshold:', this.threshold);
  }

  /**
   * Start listening for long press events
   */
  start() {
    if (this.isActive) {
      logger.warn('LongPressHandler is already active');
      return;
    }
    
    this.isActive = true;
    this.map.on('mousedown', this.handleMouseDown);
    this.map.on('mouseup', this.handleMouseUp);
    this.map.on('mouseleave', this.handleMouseLeave);
    this.map.on('mousemove', this.handleMouseMove);
    
    logger.debug('LongPressHandler started');
  }

  /**
   * Stop listening for long press events
   */
  stop() {
    if (!this.isActive) return;
    
    this.cancelLongPress();
    this.map.off('mousedown', this.handleMouseDown);
    this.map.off('mouseup', this.handleMouseUp);
    this.map.off('mouseleave', this.handleMouseLeave);
    this.map.off('mousemove', this.handleMouseMove);
    
    this.isActive = false;
    logger.debug('LongPressHandler stopped');
  }

  /**
   * Handle mouse down event
   * @param {maplibregl.MapMouseEvent} e - Mouse event
   */
  handleMouseDown = (e) => {
    // Check if clicking on UI elements that should not trigger long press
    if (this.shouldIgnoreEvent(e)) {
      return;
    }
    
    this.longPressTriggered = false;
    this.longPressStartEvent = e;
    
    // Start long press timer
    this.longPressTimer = setTimeout(() => {
      if (this.isActive) {
        this.triggerLongPress(e);
      }
    }, this.threshold);
    
    logger.debug('Long press timer started');
  }

  /**
   * Handle mouse up event
   * @param {maplibregl.MapMouseEvent} e - Mouse event
   */
  handleMouseUp = (e) => {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    
    // If long press was triggered, mark the event to prevent click handlers
    if (this.longPressTriggered) {
      logger.debug('Long press completed, marking event');
      if (e.originalEvent) {
        e.originalEvent._longPressHandled = true;
      }
      e._longPressHandled = true;
      this.longPressTriggered = false;
      this.longPressStartEvent = null;
    }
  }

  /**
   * Handle mouse leave event
   * @param {maplibregl.MapMouseEvent} e - Mouse event
   */
  handleMouseLeave = (e) => {
    this.cancelLongPress();
  }

  /**
   * Handle mouse move event
   * @param {maplibregl.MapMouseEvent} e - Mouse event
   */
  handleMouseMove = (e) => {
    // Cancel long press if mouse moves too far from start position
    if (this.longPressStartEvent && this.longPressTimer) {
      const startPoint = this.longPressStartEvent.point;
      const currentPoint = e.point;
      const distance = Math.sqrt(
        Math.pow(currentPoint.x - startPoint.x, 2) + 
        Math.pow(currentPoint.y - startPoint.y, 2)
      );
      
      // Cancel if moved more than 10 pixels
      if (distance > 10) {
        logger.debug('Long press cancelled due to mouse movement');
        this.cancelLongPress();
      }
    }
  }

  /**
   * Trigger long press callback
   * @param {maplibregl.MapMouseEvent} e - Mouse event
   */
  triggerLongPress(e) {
    this.longPressTriggered = true;
    logger.debug('Long press detected at:', e.point);
    
    if (this.onLongPress) {
      this.onLongPress(e);
    }
  }

  /**
   * Cancel long press
   */
  cancelLongPress() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    
    if (this.longPressTriggered) {
      this.longPressTriggered = false;
      if (this.onCancel) {
        this.onCancel();
      }
    }
    
    this.longPressStartEvent = null;
  }

  /**
   * Check if event should be ignored
   * @param {maplibregl.MapMouseEvent} e - Mouse event
   * @returns {boolean}
   */
  shouldIgnoreEvent(e) {
    if (!e.originalEvent || !e.originalEvent.target) {
      return false;
    }
    
    const target = e.originalEvent.target;
    return !!(
      target.closest('.maplibregl-popup') ||
      target.closest('.fan-menu') ||
      target.closest('.color-menu') ||
      target.closest('.annotation-edit-form') ||
      target.closest('.modal-overlay')
    );
  }

  /**
   * Check if long press is currently active
   * @returns {boolean}
   */
  isLongPressing() {
    return this.longPressTriggered;
  }

  /**
   * Set long press threshold
   * @param {number} threshold - Threshold in milliseconds
   */
  setThreshold(threshold) {
    this.threshold = threshold;
    logger.debug('Long press threshold changed to:', threshold);
  }
}
