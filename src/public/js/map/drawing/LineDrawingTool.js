/**
 * Line Drawing Tool
 * Handles line annotation creation with multiple points
 */

import { DrawingTool } from './DrawingTool.js';
import { logger } from '../../utils/logger.js';
import { getColorHex, LAYER_CONFIG } from '../../config/mapConfig.js';
import { q } from '../../utils/dom.js';

export class LineDrawingTool extends DrawingTool {
  /**
   * Create a line drawing tool
   * @param {maplibregl.Map} map - Map instance
   * @param {Object} options - Tool options
   */
  constructor(map, options = {}) {
    super(map, options);
    this.tempLinePoints = [];
    this.lineControlIcons = null;
  }

  /**
   * Start line drawing
   * @param {maplibregl.LngLat} lngLat - Starting location
   * @param {string} color - Line color
   */
  start(lngLat, color) {
    super.start(lngLat, color);
    this.tempLinePoints = [lngLat];
    this.createTempLineFeature();
    this.createLineControlIcons();
    this.setupLineDrawingHandlers();
  }

  /**
   * Add a point to the line
   * @param {maplibregl.LngLat} lngLat - Point location
   */
  addPoint(lngLat) {
    if (!this.isActive) return;
    this.tempLinePoints.push(lngLat);
    this.createTempLineFeature();
  }

  /**
   * Finish line drawing
   * @returns {Object|null} Annotation data or null
   */
  finish() {
    if (!this.isActive || this.tempLinePoints.length < 2) {
      logger.warn('Line needs at least 2 points');
      return null;
    }
    
    const annotationData = {
      type: 'line',
      data: {
        points: this.tempLinePoints.map(point => ({
          lng: point.lng,
          lt: point.lat
        })),
        color: this.currentColor,
        label: '',
        timestamp: Date.now()
      }
    };
    
    this.cleanup();
    return super.finish() || annotationData;
  }

  /**
   * Cancel line drawing
   */
  cancel() {
    this.cleanup();
    super.cancel();
  }

  /**
   * Create temporary line feature for visual feedback
   */
  createTempLineFeature() {
    if (!this.tempLinePoints || this.tempLinePoints.length === 0 || !this.map) return;
    
    this.removeTempLineFeature();
    
    // Add temporary source and layer
    if (!this.map.getSource(LAYER_CONFIG.tempLayers.line)) {
      this.map.addSource(LAYER_CONFIG.tempLayers.line, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    
    if (!this.map.getLayer(LAYER_CONFIG.tempLayers.lineStroke)) {
      this.map.addLayer({
        id: LAYER_CONFIG.tempLayers.lineStroke,
        type: 'line',
        source: LAYER_CONFIG.tempLayers.line,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': getColorHex(this.currentColor),
          'line-width': 3,
          'line-opacity': 0.8
        }
      });
    }
    
    if (!this.map.getLayer(LAYER_CONFIG.tempLayers.linePoints)) {
      this.map.addLayer({
        id: LAYER_CONFIG.tempLayers.linePoints,
        type: 'circle',
        source: LAYER_CONFIG.tempLayers.line,
        paint: {
          'circle-radius': 6,
          'circle-color': getColorHex(this.currentColor),
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF'
        }
      });
    }
    
    // Create features
    const features = [];
    
    if (this.tempLinePoints.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: this.tempLinePoints.map(point => [point.lng, point.lat])
        },
        properties: { type: 'line' }
      });
    }
    
    this.tempLinePoints.forEach((point, index) => {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [point.lng, point.lat]
        },
        properties: { type: 'point', index: index }
      });
    });
    
    this.map.getSource(LAYER_CONFIG.tempLayers.line).setData({
      type: 'FeatureCollection',
      features: features
    });
  }

  /**
   * Remove temporary line feature
   */
  removeTempLineFeature() {
    if (this.map.getLayer(LAYER_CONFIG.tempLayers.lineStroke)) {
      this.map.removeLayer(LAYER_CONFIG.tempLayers.lineStroke);
    }
    if (this.map.getLayer(LAYER_CONFIG.tempLayers.linePoints)) {
      this.map.removeLayer(LAYER_CONFIG.tempLayers.linePoints);
    }
    if (this.map.getSource(LAYER_CONFIG.tempLayers.line)) {
      this.map.removeSource(LAYER_CONFIG.tempLayers.line);
    }
  }

  /**
   * Setup line drawing event handlers
   */
  setupLineDrawingHandlers() {
    this.lineClickHandler = (e) => {
      if (!this.isActive) return;
      
      if (e.originalEvent && e.originalEvent.target.closest('.line-control-icons')) {
        return;
      }
      
      if (e.originalEvent) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
      }
      
      this.addPoint(e.lngLat);
    };
    
    this.lineEscapeHandler = (e) => {
      if (!this.isActive) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
    };
    
    this.registerHandler('click', this.lineClickHandler, 'map');
    this.registerHandler('keydown', this.lineEscapeHandler, 'document');
  }

  /**
   * Create line control icons (check/cancel)
   */
  createLineControlIcons() {
    this.removeLineControlIcons();
    
    this.lineControlIcons = document.createElement('div');
    this.lineControlIcons.className = 'line-control-icons';
    this.lineControlIcons.style.cssText = `
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      display: flex;
      gap: 10px;
      background: rgba(0, 0, 0, 0.8);
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    `;
    
    // Check mark icon
    const checkIcon = document.createElement('div');
    checkIcon.className = 'line-control-check';
    checkIcon.innerHTML = '✓';
    checkIcon.style.cssText = `
      width: 40px;
      height: 40px;
      background: #4CAF50;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 20px;
      font-weight: bold;
      transition: all 0.2s ease;
    `;
    
    // Cancel icon
    const cancelIcon = document.createElement('div');
    cancelIcon.className = 'line-control-cancel';
    cancelIcon.innerHTML = '✕';
    cancelIcon.style.cssText = `
      width: 40px;
      height: 40px;
      background: #F44336;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 20px;
      font-weight: bold;
      transition: all 0.2s ease;
    `;
    
    checkIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.options.onFinish) {
        this.options.onFinish(this.finish());
      }
    });
    
    cancelIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.options.onCancel) {
        this.options.onCancel();
      }
      this.cancel();
    });
    
    this.lineControlIcons.appendChild(checkIcon);
    this.lineControlIcons.appendChild(cancelIcon);
    
    const mapContainer = q('#map_container');
    if (mapContainer) {
      mapContainer.appendChild(this.lineControlIcons);
    }
  }

  /**
   * Remove line control icons
   */
  removeLineControlIcons() {
    if (this.lineControlIcons) {
      this.lineControlIcons.remove();
      this.lineControlIcons = null;
    }
  }

  /**
   * Cleanup all resources
   */
  cleanup() {
    super.cleanup();
    this.removeTempLineFeature();
    this.removeLineControlIcons();
    this.tempLinePoints = [];
  }
}
