/**
 * Timer Pill Overlay
 * Renders on-map timer pills for annotations with expiration (matches Android app UX).
 * Pills show countdown text (e.g. "5m 30s") in a rounded capsule below/near the annotation.
 */

import { logger } from '../../utils/logger.js';
import { extractCoordinates } from '../../utils/geography.js';
import { EXPIRATION_WARNING_MS, EXPIRATION_CRITICAL_MS } from '../../config/mapConfig.js';

/**
 * Get [lng, lat] position for an annotation (for placing the timer pill).
 * @param {Object} annotation - Annotation with type and data
 * @returns {[number, number]|null}
 */
function getAnnotationPosition(annotation) {
  if (!annotation?.data) return null;
  const data = typeof annotation.data === 'string'
    ? (() => { try { return JSON.parse(annotation.data); } catch { return {}; } })()
    : annotation.data;

  switch (annotation.type) {
    case 'poi':
      return extractCoordinates(data.position);
    case 'area':
      return extractCoordinates(data.center);
    case 'line':
      if (data.points && Array.isArray(data.points) && data.points.length > 0) {
        const coords = data.points.map(p => extractCoordinates(p)).filter(c => c != null);
        if (coords.length === 0) return null;
        // Midpoint of line (average of all points)
        const sum = coords.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
        return [sum[0] / coords.length, sum[1] / coords.length];
      }
      return null;
    case 'polygon':
      if (data.points && Array.isArray(data.points) && data.points.length > 0) {
        const coords = data.points.map(p => extractCoordinates(p)).filter(c => c != null);
        if (coords.length === 0) return null;
        const sum = coords.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
        return [sum[0] / coords.length, sum[1] / coords.length];
      }
      return null;
    default:
      return null;
  }
}

/**
 * Format countdown text to match Android: "5m 30s", "45s", "EXPIRED"
 */
function formatCountdownText(secondsRemaining) {
  if (secondsRemaining <= 0) return 'EXPIRED';
  if (secondsRemaining >= 60) {
    const m = Math.floor(secondsRemaining / 60);
    const s = Math.floor(secondsRemaining % 60);
    return `${m}m ${s}s`;
  }
  return `${Math.floor(secondsRemaining)}s`;
}

export class TimerPillOverlay {
  /**
   * @param {maplibregl.Map} map - Map instance
   * @param {string} containerId - ID of map container (to append overlay into)
   */
  constructor(map, containerId = 'map_container') {
    this.map = map;
    this.containerId = containerId;
    this.container = null;
    this.pills = new Map(); // annotationId -> HTMLElement
    this._boundUpdate = this.update.bind(this);
  }

  /**
   * Create overlay DOM container and attach to map container.
   */
  attach() {
    const mapContainer = document.getElementById(this.containerId);
    if (!mapContainer) {
      logger.warn('[TimerPillOverlay] Map container not found:', this.containerId);
      return;
    }
    this.container = document.createElement('div');
    this.container.className = 'annotation-timer-pills-overlay';
    this.container.setAttribute('aria-hidden', 'true');
    mapContainer.appendChild(this.container);

    this.map.on('move', this._boundUpdate);
    this.map.on('zoom', this._boundUpdate);
    this.map.on('resize', this._boundUpdate);
  }

  /**
   * Detach overlay and remove listeners.
   */
  detach() {
    this.map.off('move', this._boundUpdate);
    this.map.off('zoom', this._boundUpdate);
    this.map.off('resize', this._boundUpdate);
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.pills.clear();
  }

  /**
   * Update pills from current annotations. Call after data load or every second when expiring.
   * @param {Array} annotations - Full annotations array from AnnotationManager
   */
  update(annotations = []) {
    if (!this.container || !this.map) return;

    const now = Date.now();
    const expiring = [];

    for (const ann of annotations) {
      if (!ann?.data) continue;
      const data = typeof ann.data === 'string'
        ? (() => { try { return JSON.parse(ann.data); } catch { return {}; } })()
        : ann.data;
      const expMs = data.expirationTime != null ? Number(data.expirationTime) : null;
      if (expMs == null || expMs <= now) continue;

      const position = getAnnotationPosition(ann);
      if (!position) continue;

      const secondsRemaining = (expMs - now) / 1000;
      const isCritical = secondsRemaining <= EXPIRATION_CRITICAL_MS / 1000;
      const isWarning = secondsRemaining <= EXPIRATION_WARNING_MS / 1000 && !isCritical;

      expiring.push({
        id: ann.id,
        position,
        secondsRemaining,
        isCritical,
        isWarning
      });
    }

    // Remove pills for annotations that no longer expire or were removed
    const currentIds = new Set(expiring.map(e => e.id));
    for (const [id, el] of this.pills) {
      if (!currentIds.has(id)) {
        el.remove();
        this.pills.delete(id);
      }
    }

    // Add or update pills
    for (const item of expiring) {
      let el = this.pills.get(item.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'annotation-timer-pill';
        el.setAttribute('data-annotation-id', item.id);
        this.container.appendChild(el);
        this.pills.set(item.id, el);
      }

      const text = formatCountdownText(item.secondsRemaining);
      el.textContent = text;

      el.classList.remove('timer-pill-warning', 'timer-pill-critical');
      if (item.isCritical) el.classList.add('timer-pill-critical');
      else if (item.isWarning) el.classList.add('timer-pill-warning');

      // Position via map.project (mapbox uses [lng, lat])
      try {
        const point = this.map.project(item.position);
        // Position below the point (like Android: center.y + 50)
        const offsetY = 28;
        el.style.left = `${point.x}px`;
        el.style.top = `${point.y + offsetY}px`;
        el.style.transform = 'translate(-50%, 0)';
      } catch (e) {
        // Point may be off visible area during load
        el.style.left = '-9999px';
        el.style.top = '-9999px';
      }
    }
  }
}
