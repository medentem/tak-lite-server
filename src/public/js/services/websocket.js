/**
 * WebSocket service for real-time updates
 */

import { getToken } from '../utils/storage.js';
import { q } from '../utils/dom.js';

class WebSocketService {
  constructor() {
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.listeners = new Map();
    this.isConnecting = false;
  }

  /**
   * Wait for Socket.IO library to be available
   * @returns {Promise<void>}
   */
  async waitForSocketIO() {
    return new Promise((resolve) => {
      if (typeof io !== 'undefined') {
        resolve();
        return;
      }
      
      const checkInterval = setInterval(() => {
        if (typeof io !== 'undefined') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Connect to WebSocket server
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isConnecting) {
      console.log('WebSocket connection already in progress');
      return;
    }

    // Check if Socket.IO library is loaded
    if (typeof io === 'undefined') {
      console.error('Socket.IO library not loaded');
      await this.waitForSocketIO();
    }

    if (this.socket && this.socket.connected) {
      console.log('WebSocket already connected');
      return;
    }

    // Clean up existing connection
    if (this.socket) {
      this.disconnect();
    }

    const token = getToken();
    if (!token) {
      console.log('No authentication token available, skipping WebSocket connection');
      return;
    }

    this.isConnecting = true;

    try {
      console.log('Attempting WebSocket connection...');
      this.socket = io({
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000
      });

      // Make socket globally available for other components
      window.socket = this.socket;

      this.setupEventHandlers();
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.updateStatus('Connected', '#22c55e');
      this.emit('connected');
      document.dispatchEvent(new CustomEvent('socketConnected'));
    });

    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      this.isConnecting = false;
      this.updateStatus('Disconnected', '#ef4444');
      this.emit('disconnected', reason);
      document.dispatchEvent(new CustomEvent('socketDisconnected', { detail: { reason } }));

      // Attempt reconnection if not intentional
      if (reason !== 'io client disconnect') {
        this.reconnectAttempts++;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.updateStatus('Reconnecting...', '#f59e0b');
          setTimeout(() => {
            this.connect();
          }, 2000);
        }
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.isConnecting = false;
      this.updateStatus('Connection Error', '#ef4444');
      this.emit('error', error);

      // Retry connection after delay
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => {
          this.connect();
        }, 3000);
      }
    });

    // Admin-specific events
    this.socket.on('admin:stats_update', (stats) => {
      this.emit('stats_update', stats);
    });

    this.socket.on('admin:connection_update', (data) => {
      this.emit('connection_update', data);
    });

    this.socket.on('admin:sync_activity', (data) => {
      this.emit('sync_activity', data);
    });

    // Map annotation/location events – re-emit so dashboard map receives them even if
    // MapWebSocketManager.connect() ran after the socket connected (map loads after auth).
    this.socket.on('admin:annotation_update', (data) => {
      this.emit('annotation_update', data);
    });
    this.socket.on('admin:annotation_delete', (data) => {
      this.emit('annotation_delete', data);
    });
    this.socket.on('admin:annotation_bulk_delete', (data) => {
      this.emit('annotation_bulk_delete', data);
    });
    this.socket.on('admin:location_update', (data) => {
      this.emit('location_update', data);
    });

    this.socket.on('admin:message_received', (data) => {
      this.emit('message_received', data);
    });

    this.socket.on('admin:new_threat_detected', (data) => {
      this.emit('new_threat_detected', data);
    });

    this.socket.on('admin:threat_annotation_created', (data) => {
      this.emit('threat_annotation_created', data);
    });

    this.socket.on('admin:threat_deleted', (data) => {
      this.emit('threat_deleted', data);
    });

    this.socket.on('admin:threat_updated', (data) => {
      this.emit('threat_updated', data);
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.socket) {
      console.log('Disconnecting WebSocket');
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (e) {
        console.error('Error during socket disconnect:', e);
      }
      this.socket = null;
      window.socket = null;
    }
    this.isConnecting = false;
    this.updateStatus('Disconnected', '#ef4444');
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnected() {
    return this.socket && this.socket.connected;
  }

  /**
   * Emit event to server
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emitToServer(event, data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn('Cannot emit event - WebSocket not connected:', event);
    }
  }

  /**
   * Listen for events
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler to remove
   */
  off(event, handler) {
    if (this.listeners.has(event)) {
      const handlers = this.listeners.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Internal emit to local listeners
   * @private
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (e) {
          console.error('Error in event handler:', e);
        }
      });
    }
  }

  /**
   * Update WebSocket status display
   * @param {string} status - Status text
   * @param {string} color - Status color
   */
  updateStatus(status, color) {
    const statusEl = q('#ws_status');
    if (statusEl) {
      statusEl.textContent = status;
      statusEl.style.color = color;
    }
  }

  /**
   * Get socket instance (for advanced usage)
   * @returns {Socket|null}
   */
  getSocket() {
    return this.socket;
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();

// Setup cleanup handlers (only if in browser environment)
if (typeof window !== 'undefined') {
  // Cleanup on page unload (full navigation or tab close)
  window.addEventListener('beforeunload', () => {
    websocketService.disconnect();
  });

  // Keep connection alive when tab is in background so real-time data is still received.
  // When user returns, reconnect if we were disconnected (e.g. network blip, server restart).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Do not disconnect: connection persists and data is received in background
    } else {
      if (getToken() && !websocketService.isConnected()) {
        websocketService.connect().catch(console.error);
      }
    }
  });
}
