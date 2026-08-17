/**
 * Area Drawing Tool
 * Handles circular area annotation creation
 */

import { DrawingTool } from './DrawingTool.js';
import { logger } from '../../utils/logger.js';
import { getColorHex, LAYER_CONFIG, INTERACTION_CONFIG } from '../../config/mapConfig.js';
import { pixelsToMeters as pixelsToMetersUtil, generateCirclePolygon } from '../../utils/geography.js';
import { DrawingControls } from '../ui/DrawingControls.js';

export class AreaDrawingTool extends DrawingTool {
  /**
   * Create an area drawing tool
   * @param {maplibregl.Map} map - Map instance
   * @param {Object} options - Tool options
   */
  constructor(map, options = {}) {
    super(map, options);
    this.tempAreaCenter = null;
    this.tempAreaRadius = 0;
    this.tempAreaRadiusPixels = 0;
    this.drawingControls = null;
    this._dragPanWasEnabled = true;
  }

  /**
   * Start area drawing
   * @param {maplibregl.LngLat} lngLat - Center location
   * @param {string} color - Area color
   */
  start(lngLat, color) {
    super.start(lngLat, color);
    this.tempAreaCenter = lngLat;
    this.tempAreaRadiusPixels = INTERACTION_CONFIG.defaultAreaRadiusPixels;
    this.tempAreaRadius = pixelsToMetersUtil(
      this.tempAreaRadiusPixels,
      this.map.getZoom(),
      lngLat.lat
    );
    this.createTempAreaFeature();
    this.createAreaControlIcons();
    this.setupAreaDrawingHandlers();
    this._dragPanWasEnabled = this.map.dragPan.isEnabled();
    this.map.dragPan.disable();
  }

  /**
   * Update area radius based on mouse position
   * @param {maplibregl.Point} point - Mouse point
   */
  updateRadius(point) {
    if (!this.isActive || !this.tempAreaCenter) return;
    
    const centerPoint = this.map.project(this.tempAreaCenter);
    const distancePixels = Math.sqrt(
      Math.pow(point.x - centerPoint.x, 2) + 
      Math.pow(point.y - centerPoint.y, 2)
    );
    
    this.tempAreaRadiusPixels = Math.max(
      INTERACTION_CONFIG.minAreaRadiusPixels,
      Math.min(INTERACTION_CONFIG.maxAreaRadiusPixels, distancePixels)
    );
    this.tempAreaRadius = pixelsToMetersUtil(
      this.tempAreaRadiusPixels,
      this.map.getZoom(),
      this.tempAreaCenter.lat
    );
    
    this.createTempAreaFeature();
  }

  /**
   * Finish area drawing
   * @returns {Object|null} Annotation data or null
   */
  finish() {
    if (!this.isActive || !this.tempAreaCenter) {
      return null;
    }
    
    const annotationData = {
      type: 'area',
      data: {
        center: {
          lng: this.tempAreaCenter.lng,
          lt: this.tempAreaCenter.lat
        },
        radius: this.tempAreaRadius,
        color: this.currentColor,
        label: '',
        timestamp: Date.now()
      }
    };
    
    this.cleanup();
    return super.finish() || annotationData;
  }

  /**
   * Cancel area drawing
   */
  cancel() {
    this.cleanup();
    super.cancel();
  }

  /**
   * Create temporary area feature for visual feedback
   */
  createTempAreaFeature() {
    if (!this.tempAreaCenter || !this.map) return;
    
    this.removeTempAreaFeature();
    
    const circlePolygon = generateCirclePolygon(
      this.tempAreaCenter.lng,
      this.tempAreaCenter.lat,
      this.tempAreaRadius
    );
    
    if (!this.map.getSource(LAYER_CONFIG.tempLayers.area)) {
      this.map.addSource(LAYER_CONFIG.tempLayers.area, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    
    if (!this.map.getLayer(LAYER_CONFIG.tempLayers.areaFill)) {
      this.map.addLayer({
        id: LAYER_CONFIG.tempLayers.areaFill,
        type: 'fill',
        source: LAYER_CONFIG.tempLayers.area,
        paint: {
          'fill-color': getColorHex(this.currentColor),
          'fill-opacity': 0.3
        }
      });
    }
    
    if (!this.map.getLayer(LAYER_CONFIG.tempLayers.areaStroke)) {
      this.map.addLayer({
        id: LAYER_CONFIG.tempLayers.areaStroke,
        type: 'line',
        source: LAYER_CONFIG.tempLayers.area,
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
    
    this.map.getSource(LAYER_CONFIG.tempLayers.area).setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [circlePolygon]
        },
        properties: {}
      }]
    });
  }

  /**
   * Remove temporary area feature
   */
  removeTempAreaFeature() {
    if (this.map.getLayer(LAYER_CONFIG.tempLayers.areaFill)) {
      this.map.removeLayer(LAYER_CONFIG.tempLayers.areaFill);
    }
    if (this.map.getLayer(LAYER_CONFIG.tempLayers.areaStroke)) {
      this.map.removeLayer(LAYER_CONFIG.tempLayers.areaStroke);
    }
    if (this.map.getSource(LAYER_CONFIG.tempLayers.area)) {
      this.map.removeSource(LAYER_CONFIG.tempLayers.area);
    }
  }

  /**
   * Setup area drawing event handlers
   */
  setupAreaDrawingHandlers() {
    this.areaMouseMoveHandler = (e) => {
      if (!this.isActive || !this.tempAreaCenter) return;
      this.updateRadius(e.point);
    };
    
    this.areaClickHandler = (e) => {
      if (!this.isActive) return;
      if (e.originalEvent && e.originalEvent.target.closest('.map-drawing-controls')) {
        return;
      }
      // Radius is set by drag; finish with the check button (click would fire on finger-up on mobile)
    };
    
    this.areaRightClickHandler = (e) => {
      if (!this.isActive) return;
      if (e.originalEvent) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
      }
      if (this.options.onCancel) {
        this.options.onCancel();
      }
      this.cancel();
    };
    
    this.areaEscapeHandler = (e) => {
      if (!this.isActive) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.options.onCancel) {
          this.options.onCancel();
        }
        this.cancel();
      }
    };
    
    this.registerHandler('mousemove', this.areaMouseMoveHandler, 'map');
    this.registerHandler('click', this.areaClickHandler, 'map');
    this.registerHandler('contextmenu', this.areaRightClickHandler, 'map');
    this.registerHandler('keydown', this.areaEscapeHandler, 'document');

    this._canvasTouchMove = (ev) => {
      if (!this.isActive || !this.tempAreaCenter || !this.map) return;
      if (ev.touches && ev.touches.length > 0) {
        ev.preventDefault();
        const rect = this.map.getCanvas().getBoundingClientRect();
        const touch = ev.touches[0];
        const point = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        this.updateRadius(point);
      }
    };
    this.map.getCanvas().addEventListener('touchmove', this._canvasTouchMove, { passive: false });
  }

  createAreaControlIcons() {
    this.removeAreaControlIcons();
    this.drawingControls = new DrawingControls({
      finishEnabled: true,
      onFinish: () => {
        if (this.options.onFinish) {
          this.options.onFinish(this.finish());
        }
      },
      onCancel: () => {
        if (this.options.onCancel) {
          this.options.onCancel();
        }
        this.cancel();
      }
    });
  }

  removeAreaControlIcons() {
    if (this.drawingControls) {
      this.drawingControls.remove();
      this.drawingControls = null;
    }
  }

  /**
   * Cleanup all resources
   */
  cleanup() {
    super.cleanup();
    this.removeTempAreaFeature();
    this.removeAreaControlIcons();
    if (this._canvasTouchMove && this.map) {
      this.map.getCanvas().removeEventListener('touchmove', this._canvasTouchMove);
      this._canvasTouchMove = null;
    }
    if (this.map && this._dragPanWasEnabled) {
      this.map.dragPan.enable();
    }
    this.tempAreaCenter = null;
    this.tempAreaRadius = 0;
    this.tempAreaRadiusPixels = 0;
  }
}
