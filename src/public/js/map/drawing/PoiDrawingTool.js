/**
 * POI Drawing Tool
 * Handles Point of Interest annotation creation
 */

import { DrawingTool } from './DrawingTool.js';
import { logger } from '../../utils/logger.js';

export class PoiDrawingTool extends DrawingTool {
  /**
   * Create POI annotation
   * @param {maplibregl.LngLat} lngLat - Location
   * @param {string} color - Color
   * @param {string} shape - Shape (circle, square, triangle, exclamation)
   * @returns {Object} Annotation data
   */
  createPOI(lngLat, color, shape) {
    return {
      type: 'poi',
      data: {
        position: {
          lng: lngLat.lng,
          lt: lngLat.lat
        },
        color: color,
        shape: shape,
        label: '',
        timestamp: Date.now()
      }
    };
  }
}
