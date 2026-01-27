/**
 * Menu Manager Component
 * Handles generic menu dismissal logic for fan menu, color menu, etc.
 */

import { logger } from '../../utils/logger.js';
import { TIMING } from '../../config/mapConfig.js';

export class MenuManager {
  constructor() {
    this.dismissHandlers = new Map(); // Map of element -> handler
  }

  /**
   * Setup dismiss handler for a menu element
   * @param {HTMLElement} menuElement - Menu element
   * @param {Object} options - Options
   * @param {Function} options.onDismiss - Callback when menu is dismissed
   * @param {boolean} options.ignoreLongPress - Whether to ignore long press events
   */
  setupDismissHandler(menuElement, options = {}) {
    // Clean up existing handler if any
    this.cleanup(menuElement);
    
    const handler = (e) => {
      // Don't dismiss if this was a long press event
      if (!options.ignoreLongPress && e._longPressHandled) {
        logger.debug('Ignoring menu dismissal due to long press event');
        return;
      }
      
      // Check if click is outside the menu
      if (menuElement && !menuElement.contains(e.target)) {
        logger.debug('Clicking outside menu, dismissing');
        if (options.onDismiss) {
          options.onDismiss();
        }
        this.cleanup(menuElement);
      } else {
        logger.debug('Click was inside menu, not dismissing');
      }
    };
    
    this.dismissHandlers.set(menuElement, handler);
    
    // Use a small delay to prevent immediate dismissal from the click that opened the menu
    setTimeout(() => {
      document.addEventListener('click', handler);
    }, TIMING.menuDismissDelay);
  }

  /**
   * Clean up dismiss handler for a menu element
   * @param {HTMLElement} menuElement - Menu element
   */
  cleanup(menuElement) {
    const handler = this.dismissHandlers.get(menuElement);
    if (handler) {
      document.removeEventListener('click', handler);
      this.dismissHandlers.delete(menuElement);
    }
  }

  /**
   * Clean up all handlers
   */
  cleanupAll() {
    this.dismissHandlers.forEach((handler, element) => {
      document.removeEventListener('click', handler);
    });
    this.dismissHandlers.clear();
  }
}
