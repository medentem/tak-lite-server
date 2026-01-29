/**
 * Shape Menu Component
 * Handles the shape selection donut menu (for editing POI shape)
 * Mirrors the ColorMenu flow: fan menu with segments per option.
 */

import { logger } from '../../utils/logger.js';
import { q } from '../../utils/dom.js';
import { MenuManager } from './MenuManager.js';

const SHAPES = [
  { type: 'circle', iconClass: 'shape-circle', label: 'Circle' },
  { type: 'square', iconClass: 'shape-square', label: 'Square' },
  { type: 'triangle', iconClass: 'shape-triangle', label: 'Triangle' },
  { type: 'exclamation', iconClass: 'shape-exclamation', label: 'Exclamation' }
];

export class ShapeMenu {
  /**
   * Create a shape menu
   * @param {string} elementId - ID of the shape menu element
   * @param {MenuManager} menuManager - Menu manager instance
   */
  constructor(elementId = 'shape_menu', menuManager) {
    this.elementId = elementId;
    this.menuManager = menuManager;
    this.shapeMenu = q(`#${elementId}`);
    this.onShapeSelected = null; // Callback for shape selection
  }

  /**
   * Show shape menu at specified point
   * @param {maplibregl.Point} point - Screen coordinates
   * @param {Function} onShapeSelected - Callback when shape is selected (shapeType) => void
   */
  show(point, onShapeSelected = null) {
    if (!this.shapeMenu) return;

    this.onShapeSelected = onShapeSelected;

    this.clearSegments();
    this.positionMenu(point);
    this.createShapeDonutSegments(point);
    this.shapeMenu.classList.add('visible');

    this.menuManager.setupDismissHandler(this.shapeMenu, {
      onDismiss: () => this.hide()
    });
  }

  hide() {
    if (this.shapeMenu) {
      this.shapeMenu.classList.remove('visible');
      this.clearSegments();
    }
    this.menuManager.cleanup(this.shapeMenu);
  }

  clearSegments() {
    if (!this.shapeMenu) return;
    const existingSegments = this.shapeMenu.querySelector('.shape-menu-segments-container');
    this.shapeMenu.innerHTML = '';
    if (existingSegments) {
      existingSegments.remove();
    }
  }

  positionMenu(point) {
    this.shapeMenu.style.left = (point.x - 100) + 'px';
    this.shapeMenu.style.top = (point.y - 100) + 'px';
    this.shapeMenu.style.position = 'absolute';
  }

  /**
   * Create donut segments with shape icons (dark segments + icon per shape)
   */
  createShapeDonutSegments(point) {
    const centerX = 100;
    const centerY = 100;
    const innerRadius = 40;
    const outerRadius = 80;
    const gapAngle = 4;

    const totalAngle = 360 - (SHAPES.length * gapAngle);
    const segmentAngle = totalAngle / SHAPES.length;
    const iconRadius = (innerRadius + outerRadius) / 2;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svgContainer = document.createElement('div');
    svgContainer.className = 'shape-menu-segments-container';
    svgContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 200px; height: 200px;';

    const svgElement = document.createElementNS(svgNS, 'svg');
    svgElement.setAttribute('width', '200');
    svgElement.setAttribute('height', '200');
    svgElement.setAttribute('viewBox', '0 0 200 200');
    svgElement.style.cssText = 'position: absolute; top: 0; left: 0;';

    svgContainer.appendChild(svgElement);

    SHAPES.forEach((shape, index) => {
      const startAngle = (index * (segmentAngle + gapAngle)) - 90;
      const endAngle = startAngle + segmentAngle;
      const pathData = this.createDonutSegmentPath(centerX, centerY, innerRadius, outerRadius, startAngle, endAngle);

      const pathElement = document.createElementNS(svgNS, 'path');
      pathElement.setAttribute('d', pathData);
      pathElement.setAttribute('data-shape-type', shape.type);
      pathElement.style.cssText = 'fill: rgba(0, 0, 0, 0.8); stroke: white; stroke-width: 3; transition: all 0.2s ease; cursor: pointer;';

      pathElement.addEventListener('click', (e) => {
        e.stopPropagation();
        logger.debug('Clicked on shape:', shape.type);
        if (this.onShapeSelected) {
          this.onShapeSelected(shape.type);
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

      // Icon at center of segment (reuse fan-menu shape icon classes)
      const iconAngle = startAngle + segmentAngle / 2;
      const iconAngleRad = (iconAngle * Math.PI) / 180;
      const iconX = centerX + iconRadius * Math.cos(iconAngleRad);
      const iconY = centerY + iconRadius * Math.sin(iconAngleRad);

      const iconElement = document.createElement('div');
      iconElement.className = `fan-menu-segment-icon ${shape.iconClass}`;
      iconElement.style.cssText = `position: absolute; left: ${iconX}px; top: ${iconY}px; transform: translate(-50%, -50%); pointer-events: none;`;
      svgContainer.appendChild(iconElement);
    });

    this.shapeMenu.appendChild(svgContainer);
  }

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

  getElement() {
    return this.shapeMenu;
  }
}
