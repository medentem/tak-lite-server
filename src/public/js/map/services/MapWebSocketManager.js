/**
 * Map WebSocket Manager
 * Handles WebSocket events specific to map functionality
 */

import { logger } from '../../utils/logger.js';
import { MAP_EVENTS } from '../../events/EventBus.js';
import { TIMING } from '../../config/mapConfig.js';

export class MapWebSocketManager {
  /**
   * Create a map WebSocket manager
   * @param {EventBus} eventBus - Event bus instance
   * @param {Function} loadMapDataCallback - Callback to reload map data
   */
  constructor(eventBus, loadMapDataCallback = null) {
    this.eventBus = eventBus;
    this.loadMapDataCallback = loadMapDataCallback;
    this.isConnected = false;
    this.listeners = new Map();
  }

  /**
   * Connect to WebSocket and setup listeners
   */
  connect() {
    if (!window.socket) {
      logger.warn('WebSocket not available');
      return;
    }
    
    if (this.isConnected) {
      logger.warn('WebSocket already connected');
      return;
    }
    
    logger.debug('Setting up map WebSocket listeners...');
    
    // Listen for annotation updates
    const annotationUpdateHandler = (data) => {
      logger.debug('Received annotation update:', data);
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_UPDATED, data);
    };
    
    // Listen for annotation deletions
    const annotationDeleteHandler = (data) => {
      logger.debug('Received annotation deletion:', data);
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_DELETED, data);
    };
    
    // Listen for bulk annotation deletions
    const annotationBulkDeleteHandler = (data) => {
      logger.debug('Received bulk annotation deletion:', data);
      this.eventBus.emit(MAP_EVENTS.ANNOTATION_BULK_DELETED, data);
    };
    
    // Listen for location updates
    const locationUpdateHandler = (data) => {
      logger.debug('Received location update:', data);
      this.eventBus.emit(MAP_EVENTS.LOCATION_UPDATED, data);
    };
    
    // Listen for sync activity that might affect map data
    const syncActivityHandler = (data) => {
      if (data.type === 'annotation_update' || 
          data.type === 'annotation_delete' || 
          data.type === 'annotation_bulk_delete' || 
          data.type === 'location_update') {
        logger.debug('Sync activity affecting map:', data);
        // Refresh map data after a short delay to allow server to process
        if (this.loadMapDataCallback) {
          setTimeout(() => {
            this.loadMapDataCallback();
          }, TIMING.syncActivityRefreshDelay || 1000);
        }
      }
    };
    
    // Register handlers
    window.socket.on('admin:annotation_update', annotationUpdateHandler);
    window.socket.on('admin:annotation_delete', annotationDeleteHandler);
    window.socket.on('admin:annotation_bulk_delete', annotationBulkDeleteHandler);
    window.socket.on('admin:location_update', locationUpdateHandler);
    window.socket.on('admin:sync_activity', syncActivityHandler);
    
    // Store handlers for cleanup
    this.listeners.set('admin:annotation_update', annotationUpdateHandler);
    this.listeners.set('admin:annotation_delete', annotationDeleteHandler);
    this.listeners.set('admin:annotation_bulk_delete', annotationBulkDeleteHandler);
    this.listeners.set('admin:location_update', locationUpdateHandler);
    this.listeners.set('admin:sync_activity', syncActivityHandler);
    
    this.isConnected = true;
    logger.debug('Map WebSocket listeners connected');
  }

  /**
   * Disconnect from WebSocket and remove listeners
   */
  disconnect() {
    if (!window.socket || !this.isConnected) {
      return;
    }
    
    logger.debug('Disconnecting map WebSocket listeners...');
    
    // Remove all listeners
    this.listeners.forEach((handler, eventName) => {
      window.socket.off(eventName, handler);
    });
    
    this.listeners.clear();
    this.isConnected = false;
    logger.debug('Map WebSocket listeners disconnected');
  }

  /**
   * Setup global socket connection listeners
   */
  setupGlobalListeners() {
    // Listen for global socket events
    const socketConnectedHandler = () => {
      this.connect();
    };
    
    const socketDisconnectedHandler = () => {
      this.disconnect();
    };
    
    document.addEventListener('socketConnected', socketConnectedHandler);
    document.addEventListener('socketDisconnected', socketDisconnectedHandler);
    
    // Store for cleanup
    this.globalListeners = {
      socketConnected: socketConnectedHandler,
      socketDisconnected: socketDisconnectedHandler
    };
    
    // If socket is already connected, set up listeners immediately
    if (window.socket && window.socket.connected) {
      this.connect();
    }
  }

  /**
   * Cleanup global listeners
   */
  cleanupGlobalListeners() {
    if (this.globalListeners) {
      document.removeEventListener('socketConnected', this.globalListeners.socketConnected);
      document.removeEventListener('socketDisconnected', this.globalListeners.socketDisconnected);
      this.globalListeners = null;
    }
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  getIsConnected() {
    return this.isConnected;
  }
}
