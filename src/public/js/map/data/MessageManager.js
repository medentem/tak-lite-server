/**
 * Message Manager
 * Manages message visualization on the map as bubbles near sender locations
 */

import { logger } from '../../utils/logger.js';
import { LAYER_CONFIG } from '../../config/mapConfig.js';

export class MessageManager {
  constructor(map, eventBus) {
    this.map = map;
    this.eventBus = eventBus;
    this.messages = [];
    this.messageSource = null;
    this.messageLayer = 'messages-layer';
    this.messageBubbles = new Map(); // Track message bubbles
  }

  /**
   * Initialize message visualization
   */
  async init() {
    if (!this.map.isStyleLoaded()) {
      this.map.once('styledata', () => this.init());
      return;
    }

    this.setupSource();
    this.setupLayer();
    
    // Listen for new messages
    this.eventBus.on('message:received', (data) => {
      this.addMessage(data);
    });
  }

  /**
   * Setup message source
   */
  setupSource() {
    const sourceId = 'messages-source';
    
    if (!this.map.getSource(sourceId)) {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      this.messageSource = sourceId;
      logger.debug('Added message source');
    } else {
      this.messageSource = sourceId;
    }
  }

  /**
   * Setup message layer
   */
  setupLayer() {
    if (this.map.getLayer(this.messageLayer)) {
      logger.debug('Message layer already exists');
      return;
    }

    // Add circle layer for message bubbles
    this.map.addLayer({
      id: this.messageLayer,
      type: 'circle',
      source: this.messageSource,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, 6,
          12, 8,
          16, 10
        ],
        'circle-color': '#3b82f6',
        'circle-opacity': 0.7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.9
      }
    });

    // Setup click handler
    this.map.on('click', this.messageLayer, (e) => {
      const feature = e.features[0];
      if (feature) {
        this.handleMessageClick(feature, e.lngLat);
      }
    });

    // Setup hover cursor
    this.map.on('mouseenter', this.messageLayer, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', this.messageLayer, () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  /**
   * Add message to map
   */
  addMessage(messageData) {
    // Get sender location from location manager or message data
    const senderLocation = this.getSenderLocation(messageData);
    
    if (!senderLocation) {
      logger.debug('No location available for message sender');
      return;
    }

    const message = {
      id: messageData.id || Date.now().toString(),
      userId: messageData.user_id,
      userName: messageData.user_name || 'Unknown',
      content: messageData.content || '',
      timestamp: messageData.timestamp || new Date(),
      teamId: messageData.team_id,
      location: senderLocation
    };

    this.messages.unshift(message);
    
    // Keep only last 50 messages
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(0, 50);
    }

    this.updateMap();
  }

  /**
   * Get sender location
   */
  getSenderLocation(messageData) {
    // Try to get from location manager via event bus
    // For now, return null if no location data in message
    if (messageData.location) {
      return messageData.location;
    }
    
    // Could query location manager for user's latest location
    return null;
  }

  /**
   * Update map with current messages
   */
  updateMap() {
    if (!this.messageSource) return;

    const features = this.messages
      .filter(msg => msg.location && msg.location.lat && msg.location.lng)
      .map(msg => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [msg.location.lng, msg.location.lat]
        },
        properties: {
          message_id: msg.id,
          user_name: msg.userName,
          content: msg.content,
          timestamp: msg.timestamp,
          team_id: msg.teamId
        }
      }));

    const source = this.map.getSource(this.messageSource);
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features
      });
    }
  }

  /**
   * Handle message click
   */
  handleMessageClick(feature, lngLat) {
    const messageId = feature.properties.message_id;
    const message = this.messages.find(m => m.id === messageId);
    
    if (message) {
      // Emit event for message selection
      this.eventBus.emit('message:selected', { message, lngLat });
      
      // Show popup or open message panel
      this.showMessagePopup(message, lngLat);
    }
  }

  /**
   * Show message popup
   */
  showMessagePopup(message, lngLat) {
    // Create popup content
    const content = `
      <div style="max-width: 250px;">
        <div style="font-weight: 600; margin-bottom: 4px; color: #3b82f6;">
          ${message.userName}
        </div>
        <div style="font-size: 13px; color: #e6edf3; margin-bottom: 4px;">
          ${message.content}
        </div>
        <div style="font-size: 11px; color: #8b97a7;">
          ${new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    `;

    // Use MapLibre popup
    new maplibregl.Popup({ closeOnClick: true })
      .setLngLat([lngLat.lng, lngLat.lat])
      .setHTML(content)
      .addTo(this.map);
  }

  /**
   * Clear messages
   */
  clearMessages() {
    this.messages = [];
    this.updateMap();
  }

  /**
   * Get messages
   */
  getMessages() {
    return this.messages;
  }
}
