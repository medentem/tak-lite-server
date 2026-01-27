/**
 * Icon Manager
 * Manages POI icon generation and caching
 */

import { logger } from '../../utils/logger.js';
import { getColorHex, POI_CONFIG } from '../../config/mapConfig.js';

export class IconManager {
  /**
   * Create an icon manager
   * @param {maplibregl.Map} map - Map instance
   */
  constructor(map) {
    this.map = map;
    this.generatedIcons = new Set(); // Track generated icons to prevent duplicates
  }

  /**
   * Generate all POI icons
   */
  generateAllIcons() {
    const shapes = ['circle', 'square', 'triangle', 'exclamation'];
    const colors = ['green', 'yellow', 'red', 'black', 'white'];
    
    shapes.forEach(shape => {
      colors.forEach(color => {
        this.generateIcon(shape, color);
      });
    });
    
    logger.info(`Generated ${this.generatedIcons.size} POI icons`);
  }

  /**
   * Generate a single POI icon
   * @param {string} shape - Icon shape (circle, square, triangle, exclamation)
   * @param {string} color - Icon color (green, yellow, red, black, white)
   * @returns {boolean} True if icon was generated, false if it already existed
   */
  generateIcon(shape, color) {
    const iconName = `poi-${shape}-${color}`;
    
    // Check if icon already exists
    if (this.generatedIcons.has(iconName)) {
      logger.debug(`Icon ${iconName} already generated, skipping`);
      return false;
    }
    
    try {
      // Check if icon already exists in map
      if (this.map.getImage(iconName)) {
        logger.debug(`Icon ${iconName} already exists in map, skipping`);
        this.generatedIcons.add(iconName);
        return false;
      }
      
      const imageData = this.createIcon(shape, color);
      this.map.addImage(iconName, imageData);
      this.generatedIcons.add(iconName);
      logger.debug(`Generated POI icon: ${iconName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create Canvas icon ${iconName}:`, error);
      return false;
    }
  }

  /**
   * Create a Canvas POI icon
   * @param {string} shape - Icon shape
   * @param {string} color - Icon color
   * @returns {ImageData} Image data for MapLibre
   */
  createIcon(shape, color) {
    const size = POI_CONFIG.iconSize;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = POI_CONFIG.iconRadius;
    const colorHex = getColorHex(color);
    
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, size, size);
    
    // Set up drawing styles
    ctx.fillStyle = colorHex;
    ctx.strokeStyle = POI_CONFIG.strokeColor;
    ctx.lineWidth = POI_CONFIG.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Draw shape
    this.drawShape(ctx, shape, centerX, centerY, radius);
    
    // Convert canvas to ImageData format that MapLibre expects
    return {
      width: size,
      height: size,
      data: ctx.getImageData(0, 0, size, size).data
    };
  }

  /**
   * Draw shape on canvas
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} shape - Shape type
   * @param {number} centerX - Center X coordinate
   * @param {number} centerY - Center Y coordinate
   * @param {number} radius - Shape radius
   */
  drawShape(ctx, shape, centerX, centerY, radius) {
    switch (shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'square':
        const squareSize = radius * 2;
        const squareOffset = (POI_CONFIG.iconSize - squareSize) / 2;
        ctx.beginPath();
        ctx.rect(squareOffset, squareOffset, squareSize, squareSize);
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'triangle':
        const height = radius * 2;
        const topY = centerY - height / 2;
        const leftX = centerX - radius;
        const leftY = centerY + height / 2;
        const rightX = centerX + radius;
        const rightY = centerY + height / 2;
        
        ctx.beginPath();
        ctx.moveTo(centerX, topY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'exclamation':
        this.drawExclamationShape(ctx, centerX, centerY, radius);
        break;
    }
  }

  /**
   * Draw exclamation mark shape
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} centerX - Center X coordinate
   * @param {number} centerY - Center Y coordinate
   * @param {number} radius - Shape radius
   */
  drawExclamationShape(ctx, centerX, centerY, radius) {
    // Triangle base
    const exHeight = radius * 2;
    const exTopY = centerY - exHeight / 2;
    const exLeftX = centerX - radius;
    const exLeftY = centerY + exHeight / 2;
    const exRightX = centerX + radius;
    const exRightY = centerY + exHeight / 2;
    
    // Draw triangle
    ctx.beginPath();
    ctx.moveTo(centerX, exTopY);
    ctx.lineTo(exLeftX, exLeftY);
    ctx.lineTo(exRightX, exRightY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Draw exclamation mark
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    const exMarkTop = centerY - exHeight / 6;
    const exMarkBottom = centerY + exHeight / 6;
    
    ctx.beginPath();
    ctx.moveTo(centerX, exMarkTop);
    ctx.lineTo(centerX, exMarkBottom);
    ctx.stroke();
    
    // Draw dot
    ctx.fillStyle = '#FFFFFF';
    const dotRadius = 3;
    const dotCenterY = exMarkBottom + dotRadius * 2;
    ctx.beginPath();
    ctx.arc(centerX, dotCenterY, dotRadius, 0, 2 * Math.PI);
    ctx.fill();
  }

  /**
   * Check if icon exists
   * @param {string} shape - Icon shape
   * @param {string} color - Icon color
   * @returns {boolean}
   */
  hasIcon(shape, color) {
    const iconName = `poi-${shape}-${color}`;
    return this.generatedIcons.has(iconName) || !!this.map.getImage(iconName);
  }

  /**
   * Get icon name
   * @param {string} shape - Icon shape
   * @param {string} color - Icon color
   * @returns {string} Icon name
   */
  getIconName(shape, color) {
    return `poi-${shape}-${color}`;
  }

  /**
   * Clear generated icons cache
   */
  clearCache() {
    this.generatedIcons.clear();
  }
}
