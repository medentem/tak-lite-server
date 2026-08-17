/**
 * Shared finish/cancel toolbar for line and area drawing.
 * Positioned at the bottom of the map so it is not covered by mobile chrome.
 */

import { q } from '../../utils/dom.js';

export class DrawingControls {
  /**
   * @param {Object} options
   * @param {Function} options.onFinish
   * @param {Function} options.onCancel
   * @param {boolean} [options.finishEnabled=true]
   */
  constructor({ onFinish, onCancel, finishEnabled = true } = {}) {
    this.onFinish = onFinish;
    this.onCancel = onCancel;
    this.element = null;
    this.checkButton = null;
    this.create(finishEnabled);
  }

  create(finishEnabled) {
    this.remove();

    this.element = document.createElement('div');
    this.element.className = 'map-drawing-controls';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Drawing controls');

    this.checkButton = document.createElement('button');
    this.checkButton.type = 'button';
    this.checkButton.className = 'map-drawing-control map-drawing-control-finish';
    this.checkButton.innerHTML = '✓';
    this.checkButton.title = 'Finish';
    this.checkButton.setAttribute('aria-label', 'Finish drawing');
    this.setFinishEnabled(finishEnabled);
    this.checkButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.checkButton.disabled) return;
      this.onFinish?.();
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'map-drawing-control map-drawing-control-cancel';
    cancelButton.innerHTML = '✕';
    cancelButton.title = 'Cancel';
    cancelButton.setAttribute('aria-label', 'Cancel drawing');
    cancelButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onCancel?.();
    });

    this.element.appendChild(this.checkButton);
    this.element.appendChild(cancelButton);

    const mapContainer = q('#map_container');
    if (mapContainer) {
      mapContainer.appendChild(this.element);
    }
  }

  /**
   * @param {boolean} enabled
   */
  setFinishEnabled(enabled) {
    if (!this.checkButton) return;
    this.checkButton.disabled = !enabled;
    this.checkButton.classList.toggle('disabled', !enabled);
  }

  remove() {
    if (this.element) {
      this.element.remove();
      this.element = null;
      this.checkButton = null;
    }
  }
}
