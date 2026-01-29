/**
 * Fan Menu Component
 * Handles the donut-style fan menu for annotation type selection
 */

import { logger } from '../../utils/logger.js';
import { q } from '../../utils/dom.js';
import { MenuManager } from './MenuManager.js';
import { TIMING } from '../../config/mapConfig.js';

export class FanMenu {
  /**
   * Create a fan menu
   * @param {string} elementId - ID of the fan menu element
   * @param {maplibregl.Map} map - Map instance
   * @param {MenuManager} menuManager - Menu manager instance
   */
  constructor(elementId = 'fan_menu', map, menuManager) {
    this.elementId = elementId;
    this.map = map;
    this.menuManager = menuManager;
    this.fanMenu = q(`#${elementId}`);
    this.onOptionSelected = null; // Callback for option selection
  }

  /**
   * Show fan menu at specified point
   * @param {maplibregl.Point} point - Screen coordinates
   * @param {boolean} isEditMode - Whether in edit mode
   * @param {Function} onOptionSelected - Callback when option is selected
   * @returns {maplibregl.LngLat|null} The location coordinates or null
   */
  show(point, isEditMode = false, onOptionSelected = null) {
    logger.debug('showFanMenu called with point:', point, 'isEditMode:', isEditMode);
    
    if (!this.fanMenu) {
      logger.error('fanMenu element not found!');
      return null;
    }
    
    this.onOptionSelected = onOptionSelected;
    
    // Clear existing segments
    this.clearSegments();
    
    // Get map coordinates for center text
    const lngLat = this.map.unproject(point);
    
    // Update center text with coordinates
    this.updateCenterText(lngLat);
    
    // Define options based on mode
    const options = isEditMode ? this.getEditModeOptions() : this.getCreateModeOptions();
    
    // Position fan menu at click point
    this.positionMenu(point);
    
    // Create donut ring segments
    this.createDonutRingSegments(options, point);
    
    // Show fan menu
    this.fanMenu.classList.add('visible');
    logger.debug('Fan menu made visible with', options.length, 'options');
    
    // Setup dismiss handler
    this.menuManager.setupDismissHandler(this.fanMenu, {
      onDismiss: () => this.hide()
    });
    
    return lngLat;
  }

  /**
   * Hide fan menu
   */
  hide() {
    if (this.fanMenu) {
      this.fanMenu.classList.remove('visible');
      this.clearSegments();
    }
    this.menuManager.cleanup(this.fanMenu);
  }

  /**
   * Clear menu segments
   */
  clearSegments() {
    if (!this.fanMenu) return;
    
    const centerHole = this.fanMenu.querySelector('.fan-menu-center');
    const existingSegments = this.fanMenu.querySelector('.fan-menu-segments-container');
    
    this.fanMenu.innerHTML = '';
    if (centerHole) {
      this.fanMenu.appendChild(centerHole);
    }
    if (existingSegments) {
      existingSegments.remove();
    }
  }

  /**
   * Position menu at point
   */
  positionMenu(point) {
    this.fanMenu.style.left = (point.x - 100) + 'px'; // Center the donut ring (200px diameter)
    this.fanMenu.style.top = (point.y - 100) + 'px';
    this.fanMenu.style.position = 'absolute';
  }

  /**
   * Update center text with coordinates
   */
  updateCenterText(lngLat) {
    const coordsEl = q('#fan_menu_coords');
    const distanceEl = q('#fan_menu_distance');
    
    if (coordsEl) {
      coordsEl.textContent = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
    }
    
    if (distanceEl) {
      // For now, just show a placeholder distance
      distanceEl.textContent = '0.0 mi away';
    }
  }

  /**
   * Get create mode options
   */
  getCreateModeOptions() {
    return [
      // Icons should match actual POI shapes on the map
      { type: 'circle', iconClass: 'shape-circle', label: 'Circle' },
      { type: 'square', iconClass: 'shape-square', label: 'Square' },
      { type: 'triangle', iconClass: 'shape-triangle', label: 'Triangle' },
      { type: 'exclamation', iconClass: 'shape-exclamation', label: 'Exclamation' },
      { type: 'area', iconClass: 'area', label: 'Area' },
      { type: 'line', iconClass: 'line', label: 'Line' }
    ];
  }

  /**
   * Get edit mode options
   */
  getEditModeOptions() {
    return [
      { type: 'edit', iconClass: 'edit', label: 'Edit' },
      { type: 'delete', iconClass: 'delete', label: 'Delete' }
    ];
  }

  /**
   * Create arc path for text (middle of segment ring) - used by textPath
   */
  createSegmentArcPath(centerX, centerY, radius, startAngle, endAngle) {
    const startAngleRad = (startAngle * Math.PI) / 180;
    const endAngleRad = (endAngle * Math.PI) / 180;
    const x1 = centerX + radius * Math.cos(startAngleRad);
    const y1 = centerY + radius * Math.sin(startAngleRad);
    const x2 = centerX + radius * Math.cos(endAngleRad);
    const y2 = centerY + radius * Math.sin(endAngleRad);
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`;
  }

  /**
   * Create donut ring segments
   */
  createDonutRingSegments(options, point) {
    const centerX = 100;
    const centerY = 100;
    const innerRadius = 40;
    const outerRadius = 80;
    const textRadius = (innerRadius + outerRadius) / 2;
    const gapAngle = 4;

    const totalAngle = 360 - (options.length * gapAngle);
    const segmentAngle = totalAngle / options.length;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svgContainer = document.createElement('div');
    svgContainer.className = 'fan-menu-segments-container';
    svgContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 200px; height: 200px;';

    const svgElement = document.createElementNS(svgNS, 'svg');
    svgElement.setAttribute('width', '200');
    svgElement.setAttribute('height', '200');
    svgElement.setAttribute('viewBox', '0 0 200 200');
    svgElement.style.cssText = 'position: absolute; top: 0; left: 0;';

    const defs = document.createElementNS(svgNS, 'defs');
    svgElement.appendChild(defs);

    options.forEach((option, index) => {
      const startAngle = (index * (segmentAngle + gapAngle)) - 90;
      const endAngle = startAngle + segmentAngle;

      const pathData = this.createDonutSegmentPath(centerX, centerY, innerRadius, outerRadius, startAngle, endAngle);

      const pathElement = document.createElementNS(svgNS, 'path');
      pathElement.setAttribute('d', pathData);
      pathElement.setAttribute('data-option-type', option.type);
      pathElement.style.cssText = 'fill: rgba(0, 0, 0, 0.8); stroke: white; stroke-width: 3; transition: all 0.2s ease; cursor: pointer;';

      pathElement.addEventListener('click', (e) => {
        e.stopPropagation();
        logger.debug('Clicked on option:', option.type);
        if (this.onOptionSelected) {
          this.onOptionSelected(option.type, point);
        }
        this.hide();
      });

      pathElement.addEventListener('mouseenter', () => {
        pathElement.style.fill = 'rgba(0, 0, 0, 0.9)';
        pathElement.style.stroke = 'rgba(255, 255, 255, 0.9)';
      });

      pathElement.addEventListener('mouseleave', () => {
        pathElement.style.fill = 'rgba(0, 0, 0, 0.8)';
        pathElement.style.stroke = 'white';
      });

      svgElement.appendChild(pathElement);

      // Arc path for bent text (in defs so textPath can reference it)
      const textPathId = `fan-menu-text-path-${index}`;
      const arcPath = document.createElementNS(svgNS, 'path');
      arcPath.setAttribute('id', textPathId);
      arcPath.setAttribute('d', this.createSegmentArcPath(centerX, centerY, textRadius, startAngle, endAngle));
      arcPath.setAttribute('fill', 'none');
      defs.appendChild(arcPath);

      // Text bent along the segment arc
      const textEl = document.createElementNS(svgNS, 'text');
      textEl.setAttribute('class', 'fan-menu-segment-text');
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('dominant-baseline', 'middle');
      textEl.style.cssText = 'fill: white; font-size: 11px; font-weight: 600; pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.8);';

      const textPath = document.createElementNS(svgNS, 'textPath');
      textPath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${textPathId}`);
      textPath.setAttribute('startOffset', '50%');
      textPath.textContent = option.label;
      textEl.appendChild(textPath);
      svgElement.appendChild(textEl);
    });

    svgContainer.appendChild(svgElement);
    this.fanMenu.appendChild(svgContainer);
  }

  /**
   * Create donut segment path
   */
  createDonutSegmentPath(centerX, centerY, innerRadius, outerRadius, startAngle, endAngle) {
    const startAngleRad = (startAngle * Math.PI) / 180;
    const endAngleRad = (endAngle * Math.PI) / 180;
    
    const x1 = centerX + innerRadius * Math.cos(startAngleRad);
    const y1 = centerY + innerRadius * Math.sin(startAngleRad);
    const x2 = centerX + outerRadius * Math.cos(startAngleRad);
    const y2 = centerY + outerRadius * Math.sin(startAngleRad);
    const x3 = centerX + outerRadius * Math.cos(endAngleRad);
    const y3 = centerY + outerRadius * Math.sin(endAngleRad);
    const x4 = centerX + innerRadius * Math.cos(endAngleRad);
    const y4 = centerY + innerRadius * Math.sin(endAngleRad);
    
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
    
    return `M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x1} ${y1} Z`;
  }

  /**
   * Get menu element
   */
  getElement() {
    return this.fanMenu;
  }
}
