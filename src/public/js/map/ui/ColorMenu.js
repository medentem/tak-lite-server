/**
 * Color Menu Component
 * Handles the color selection menu
 */

import { logger } from '../../utils/logger.js';
import { q } from '../../utils/dom.js';
import { MenuManager } from './MenuManager.js';
import { COLORS, TIMING } from '../../config/mapConfig.js';

export class ColorMenu {
  /**
   * Create a color menu
   * @param {string} elementId - ID of the color menu element
   * @param {MenuManager} menuManager - Menu manager instance
   */
  constructor(elementId = 'color_menu', menuManager) {
    this.elementId = elementId;
    this.menuManager = menuManager;
    this.colorMenu = q(`#${elementId}`);
    this.onColorSelected = null; // Callback for color selection
  }

  /**
   * Show color menu at specified point
   * @param {maplibregl.Point} point - Screen coordinates
   * @param {string} annotationType - Type of annotation ('poi', 'area', 'line')
   * @param {Function} onColorSelected - Callback when color is selected
   */
  show(point, annotationType, onColorSelected = null) {
    if (!this.colorMenu) return;
    
    this.onColorSelected = onColorSelected;
    
    // Clear existing segments
    this.clearSegments();
    
    const colors = [
      { name: 'green', hex: COLORS.green },
      { name: 'yellow', hex: COLORS.yellow },
      { name: 'red', hex: COLORS.red },
      { name: 'black', hex: COLORS.black },
      { name: 'white', hex: COLORS.white }
    ];
    
    // Position color menu
    this.positionMenu(point);
    
    // Create donut ring segments for colors
    this.createColorDonutSegments(colors, point, annotationType);
    
    // Show color menu
    this.colorMenu.classList.add('visible');
    
    // Setup dismiss handler
    this.menuManager.setupDismissHandler(this.colorMenu, {
      onDismiss: () => this.hide()
    });
  }

  /**
   * Hide color menu
   */
  hide() {
    if (this.colorMenu) {
      this.colorMenu.classList.remove('visible');
      this.clearSegments();
    }
    this.menuManager.cleanup(this.colorMenu);
  }

  /**
   * Clear menu segments
   */
  clearSegments() {
    if (!this.colorMenu) return;
    
    const existingSegments = this.colorMenu.querySelector('.color-menu-segments-container');
    this.colorMenu.innerHTML = '';
    if (existingSegments) {
      existingSegments.remove();
    }
  }

  /**
   * Position menu at point
   */
  positionMenu(point) {
    this.colorMenu.style.left = (point.x - 100) + 'px';
    this.colorMenu.style.top = (point.y - 100) + 'px';
    this.colorMenu.style.position = 'absolute';
  }

  /**
   * Create color donut segments
   */
  createColorDonutSegments(colors, point, annotationType) {
    const centerX = 100;
    const centerY = 100;
    const innerRadius = 40;
    const outerRadius = 80;
    const gapAngle = 4;

    const totalAngle = 360 - (colors.length * gapAngle);
    const segmentAngle = totalAngle / colors.length;

    // Create SVG container
    const svgContainer = document.createElement('div');
    svgContainer.className = 'color-menu-segments-container';
    svgContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 200px; height: 200px;';
    
    const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgElement.setAttribute('width', '200');
    svgElement.setAttribute('height', '200');
    svgElement.setAttribute('viewBox', '0 0 200 200');
    svgElement.style.cssText = 'position: absolute; top: 0; left: 0;';
    
    svgContainer.appendChild(svgElement);

    colors.forEach((color, index) => {
      const startAngle = (index * (segmentAngle + gapAngle)) - 90;
      const endAngle = startAngle + segmentAngle;
      
      const pathData = this.createDonutSegmentPath(centerX, centerY, innerRadius, outerRadius, startAngle, endAngle);
      
      // Create path element
      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', pathData);
      pathElement.setAttribute('data-color-name', color.name);
      pathElement.style.cssText = `fill: ${color.hex}; stroke: white; stroke-width: 3; transition: all 0.2s ease; cursor: pointer;`;
      
      // Click handler
      pathElement.addEventListener('click', (e) => {
        e.stopPropagation();
        logger.debug('Clicked on color:', color.name);
        if (this.onColorSelected) {
          this.onColorSelected(color.name, annotationType);
        }
        this.hide();
      });
      
      // Hover handlers
      pathElement.addEventListener('mouseenter', () => {
        pathElement.style.filter = 'brightness(1.2) saturate(1.1)';
        pathElement.style.stroke = 'rgba(255, 255, 255, 0.9)';
        pathElement.style.strokeWidth = '4';
      });
      
      pathElement.addEventListener('mouseleave', () => {
        pathElement.style.filter = '';
        pathElement.style.stroke = 'white';
        pathElement.style.strokeWidth = '3';
      });
      
      svgElement.appendChild(pathElement);
    });
    
    this.colorMenu.appendChild(svgContainer);
  }

  /**
   * Create donut segment path (same as FanMenu)
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
    return this.colorMenu;
  }
}
