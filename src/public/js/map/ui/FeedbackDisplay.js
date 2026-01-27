/**
 * Feedback Display Component
 * Handles user feedback messages
 */

import { logger } from '../../utils/logger.js';
import { q } from '../../utils/dom.js';
import { TIMING } from '../../config/mapConfig.js';

export class FeedbackDisplay {
  /**
   * Create a feedback display
   * @param {string} elementId - ID of the feedback element
   */
  constructor(elementId = 'map_feedback') {
    this.elementId = elementId;
    this.feedback = q(`#${elementId}`);
  }

  /**
   * Show feedback message
   * @param {string} message - Message to display
   * @param {number} duration - Duration in milliseconds (default: 3000)
   */
  show(message, duration = TIMING.defaultFeedbackDuration) {
    if (!this.feedback) {
      logger.warn('Feedback element not found');
      return;
    }
    
    this.feedback.textContent = message;
    this.feedback.classList.add('visible');
    
    // Also log to console for debugging
    logger.debug('Map feedback:', message);
    
    setTimeout(() => {
      this.feedback.classList.remove('visible');
    }, duration);
  }

  /**
   * Hide feedback message
   */
  hide() {
    if (this.feedback) {
      this.feedback.classList.remove('visible');
    }
  }

  /**
   * Get feedback element
   * @returns {HTMLElement|null} Feedback element
   */
  getElement() {
    return this.feedback;
  }
}
