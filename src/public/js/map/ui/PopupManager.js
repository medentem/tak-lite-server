/**
 * Popup Manager Component
 * Handles map popups for annotations and locations
 */

import { logger } from '../../utils/logger.js';
import { formatAge, escapeHtml, capitalizeFirst, formatDistance, formatArea, getStatusDescription } from '../../utils/formatting.js';
import { calculateLineLength, calculateCircleArea, calculatePolygonArea } from '../../utils/geography.js';
import { TIMING } from '../../config/mapConfig.js';

export class PopupManager {
  /**
   * Create a popup manager
   * @param {maplibregl.Map} map - Map instance
   * @param {Array} annotations - Annotations array (for finding full annotation data)
   */
  constructor(map, annotations = []) {
    this.map = map;
    this.annotations = annotations;
    this.currentPopup = null;
    this.ageUpdateInterval = null;
  }

  /**
   * Show annotation popup
   * @param {Object} feature - Map feature
   * @param {maplibregl.LngLat} lngLat - Location
   */
  showAnnotationPopup(feature, lngLat) {
    this.closeAllPopups();
    
    const properties = feature.properties;
    const fullAnnotation = this.annotations.find(ann => ann.id === properties.id);
    const popupContent = this.buildAnnotationPopupContent(properties, lngLat, fullAnnotation);
    
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'enhanced-popup'
    })
      .setLngLat(lngLat)
      .setHTML(popupContent)
      .addTo(this.map);
    
    this.currentPopup = popup;
    this.startAgeUpdates(popup);
  }

  /**
   * Show location popup
   * @param {Object} feature - Map feature
   * @param {maplibregl.LngLat} lngLat - Location
   */
  showLocationPopup(feature, lngLat) {
    this.closeAllPopups();
    
    const properties = feature.properties;
    const popupContent = this.buildLocationPopupContent(properties, lngLat);
    
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'enhanced-popup'
    })
      .setLngLat(lngLat)
      .setHTML(popupContent)
      .addTo(this.map);
    
    this.currentPopup = popup;
    this.startAgeUpdates(popup);
  }

  /**
   * Build annotation popup content
   * @param {Object} properties - Feature properties
   * @param {maplibregl.LngLat} lngLat - Location
   * @param {Object|null} fullAnnotation - Full annotation data
   * @returns {string} HTML content
   */
  buildAnnotationPopupContent(properties, lngLat, fullAnnotation = null) {
    const type = properties.type;
    const lines = [];
    
    const title = properties.label || capitalizeFirst(type);
    lines.push(title);
    
    // Add description/note if available
    if (properties.description && properties.description.trim()) {
      lines.push(properties.description);
    }
    
    switch (type) {
      case 'poi':
        this.addPoiInfo(lines, properties, lngLat);
        break;
      case 'line':
        this.addLineInfo(lines, properties, lngLat, fullAnnotation);
        break;
      case 'area':
        this.addAreaInfo(lines, properties, lngLat, fullAnnotation);
        break;
      case 'polygon':
        this.addPolygonInfo(lines, properties, lngLat, fullAnnotation);
        break;
    }
    
    if (properties.expirationTime != null) {
      lines.push({ type: 'expiration', expirationTime: Number(properties.expirationTime) });
    }
    this.addCommonInfo(lines, properties, lngLat);
    return this.buildPopupHTML(lines, properties);
  }

  /**
   * Build location popup content
   * @param {Object} properties - Feature properties
   * @param {maplibregl.LngLat} lngLat - Location
   * @returns {string} HTML content
   */
  buildLocationPopupContent(properties, lngLat) {
    const lines = [];
    
    const title = properties.user_name || properties.user_email || 'Peer Location';
    lines.push(title);
    
    if (properties.user_status && properties.user_status !== 'GREEN') {
      lines.push(`Status: ${properties.user_status}`);
    }
    
    if (properties.isStale) {
      lines.push(`⚠️ Stale (${properties.ageMinutes}m old)`);
    }
    
    lines.push({ type: 'age', timestamp: properties.timestamp });
    
    const coords = `${properties.latitude.toFixed(5)}, ${properties.longitude.toFixed(5)}`;
    lines.push(coords);
    
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${formatDistance(distance)} away`);
    }
    
    if (properties.altitude !== null && properties.altitude !== undefined) {
      lines.push(`Altitude: ${properties.altitude.toFixed(1)}m`);
    }
    if (properties.accuracy !== null && properties.accuracy !== undefined) {
      lines.push(`Accuracy: ${properties.accuracy.toFixed(1)}m`);
    }
    
    return this.buildPopupHTML(lines, properties);
  }

  /**
   * Add POI-specific information
   */
  addPoiInfo(lines, properties, lngLat) {
    lines.push({ type: 'age', timestamp: properties.timestamp });
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${formatDistance(distance)} away`);
    }
  }

  /**
   * Add line-specific information
   */
  addLineInfo(lines, properties, lngLat, fullAnnotation = null) {
    const length = fullAnnotation?.data?.points 
      ? calculateLineLength(fullAnnotation.data.points)
      : null;
    if (length !== null) {
      lines.push(formatDistance(length));
    }
    lines.push({ type: 'age', timestamp: properties.timestamp });
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${formatDistance(distance)} away`);
    }
  }

  /**
   * Add area-specific information
   */
  addAreaInfo(lines, properties, lngLat, fullAnnotation = null) {
    const area = fullAnnotation?.data?.radius
      ? calculateCircleArea(fullAnnotation.data.radius)
      : null;
    if (area !== null) {
      lines.push(formatArea(area));
    }
    lines.push({ type: 'age', timestamp: properties.timestamp });
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${formatDistance(distance)} away`);
    }
  }

  /**
   * Add polygon-specific information
   */
  addPolygonInfo(lines, properties, lngLat, fullAnnotation = null) {
    const area = fullAnnotation?.data?.points
      ? calculatePolygonArea(fullAnnotation.data.points)
      : null;
    if (area !== null) {
      lines.push(formatArea(area));
    }
    lines.push({ type: 'age', timestamp: properties.timestamp });
    const coords = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    lines.push(coords);
    const distance = this.calculateDistanceFromUser(lngLat);
    if (distance !== null) {
      lines.push(`${formatDistance(distance)} away`);
    }
  }

  /**
   * Add common information
   */
  addCommonInfo(lines, properties, lngLat) {
    const createdBy = properties.creatorUsername || properties.creatorId;
    if (createdBy) {
      lines.push(`Created by: ${createdBy}`);
    }
    if (properties.source) {
      lines.push(`Source: ${properties.source}`);
    }
  }

  /**
   * Format expiration countdown text from epoch ms
   */
  formatExpirationText(expirationTimeMs) {
    const now = Date.now();
    if (expirationTimeMs <= now) return 'Expired';
    const sec = Math.max(0, (expirationTimeMs - now) / 1000);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `Expires in ${m}m ${s}s`;
  }

  /**
   * Build popup HTML
   */
  buildPopupHTML(lines, properties) {
    if (lines.length === 0) return '';
    
    const title = lines[0];
    const content = lines.slice(1);
    
    const processedContent = content.map(line => {
      if (typeof line === 'object' && line.type === 'age') {
        return `<span class="age-text" data-timestamp="${line.timestamp}">${formatAge(line.timestamp)}</span>`;
      }
      if (typeof line === 'object' && line.type === 'expiration') {
        const text = this.formatExpirationText(line.expirationTime);
        return `<span class="expiration-text" data-expiration-time="${line.expirationTime}">${escapeHtml(text)}</span>`;
      }
      return escapeHtml(line);
    });
    
    return `
      <div class="popup-container">
        <div class="popup-title">${escapeHtml(title)}</div>
        ${processedContent.length > 0 ? `<div class="popup-content">${processedContent.join('<br>')}</div>` : ''}
        ${properties.status ? `<div class="popup-status">${getStatusDescription(properties.status)}</div>` : ''}
      </div>
    `;
  }

  /**
   * Calculate distance from user location (placeholder)
   */
  calculateDistanceFromUser(lngLat) {
    // For now, return null since we don't have user location in admin interface
    return null;
  }

  /**
   * Start age updates for popup
   */
  startAgeUpdates(popup) {
    if (this.ageUpdateInterval) {
      clearInterval(this.ageUpdateInterval);
    }
    
    this.ageUpdateInterval = setInterval(() => {
      if (this.currentPopup && this.currentPopup.isOpen()) {
        this.updatePopupAge();
      } else {
        clearInterval(this.ageUpdateInterval);
        this.ageUpdateInterval = null;
      }
    }, TIMING.ageUpdateInterval);
  }

  /**
   * Update age and expiration in current popup
   */
  updatePopupAge() {
    if (!this.currentPopup || !this.currentPopup.isOpen()) return;
    
    const popupContent = this.currentPopup.getElement();
    if (!popupContent) return;
    
    const ageElements = popupContent.querySelectorAll('.age-text');
    ageElements.forEach(element => {
      const timestamp = element.dataset.timestamp;
      if (timestamp) {
        element.textContent = formatAge(timestamp);
      }
    });
    const expirationElements = popupContent.querySelectorAll('.expiration-text');
    expirationElements.forEach(element => {
      const expirationTime = element.dataset.expirationTime;
      if (expirationTime) {
        element.textContent = this.formatExpirationText(parseInt(expirationTime, 10));
      }
    });
  }

  /**
   * Close all popups
   */
  closeAllPopups() {
    if (this.currentPopup) {
      this.currentPopup.remove();
      this.currentPopup = null;
    }
    
    const popups = document.querySelectorAll('.maplibregl-popup');
    popups.forEach(popup => {
      if (popup._popup) {
        popup._popup.remove();
      }
    });
    
    if (this.ageUpdateInterval) {
      clearInterval(this.ageUpdateInterval);
      this.ageUpdateInterval = null;
    }
  }

  /**
   * Set annotations array (for finding full annotation data)
   */
  setAnnotations(annotations) {
    this.annotations = annotations;
  }
}
