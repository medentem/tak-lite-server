/**
 * Annotation Manager
 * Handles annotation CRUD operations, loading, and GeoJSON conversion
 */

import { logger } from '../../utils/logger.js';
import { get, post, put, del } from '../../utils/api.js';
import { extractCoordinates, generateCirclePolygon } from '../../utils/geography.js';
import { getColorHex, API_ENDPOINTS, LAYER_CONFIG, DATA_LIMITS, DISPLAY_CONFIG } from '../../config/mapConfig.js';

export class AnnotationManager {
  /**
   * Create an annotation manager
   * @param {maplibregl.Map} map - Map instance
   */
  constructor(map) {
    this.map = map;
    this.annotations = [];
  }

  /**
   * Load annotations from API
   * @param {string|null} teamId - Optional team ID filter
   * @returns {Promise<Array>} Array of annotations
   */
  async loadAnnotations(teamId = null) {
    try {
      const params = new URLSearchParams();
      if (teamId) {
        params.append('teamId', teamId);
      }
      params.append('limit', DATA_LIMITS.maxAnnotations.toString());
      
      const url = `${API_ENDPOINTS.annotations}?${params}`;
      logger.debug(`Loading annotations from: ${url}`);
      
      this.annotations = await get(url);
      logger.info(`Loaded ${this.annotations.length} annotations`);
      return this.annotations;
    } catch (error) {
      logger.error('Failed to load annotations:', error);
      this.annotations = [];
      return [];
    }
  }

  /**
   * Create a new annotation
   * @param {Object} annotationData - Annotation data
   * @returns {Promise<Object>} Created annotation
   */
  async createAnnotation(annotationData) {
    try {
      const result = await post(API_ENDPOINTS.annotations, annotationData);
      logger.info('Annotation created successfully:', result.id);
      
      // Add to local annotations array
      this.annotations.unshift(result);
      return result;
    } catch (error) {
      logger.error('Failed to create annotation:', error);
      throw error;
    }
  }

  /**
   * Update an existing annotation
   * @param {string} annotationId - Annotation ID
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} Updated annotation
   */
  async updateAnnotation(annotationId, updateData) {
    try {
      const result = await put(API_ENDPOINTS.annotationsById(annotationId), { data: updateData });
      logger.info('Annotation updated successfully:', annotationId);
      
      // Update local annotation
      const index = this.annotations.findIndex(a => a.id === annotationId);
      if (index >= 0) {
        this.annotations[index] = { ...this.annotations[index], ...result };
      }
      return result;
    } catch (error) {
      logger.error('Failed to update annotation:', error);
      throw error;
    }
  }

  /**
   * Delete an annotation
   * @param {string} annotationId - Annotation ID
   * @returns {Promise<void>}
   */
  async deleteAnnotation(annotationId) {
    try {
      await del(API_ENDPOINTS.annotationsById(annotationId));
      logger.info('Annotation deleted successfully:', annotationId);
      
      // Remove from local annotations array
      this.annotations = this.annotations.filter(a => a.id !== annotationId);
    } catch (error) {
      logger.error('Failed to delete annotation:', error);
      throw error;
    }
  }

  /**
   * Bulk delete annotations
   * @param {Array<string>} annotationIds - Array of annotation IDs
   * @returns {Promise<Object>} Result with deletedCount and annotationIds
   */
  async bulkDeleteAnnotations(annotationIds) {
    try {
      const result = await post(API_ENDPOINTS.annotationsBulkDelete, { annotationIds });
      logger.info(`Bulk deleted ${result.deletedCount} annotations`);
      
      // Remove deleted annotations from local array
      this.annotations = this.annotations.filter(annotation => 
        !result.annotationIds.includes(annotation.id)
      );
      return result;
    } catch (error) {
      logger.error('Failed to bulk delete annotations:', error);
      throw error;
    }
  }

  /**
   * Convert annotations to GeoJSON features
   * @returns {Object} Object with poiFeatures, lineFeatures, areaFeatures, polygonFeatures
   */
  convertToGeoJSON() {
    const poiFeatures = [];
    const lineFeatures = [];
    const areaFeatures = [];
    const polygonFeatures = [];
    
    this.annotations.forEach(annotation => {
      const data = annotation.data;
      const properties = {
        id: annotation.id,
        type: annotation.type,
        color: getColorHex(data.color),
        label: data.label || '',
        description: data.description || '',
        timestamp: data.timestamp,
        creatorId: data.creatorId,
        source: data.source
      };
      
      switch (annotation.type) {
        case 'poi':
          const poiCoords = extractCoordinates(data.position);
          if (poiCoords) {
            const iconName = `poi-${(data.shape || 'circle').toLowerCase()}-${data.color.toLowerCase()}`;
            poiFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: poiCoords
              },
              properties: {
                ...properties,
                icon: iconName
              }
            });
          } else {
            logger.warn('Skipping POI annotation with invalid coordinates:', {
              id: annotation.id,
              position: data.position
            });
          }
          break;
          
        case 'line':
          const linePoints = data.points.map(p => extractCoordinates(p)).filter(coord => coord !== null);
          if (linePoints.length >= 2) {
            lineFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: linePoints
              },
              properties
            });
          } else {
            logger.warn('Skipping line annotation with insufficient valid coordinates:', {
              id: annotation.id,
              validPoints: linePoints.length,
              totalPoints: data.points.length
            });
          }
          break;
          
        case 'area':
          const areaCoords = extractCoordinates(data.center);
          if (areaCoords && data.radius && data.radius > 0) {
            const areaPolygon = generateCirclePolygon(areaCoords[0], areaCoords[1], data.radius);
            areaFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [areaPolygon]
              },
              properties: {
                ...properties,
                fillOpacity: 0.3,
                strokeWidth: 3
              }
            });
          } else {
            logger.warn('Skipping area annotation with invalid coordinates or radius:', {
              id: annotation.id,
              center: data.center,
              radius: data.radius
            });
          }
          break;
          
        case 'polygon':
          const polygonPoints = data.points.map(p => extractCoordinates(p)).filter(coord => coord !== null);
          if (polygonPoints.length >= 3) {
            polygonFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [polygonPoints]
              },
              properties
            });
          } else {
            logger.warn('Skipping polygon annotation with insufficient valid coordinates:', {
              id: annotation.id,
              validPoints: polygonPoints.length,
              totalPoints: data.points.length
            });
          }
          break;
      }
    });
    
    return { poiFeatures, lineFeatures, areaFeatures, polygonFeatures };
  }

  /**
   * Update map sources with annotation data
   */
  updateMap() {
    if (!this.map) {
      logger.warn('Cannot update map: map not initialized');
      return;
    }
    
    // Ensure all sources exist
    const requiredSources = [
      LAYER_CONFIG.sources.annotationsPoi,
      LAYER_CONFIG.sources.annotationsLine,
      LAYER_CONFIG.sources.annotationsArea,
      LAYER_CONFIG.sources.annotationsPolygon
    ];
    
    for (const sourceId of requiredSources) {
      if (!this.map.getSource(sourceId)) {
        logger.error(`Map source '${sourceId}' not found`);
        return;
      }
    }
    
    // Convert annotations to GeoJSON
    const { poiFeatures, lineFeatures, areaFeatures, polygonFeatures } = this.convertToGeoJSON();
    
    // Update map sources
    this.map.getSource(LAYER_CONFIG.sources.annotationsPoi).setData({
      type: 'FeatureCollection',
      features: poiFeatures
    });
    
    this.map.getSource(LAYER_CONFIG.sources.annotationsLine).setData({
      type: 'FeatureCollection',
      features: lineFeatures
    });
    
    this.map.getSource(LAYER_CONFIG.sources.annotationsArea).setData({
      type: 'FeatureCollection',
      features: areaFeatures
    });
    
    this.map.getSource(LAYER_CONFIG.sources.annotationsPolygon).setData({
      type: 'FeatureCollection',
      features: polygonFeatures
    });
    
    logger.debug(`Updated map with ${poiFeatures.length} POIs, ${lineFeatures.length} lines, ${areaFeatures.length} areas, ${polygonFeatures.length} polygons`);
  }

  /**
   * Get annotations array
   * @returns {Array} Annotations array
   */
  getAnnotations() {
    return this.annotations;
  }

  /**
   * Set annotations array
   * @param {Array} annotations - Annotations array
   */
  setAnnotations(annotations) {
    this.annotations = annotations;
  }

  /**
   * Find annotation by ID
   * @param {string} annotationId - Annotation ID
   * @returns {Object|undefined} Annotation or undefined
   */
  findAnnotation(annotationId) {
    return this.annotations.find(a => a.id === annotationId);
  }
}
