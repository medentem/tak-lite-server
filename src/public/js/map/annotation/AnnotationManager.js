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
      logger.debug(`[UPDATE] Starting update for annotation ${annotationId}`, {
        updateData,
        currentAnnotations: this.annotations.length
      });
      
      const result = await put(API_ENDPOINTS.annotationsById(annotationId), { data: updateData });
      logger.info('Annotation updated successfully:', annotationId);
      
      // Update local annotation - merge the data field properly
      const index = this.annotations.findIndex(a => a.id === annotationId);
      if (index >= 0) {
        const existingAnnotation = this.annotations[index];
        logger.debug(`[UPDATE] Found existing annotation at index ${index}`, {
          annotationId,
          existingType: existingAnnotation.type,
          existingDataKeys: Object.keys(existingAnnotation.data || {})
        });
        
        // Parse result.data if it's a string (some DB drivers return JSONB as string)
        let resultData = result.data;
        if (typeof resultData === 'string') {
          try {
            resultData = JSON.parse(resultData);
            logger.debug(`[UPDATE] Parsed result.data from string`, { keys: Object.keys(resultData) });
          } catch (e) {
            logger.warn('Failed to parse result.data as JSON:', e);
            resultData = {};
          }
        }
        
        logger.debug(`[UPDATE] Server response data`, {
          resultDataType: typeof resultData,
          resultDataKeys: resultData ? Object.keys(resultData) : [],
          resultData: resultData
        });
        
        // Ensure data is an object and merge it properly
        // Preserve existing data to ensure position and other fields aren't lost
        let existingData = existingAnnotation.data || {};
        if (typeof existingData === 'string') {
          try {
            existingData = JSON.parse(existingData);
            logger.debug(`[UPDATE] Parsed existing data from string`, { keys: Object.keys(existingData) });
          } catch (e) {
            logger.warn('Failed to parse existing data as JSON:', e);
            existingData = {};
          }
        }
        
        logger.debug(`[UPDATE] Existing data before merge`, {
          existingDataType: typeof existingData,
          existingDataKeys: existingData ? Object.keys(existingData) : [],
          existingData: existingData
        });
        
        const newData = resultData || {};
        // Merge: existing data first (preserves position, etc.), then new data (updates color/shape)
        const mergedData = { ...existingData, ...newData };
        
        logger.debug(`[UPDATE] Merged data`, {
          mergedDataKeys: Object.keys(mergedData),
          mergedData: mergedData,
          hasPosition: !!mergedData.position,
          hasPoints: !!mergedData.points,
          hasCenter: !!mergedData.center
        });
        
        // Update the annotation with merged data, preserving all fields
        this.annotations[index] = {
          ...existingAnnotation,
          ...result,
          data: mergedData
        };
        
        logger.debug(`[UPDATE] Updated annotation in array`, {
          annotationId,
          finalDataKeys: Object.keys(this.annotations[index].data || {}),
          finalType: this.annotations[index].type
        });
      } else {
        // If annotation not found locally, add it
        // Parse data if it's a string
        let resultData = result.data;
        if (typeof resultData === 'string') {
          try {
            resultData = JSON.parse(resultData);
          } catch (e) {
            logger.warn('Failed to parse result.data as JSON:', e);
            resultData = {};
          }
        }
        
        // Ensure data is an object
        if (resultData && typeof resultData === 'object') {
          this.annotations.push({
            ...result,
            data: resultData
          });
        } else {
          logger.warn('Annotation result missing valid data field:', result);
          this.annotations.push(result);
        }
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
    
    logger.info(`[GEOJSON] Starting conversion with ${this.annotations.length} annotations`, {
      annotationIds: this.annotations.map(a => ({ id: a.id, type: a.type, hasData: !!a.data }))
    });
    
    this.annotations.forEach((annotation, index) => {
      logger.debug(`[GEOJSON] Processing annotation ${index + 1}/${this.annotations.length}: ${annotation.id}`);
      // Ensure data exists and is an object
      if (!annotation || !annotation.data) {
        logger.warn('[GEOJSON] Skipping annotation with missing data:', {
          id: annotation?.id,
          type: annotation?.type,
          hasData: !!annotation?.data
        });
        return;
      }
      
      // Parse data if it's a string (some DB drivers return JSONB as string)
      let data = annotation.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          logger.warn('[GEOJSON] Failed to parse annotation data as JSON:', e, {
            id: annotation.id,
            type: annotation.type
          });
          return; // Skip this annotation if data is invalid
        }
      }
      
      logger.debug(`[GEOJSON] Processing annotation ${annotation.id} (${annotation.type})`, {
        dataKeys: Object.keys(data),
        hasPosition: !!data.position,
        hasPoints: !!data.points,
        hasCenter: !!data.center,
        position: data.position,
        pointsLength: data.points?.length,
        center: data.center
      });
      
      const properties = {
        id: annotation.id,
        type: annotation.type,
        color: getColorHex(data.color || 'green'),
        label: data.label || '',
        description: data.description || '',
        timestamp: data.timestamp || Date.now(),
        creatorId: data.creatorId || annotation.user_id,
        source: data.source || 'server'
      };
      
      switch (annotation.type) {
        case 'poi':
          const poiCoords = extractCoordinates(data.position);
          logger.debug(`[GEOJSON] POI ${annotation.id} coordinates:`, {
            position: data.position,
            extractedCoords: poiCoords
          });
          if (poiCoords) {
            const color = data.color || 'green';
            const shape = data.shape || 'circle';
            const iconName = `poi-${shape.toLowerCase()}-${color.toLowerCase()}`;
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
            logger.error('[GEOJSON] CRITICAL: Skipping POI annotation with invalid coordinates:', {
              id: annotation.id,
              type: annotation.type,
              position: data.position,
              positionType: typeof data.position,
              dataKeys: Object.keys(data),
              fullData: data,
              fullAnnotation: annotation
            });
          }
          break;
          
        case 'line':
          logger.debug(`[GEOJSON] Line ${annotation.id} points:`, {
            points: data.points,
            pointsType: typeof data.points,
            isArray: Array.isArray(data.points),
            pointsLength: data.points?.length
          });
          if (!data.points || !Array.isArray(data.points)) {
            logger.warn('[GEOJSON] Skipping line annotation with missing or invalid points:', {
              id: annotation.id,
              points: data.points,
              pointsType: typeof data.points
            });
            break;
          }
          const linePoints = data.points.map(p => extractCoordinates(p)).filter(coord => coord !== null);
          logger.debug(`[GEOJSON] Line ${annotation.id} extracted points:`, {
            originalCount: data.points.length,
            extractedCount: linePoints.length,
            extractedPoints: linePoints
          });
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
          logger.debug(`[GEOJSON] Area ${annotation.id} center and radius:`, {
            center: data.center,
            radius: data.radius,
            radiusType: typeof data.radius
          });
          const areaCoords = extractCoordinates(data.center);
          logger.debug(`[GEOJSON] Area ${annotation.id} extracted center:`, {
            center: data.center,
            extractedCoords: areaCoords
          });
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
          if (!data.points || !Array.isArray(data.points)) {
            logger.warn('Skipping polygon annotation with missing or invalid points:', {
              id: annotation.id
            });
            break;
          }
          const polygonPoints = data.points.map(p => extractCoordinates(p)).filter(coord => coord !== null);
          if (polygonPoints.length >= 3) {
            // Close the ring (GeoJSON Polygon requires first and last point to be identical for the stroke to render the final segment)
            const closedRing = [...polygonPoints, polygonPoints[0]];
            polygonFeatures.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [closedRing]
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
    
    logger.info(`[GEOJSON] Conversion complete: ${poiFeatures.length} POIs, ${lineFeatures.length} lines, ${areaFeatures.length} areas, ${polygonFeatures.length} polygons`, {
      poiFeatureIds: poiFeatures.map(f => f.properties.id),
      skippedCount: this.annotations.length - (poiFeatures.length + lineFeatures.length + areaFeatures.length + polygonFeatures.length)
    });
    
    return { poiFeatures, lineFeatures, areaFeatures, polygonFeatures };
  }

  /**
   * Update map sources with annotation data
   */
  updateMap() {
    if (!this.map) {
      logger.warn('[UPDATEMAP] Cannot update map: map not initialized');
      return;
    }
    
    logger.debug('[UPDATEMAP] Starting map update', {
      totalAnnotations: this.annotations.length,
      annotationIds: this.annotations.map(a => a.id)
    });
    
    // Ensure all sources exist
    const requiredSources = [
      LAYER_CONFIG.sources.annotationsPoi,
      LAYER_CONFIG.sources.annotationsLine,
      LAYER_CONFIG.sources.annotationsArea,
      LAYER_CONFIG.sources.annotationsPolygon
    ];
    
    for (const sourceId of requiredSources) {
      if (!this.map.getSource(sourceId)) {
        logger.error(`[UPDATEMAP] Map source '${sourceId}' not found`);
        return;
      }
    }
    
    // Convert annotations to GeoJSON
    const { poiFeatures, lineFeatures, areaFeatures, polygonFeatures } = this.convertToGeoJSON();
    
    logger.debug('[UPDATEMAP] Converted to GeoJSON', {
      poiCount: poiFeatures.length,
      lineCount: lineFeatures.length,
      areaCount: areaFeatures.length,
      polygonCount: polygonFeatures.length,
      poiFeatureIds: poiFeatures.map(f => f.properties.id),
      lineFeatureIds: lineFeatures.map(f => f.properties.id),
      areaFeatureIds: areaFeatures.map(f => f.properties.id)
    });
    
    // Update map sources
    const poiSource = this.map.getSource(LAYER_CONFIG.sources.annotationsPoi);
    if (poiSource) {
      poiSource.setData({
        type: 'FeatureCollection',
        features: poiFeatures
      });
      logger.debug(`[UPDATEMAP] Updated POI source with ${poiFeatures.length} features`);
    }
    
    const lineSource = this.map.getSource(LAYER_CONFIG.sources.annotationsLine);
    if (lineSource) {
      lineSource.setData({
        type: 'FeatureCollection',
        features: lineFeatures
      });
      logger.debug(`[UPDATEMAP] Updated line source with ${lineFeatures.length} features`);
    }
    
    const areaSource = this.map.getSource(LAYER_CONFIG.sources.annotationsArea);
    if (areaSource) {
      areaSource.setData({
        type: 'FeatureCollection',
        features: areaFeatures
      });
      logger.debug(`[UPDATEMAP] Updated area source with ${areaFeatures.length} features`);
    }
    
    const polygonSource = this.map.getSource(LAYER_CONFIG.sources.annotationsPolygon);
    if (polygonSource) {
      polygonSource.setData({
        type: 'FeatureCollection',
        features: polygonFeatures
      });
      logger.debug(`[UPDATEMAP] Updated polygon source with ${polygonFeatures.length} features`);
    }
    
    // Force map to repaint to ensure icon changes are visible
    this.map.triggerRepaint();
    
    logger.info(`[UPDATEMAP] Updated map with ${poiFeatures.length} POIs, ${lineFeatures.length} lines, ${areaFeatures.length} areas, ${polygonFeatures.length} polygons`);
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
